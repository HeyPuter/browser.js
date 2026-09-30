//! Proxy elision for the `ppsc` visitor.
//!
//! `ppsc` hands the page a `Proxy` wherever it names the window or the document, and every member
//! read through one pays for the trap. Most of those reads are ones the proxy answers exactly as
//! the real object would: the traps only differ for a handful of names, for a key that is not
//! known, and for identity. So a reference whose every use is one of the safe ones is left as the
//! real object, and never wrapped at all.
//!
//! Minified code does not name the globals where it uses them, it names a local it copied them
//! into. That local keeps the proxy, exactly as `ppsc` would have it - nothing about how it is
//! used unsafely changes. What changes are its safe uses, which are pointed back at the real
//! object: at the global itself when the local provably holds it (`var e = window`, never
//! reassigned), or otherwise at a twin, `e$r`, kept holding `$unwrap(e)` beside every write of
//! `e`. That needs every write of the local to be seen - no direct `eval`, no `arguments` aliasing
//! a parameter, no global binding - and nothing else.
//!
//! A function's `this` is classified the same way, because a function called on an unwrapped
//! window has the real one as its `this`. With [`Options::wrap_this`] its unsafe uses read a
//! wrapped copy, `$t`; without, it is left as `ppsc` always left it, and only renamed.

use oxc::{
	ast::{
		AstKind,
		ast::{
			Argument, AssignmentOperator, AssignmentTarget, BinaryOperator, BindingPattern,
			BindingPatternKind, Expression, FormalParameters, LogicalOperator, ObjectPattern, Program,
			UnaryOperator,
		},
	},
	semantic::{AstNodes, NodeId, Scoping, Semantic, SymbolId},
	span::{GetSpan, Span},
	syntax::{scope::ScopeFlags, symbol::SymbolFlags},
};
use std::collections::{HashMap, HashSet};

/// The kinds of real object a value may be, as a set.
const W: u8 = 1;
const D: u8 = 2;

/// The globals that are the window itself.
const W_SOURCES: &[&str] = &["window", "self", "globalThis", "frames"];
/// the names the window proxy answers differently from the window
const W_UNSAFE: &[&str] = &["location", "parent", "top", "eval"];
/// the names on the window that hand back the window again
const W_CHAIN: &[&str] = &["window", "self", "globalThis", "frames"];
/// the names the document proxy answers differently from the document
const D_UNSAFE: &[&str] = &["location", "defaultView"];
/// the unsafe names `Object.prototype` has an accessor for, which `hybrid` renames to
const RENAMABLE: &[&str] = &["location", "parent", "top", "eval"];

#[derive(Clone, Copy, Default, Debug)]
pub struct Options {
	/// rename a static read of an unsafe name to its accessor, rather than keep the proxy for it
	pub hybrid: bool,
	/// wrap a function's `this` where it is used unsafely
	pub wrap_this: bool,
}

/// What becomes of one identifier reference, or one `this`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IdentEdit {
	/// left as it is: a global the proxy would answer the same for, or a local named like one
	Keep,
	/// a safe use of a local holding the proxy, read as the global it provably holds instead
	Global(&'static str),
	/// a safe use of a local holding the proxy, read from its twin instead
	Twin(String),
	/// a `this` read from its function's `$t`
	ThisTemp,
	/// wrapped where it is - a `this` no `$t` can be seen from
	Wrap,
}

/// Where a twin is declared.
#[derive(Clone, Copy, Debug)]
pub enum TwinDecl {
	/// after the declarator that declares its local
	After(u32),
	/// before the first statement of the body that sees its parameter or catch binding
	Prelude(u32),
}

/// An assignment to a twinned local, which updates the twin beside it.
#[derive(Clone, Copy, Debug)]
pub struct TwinWrite {
	pub start: u32,
	pub end: u32,
	/// whether anything reads the assignment's value
	pub discarded: bool,
}

#[derive(Clone, Debug)]
pub struct Twin {
	/// the local's name
	pub name: String,
	pub decl: TwinDecl,
	pub writes: Vec<TwinWrite>,
}

/// What the visitor does differently, by source position.
#[derive(Default, Debug)]
pub struct Elision {
	/// by the start of the identifier or `this`
	pub idents: HashMap<u32, IdentEdit>,
	/// `hybrid`: the keys to rename to the accessor on `Object.prototype`, by the start of the
	/// key - the name itself, or the inside of a string literal
	pub renames: HashSet<u32>,
	/// members reached off a real object and used where only the proxy will do, by their span
	pub wrapped_members: HashSet<(u32, u32)>,
	pub twins: Vec<Twin>,
	/// where a function that reads `$t` declares it: the start of its body's first statement
	pub this_preludes: HashSet<u32>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Origin {
	/// a reference to one of the globals
	Global,
	/// a read of a local a global was moved into
	Alias,
	/// a member reached off one of these that hands back the window or the document again
	Derived,
	/// a function's `this`
	This,
	/// a read of a local given only some function's `this`, or what was reached off it
	ThisAlias,
}

/// How a value got into a local.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Via {
	/// its declaration's initializer
	Init,
	/// a pattern in its declaration's initializer
	Destructure,
	/// the argument an immediately invoked function was called with
	ParamIife,
	/// the argument some other resolved call passed
	ParamCall,
	/// a later assignment, or any value that is only one of several an expression can have
	Assign,
	/// a parameter's default
	Default,
}

struct Decision {
	kind: u8,
	origin: Origin,
	safe: bool,
	span: Span,
	node: NodeId,
	/// whether the value is the object of a member access - a trap, while it is a proxy
	member_object: bool,
	/// for a derived value, the reference it was reached from
	root: Option<NodeId>,
}

/// Whose `this` a `this` is.
enum ThisOwner {
	/// a function's; `$t` is declared before the body's first statement, which a `this` in the
	/// parameters (`params`) cannot see
	Function { params: Span, first: Option<u32> },
	/// a script's top level, which is the window itself
	Script,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum ThisSource {
	This(NodeId),
	Local(SymbolId),
}

enum Use {
	/// the proxy would answer it the same
	Safe,
	/// only the proxy will do
	Unsafe,
	/// a static read of one of the names the proxy answers differently
	UnsafeName,
	/// a static member: the object is used safely, and the member - the node - may itself be a new
	/// value, of the kinds given
	Member(u8, NodeId),
}

struct Classified {
	verdict: Use,
	/// the locals the value was moved into on the way, with the kinds each receives and how
	flows: Vec<(SymbolId, u8, Via)>,
	/// `hybrid`: the key of the member the value was read through, when it was renamed
	rename: Option<u32>,
}

struct Ctx<'s, 'a> {
	nodes: &'s AstNodes<'a>,
	scoping: &'s Scoping,
	module: bool,
	options: Options,
	with_bodies: Vec<Span>,
	/// non-arrow functions that read `arguments`
	uses_arguments: HashSet<NodeId>,
}

fn span_of(nodes: &AstNodes, id: NodeId) -> Span {
	nodes.kind(id).span()
}

/// The AST outlives the analysis; the borrow checker cannot see that through `AstKind`.
fn extend<'a, T>(t: &T) -> &'a T {
	unsafe { &*std::ptr::from_ref(t) }
}

impl<'a> Ctx<'_, 'a> {
	fn in_with(&self, span: Span) -> bool {
		self.with_bodies
			.iter()
			.any(|b| span.start >= b.start && span.end <= b.end)
	}

	/// Whether every write of a local can be seen, which is what tracking it needs.
	fn trackable(&self, sym: SymbolId) -> bool {
		let s = self.scoping;
		let flags = s.symbol_flags(sym);
		if !flags.intersects(SymbolFlags::Variable | SymbolFlags::CatchVariable | SymbolFlags::Function)
			|| flags.intersects(SymbolFlags::Import)
		{
			return false;
		}
		let scope = s.symbol_scope_id(sym);
		// a script's top level is the global object, which any other script can write to; a
		// module's exports are read elsewhere
		if scope == s.root_scope_id() && (!self.module || self.exported(sym)) {
			return false;
		}
		// the flag is carried up to every scope around the call, so this is any `eval` that
		// could see the local
		if s.scope_flags(scope).contains(ScopeFlags::DirectEval) {
			return false;
		}
		let decl = s.symbol_declaration(sym);
		if matches!(self.nodes.kind(decl), AstKind::FormalParameter(_)) {
			// `arguments` aliases the parameters of the function that declares them
			for anc in self.nodes.ancestor_ids(decl) {
				match self.nodes.kind(anc) {
					AstKind::Function(_) => {
						if self.uses_arguments.contains(&anc) {
							return false;
						}
						break;
					}
					AstKind::ArrowFunctionExpression(_) => break,
					_ => {}
				}
			}
		}
		// a write inside `with` may land on its object instead
		!s.get_resolved_references(sym)
			.any(|r| r.is_write() && self.in_with(span_of(self.nodes, r.node_id())))
	}

	fn exported(&self, sym: SymbolId) -> bool {
		let s = self.scoping;
		let decl = s.symbol_declaration(sym);
		self.nodes.ancestor_kinds(decl).any(|k| {
			matches!(k, AstKind::ExportNamedDeclaration(_) | AstKind::ExportDefaultDeclaration(_))
		}) || s.get_resolved_references(sym).any(|r| {
			matches!(
				self.nodes.parent_kind(r.node_id()),
				AstKind::ExportSpecifier(_) | AstKind::ExportDefaultDeclaration(_)
			)
		})
	}

	/// The symbol a binding pattern names, if it is a plain name, perhaps with a default.
	fn pattern_symbol(p: &BindingPattern) -> Option<SymbolId> {
		match &p.kind {
			BindingPatternKind::BindingIdentifier(b) => b.symbol_id.get(),
			BindingPatternKind::AssignmentPattern(a) => Self::pattern_symbol(&a.left),
			_ => None,
		}
	}

	/// The parameters a call statically lands in, the index of its first argument there, and
	/// whether the call is the function's only one: an immediately invoked function.
	fn resolve_callee(&self, callee: &Expression<'a>) -> Option<(&'a FormalParameters<'a>, usize, bool)> {
		let mut c = callee.without_parentheses();
		let mut offset = 0;
		// `(function(){}).call(thisArg, a, b)`
		if let Expression::StaticMemberExpression(m) = c
			&& m.property.name == "call"
		{
			c = m.object.without_parentheses();
			offset = 1;
		}
		match c {
			Expression::FunctionExpression(f) => Some((extend(&f.params), offset, true)),
			Expression::ArrowFunctionExpression(f) => Some((extend(&f.params), offset, true)),
			Expression::Identifier(id) => {
				let sym = self.scoping.get_reference(id.reference_id.get()?).symbol_id()?;
				if self.scoping.symbol_is_mutated(sym) {
					return None;
				}
				// A script's top level is the global object: another script can replace the
				// function (`window.f = ...`, or a later `function f`), and the replacement would
				// be handed the real object. So can a second declaration in this one.
				if (!self.module && self.scoping.symbol_scope_id(sym) == self.scoping.root_scope_id())
					|| !self.scoping.symbol_redeclarations(sym).is_empty()
				{
					return None;
				}
				let decl = self.scoping.symbol_declaration(sym);
				let params = match self.nodes.kind(decl) {
					AstKind::Function(f) if f.is_declaration() => extend(&f.params),
					AstKind::VariableDeclarator(v) => match v.init.as_ref()?.without_parentheses() {
						Expression::FunctionExpression(f) => extend(&f.params),
						Expression::ArrowFunctionExpression(f) => extend(&f.params),
						_ => return None,
					},
					// the UMD shape: a parameter of an immediately invoked function, bound to a
					// function that same call passes it
					AstKind::FormalParameter(_) => self.factory_params(decl, sym)?,
					_ => return None,
				};
				Some((params, offset, false))
			}
			_ => None,
		}
	}

	/// For `(function(root, factory){ ... factory(root) })(window, function(w){ ... })`, the
	/// parameters of the function passed as `factory`.
	fn factory_params(&self, decl: NodeId, sym: SymbolId) -> Option<&'a FormalParameters<'a>> {
		let params_id = self.nodes.parent_id(decl);
		let AstKind::FormalParameters(params) = self.nodes.kind(params_id) else {
			return None;
		};
		let idx = params.items.iter().position(|p| {
			matches!(p.pattern.kind, BindingPatternKind::BindingIdentifier(_))
				&& Self::pattern_symbol(&p.pattern) == Some(sym)
		})?;
		let func = self.nodes.parent_id(params_id);
		let mut up = self.nodes.parent_id(func);
		while matches!(self.nodes.kind(up), AstKind::ParenthesizedExpression(_)) {
			up = self.nodes.parent_id(up);
		}
		let AstKind::CallExpression(call) = self.nodes.kind(up) else {
			return None;
		};
		if call.callee.without_parentheses().span() != span_of(self.nodes, func) {
			return None;
		}
		match call.arguments.get(idx)? {
			Argument::FunctionExpression(f) => Some(extend(&f.params)),
			Argument::ArrowFunctionExpression(f) => Some(extend(&f.params)),
			_ => None,
		}
	}

	/// Climbs the expressions that hand their operand's value straight through, and decides what
	/// the use the value ends up in needs.
	///
	/// `this_value`: the value is a function's `this`, which may be handed on as the receiver of
	/// `.call`, `.apply` or `.bind`: the function it lands in has the same `this` analysis, and a
	/// native does not care which of the two it is given.
	fn classify(&self, start: NodeId, kind: u8, this_value: bool) -> Classified {
		let nodes = self.nodes;
		let mut flows: Vec<(SymbolId, u8, Via)> = Vec::new();
		let mut e = start;
		// whether the value arrives whole: through a conditional or a logical operator it is only
		// one of the values the expression can have, and a local given it may hold another
		let mut whole = true;

		macro_rules! done {
			($v:expr) => {
				return Classified { verdict: $v, flows, rename: None }
			};
		}
		macro_rules! flow {
			($sym:expr, $kind:expr, $via:expr) => {{
				let sym = $sym;
				if !self.trackable(sym) {
					return Classified { verdict: Use::Unsafe, flows, rename: None };
				}
				flows.push((sym, $kind, if whole { $via } else { Via::Assign }));
			}};
		}

		loop {
			let child = span_of(nodes, e);
			let pid = nodes.parent_id(e);
			match nodes.kind(pid) {
				AstKind::ParenthesizedExpression(_) | AstKind::ChainExpression(_) => e = pid,
				AstKind::SequenceExpression(s) => {
					if s.expressions.last().map(GetSpan::span) != Some(child) {
						done!(Use::Safe);
					}
					e = pid;
				}
				AstKind::ConditionalExpression(c) => {
					if c.test.span() == child {
						done!(Use::Safe);
					}
					whole = false;
					e = pid;
				}
				AstKind::LogicalExpression(l) => {
					// `a && b` only hands `a` on when it is falsy, which the window never is
					if l.operator == LogicalOperator::And && l.left.span() == child {
						done!(Use::Safe);
					}
					whole = false;
					e = pid;
				}
				AstKind::AssignmentExpression(a) if a.right.span() == child => match &a.left {
					AssignmentTarget::AssignmentTargetIdentifier(id) => {
						let Some(sym) = id
							.reference_id
							.get()
							.and_then(|r| self.scoping.get_reference(r).symbol_id())
						else {
							done!(Use::Unsafe);
						};
						flow!(sym, kind, Via::Assign);
						// and the assignment's own value goes on
						e = pid;
					}
					_ => done!(Use::Unsafe),
				},
				// the value is the target, not a use: `e += 1`, `e ||= x`
				AstKind::AssignmentExpression(_) | AstKind::UpdateExpression(_) => done!(Use::Safe),
				AstKind::StaticMemberExpression(m) if m.object.span() == child => {
					let name = m.property.name.as_str();
					let u = Self::member(kind, name, pid);
					if self.renamable(&u, name, pid) {
						return Classified {
							verdict: Use::Member(0, pid),
							flows,
							rename: Some(m.property.span.start),
						};
					}
					done!(u);
				}
				AstKind::ComputedMemberExpression(m) if m.object.span() == child => match &m.expression {
					// `window["0"]` is the same frame as `window[0]`
					Expression::StringLiteral(s) if kind & W != 0 && is_array_index(&s.value) => {
						done!(Use::Unsafe)
					}
					Expression::StringLiteral(s) => {
						let u = Self::member(kind, s.value.as_str(), pid);
						if self.renamable(&u, s.value.as_str(), pid) {
							return Classified {
								verdict: Use::Member(0, pid),
								flows,
								rename: Some(s.span.start + 1),
							};
						}
						done!(u)
					}
					// `window[0]` is a frame
					Expression::NumericLiteral(_) if kind & W != 0 => done!(Use::Unsafe),
					Expression::NumericLiteral(_) => done!(Use::Member(0, pid)),
					_ => done!(Use::Unsafe),
				},
				AstKind::PrivateFieldExpression(_) | AstKind::UnaryExpression(_) => done!(Use::Safe),
				AstKind::BinaryExpression(b) => {
					use BinaryOperator as B;
					match b.operator {
						// identity is exactly what the proxy is not
						B::Equality | B::Inequality | B::StrictEquality | B::StrictInequality => {
							done!(Use::Unsafe)
						}
						B::In if b.right.span() == child => done!(Use::Safe),
						B::Instanceof if b.left.span() == child => {
							// a platform constructor looks at the prototype, which the proxy
							// forwards; anything else may have a `Symbol.hasInstance` that is
							// handed the value
							let platform = matches!(&b.right, Expression::Identifier(r)
								if r.reference_id.get().is_some_and(|id| self.scoping.get_reference(id).symbol_id().is_none())
									&& r.name.starts_with(|c: char| c.is_ascii_uppercase()));
							done!(if platform { Use::Safe } else { Use::Unsafe })
						}
						_ => done!(Use::Safe),
					}
				}
				AstKind::IfStatement(s) if s.test.span() == child => done!(Use::Safe),
				AstKind::WhileStatement(s) if s.test.span() == child => done!(Use::Safe),
				AstKind::DoWhileStatement(s) if s.test.span() == child => done!(Use::Safe),
				AstKind::ForStatement(s) if s.test.as_ref().map(GetSpan::span) == Some(child) => {
					done!(Use::Safe)
				}
				// an arrow's expression body is an expression statement in the tree, and it is a return
				AstKind::ExpressionStatement(_) if is_arrow_body(nodes, pid) => done!(Use::Unsafe),
				AstKind::ExpressionStatement(_) => done!(Use::Safe),
				AstKind::TemplateLiteral(_) => done!(Use::Safe),
				AstKind::CallExpression(c) if c.callee.span() == child => done!(Use::Safe),
				AstKind::NewExpression(c) if c.callee.span() == child => done!(Use::Safe),
				AstKind::TaggedTemplateExpression(t) if t.tag.span() == child => done!(Use::Safe),
				AstKind::Argument(_) => {
					let AstKind::CallExpression(call) = nodes.parent_kind(pid) else {
						done!(Use::Unsafe);
					};
					let args = &call.arguments;
					let Some(idx) = args.iter().position(|a| a.span() == child) else {
						done!(Use::Unsafe);
					};
					if this_value
						&& idx == 0
						&& let Expression::StaticMemberExpression(m) = call.callee.without_parentheses()
						&& matches!(m.property.name.as_str(), "call" | "apply" | "bind")
					{
						done!(Use::Safe);
					}
					if args[..idx].iter().any(|a| matches!(a, Argument::SpreadElement(_))) {
						done!(Use::Unsafe);
					}
					let Some((params, offset, iife)) = self.resolve_callee(&call.callee) else {
						done!(Use::Unsafe);
					};
					let Some(sym) = idx
						.checked_sub(offset)
						.and_then(|i| params.items.get(i))
						.and_then(|p| Self::pattern_symbol(&p.pattern))
					else {
						done!(Use::Unsafe);
					};
					if !self.trackable(sym) {
						done!(Use::Unsafe);
					}
					flows.push((sym, kind, if iife && whole { Via::ParamIife } else { Via::ParamCall }));
					done!(Use::Safe);
				}
				AstKind::VariableDeclarator(v) if v.init.as_ref().map(GetSpan::span) == Some(child) => {
					match &v.id.kind {
						BindingPatternKind::BindingIdentifier(b) => {
							let Some(sym) = b.symbol_id.get() else {
								done!(Use::Unsafe);
							};
							flow!(sym, kind, Via::Init);
							done!(Use::Safe);
						}
						BindingPatternKind::ObjectPattern(p) => {
							let ok = self.destructure(p, kind, &mut flows, whole);
							done!(if ok { Use::Safe } else { Use::Unsafe })
						}
						_ => done!(Use::Unsafe),
					}
				}
				AstKind::AssignmentPattern(p) if p.right.span() == child => {
					let Some(sym) = Self::pattern_symbol(&p.left) else {
						done!(Use::Unsafe);
					};
					flow!(sym, kind, Via::Default);
					done!(Use::Safe);
				}
				// returned, thrown, stored in a literal, iterated, `with`, `switch`, spread, and
				// anything not recognised
				_ => done!(Use::Unsafe),
			}
		}
	}

	/// `hybrid`: whether an unsafe name read through this member can be renamed to its accessor
	/// instead. The accessors are the ones `dpsc` puts on `Object.prototype`, and they forward to
	/// the name itself for anything that is not the window or the document, so the rename holds
	/// whatever the object is. Not for `delete`, which the accessor cannot stand in for.
	fn renamable(&self, u: &Use, name: &str, member: NodeId) -> bool {
		self.options.hybrid
			&& matches!(u, Use::UnsafeName)
			&& RENAMABLE.contains(&name)
			&& !matches!(
				self.nodes.parent_kind(member),
				AstKind::UnaryExpression(u) if u.operator == UnaryOperator::Delete
			)
	}

	fn member(kind: u8, name: &str, member: NodeId) -> Use {
		if (kind & W != 0 && W_UNSAFE.contains(&name)) || (kind & D != 0 && D_UNSAFE.contains(&name)) {
			return Use::UnsafeName;
		}
		let mut derived = 0;
		if kind & W != 0 && W_CHAIN.contains(&name) {
			derived |= W;
		}
		if kind & W != 0 && name == "document" {
			derived |= D;
		}
		Use::Member(derived, member)
	}

	/// `var {document: d, innerWidth} = window`: safe when every key is static and safe, moving
	/// the window or document into the locals that take one.
	fn destructure(&self, p: &ObjectPattern, kind: u8, flows: &mut Vec<(SymbolId, u8, Via)>, whole: bool) -> bool {
		if p.rest.is_some() {
			return false;
		}
		for prop in &p.properties {
			if prop.computed {
				return false;
			}
			let Some(name) = prop.key.static_name() else {
				return false;
			};
			let Use::Member(derived, _) = Self::member(kind, &name, NodeId::DUMMY) else {
				return false;
			};
			if derived != 0 {
				let Some(sym) = Self::pattern_symbol(&prop.value) else {
					return false;
				};
				if !self.trackable(sym) {
					return false;
				}
				flows.push((sym, derived, if whole { Via::Destructure } else { Via::Assign }));
			}
		}
		true
	}
}

pub fn analyze<'a>(program: &Program<'a>, semantic: &Semantic<'a>, options: Options) -> Elision {
	let nodes = semantic.nodes();
	let scoping = semantic.scoping();

	let mut with_bodies = Vec::new();
	let mut uses_arguments = HashSet::new();
	for n in nodes.iter() {
		match n.kind() {
			AstKind::WithStatement(w) => with_bodies.push(w.body.span()),
			AstKind::IdentifierReference(r) if r.name == "arguments" => {
				let unresolved = r
					.reference_id
					.get()
					.is_none_or(|id| scoping.get_reference(id).symbol_id().is_none());
				if unresolved
					&& let Some(f) = nodes
						.ancestor_ids(n.id())
						.find(|&a| matches!(nodes.kind(a), AstKind::Function(_)))
				{
					uses_arguments.insert(f);
				}
			}
			_ => {}
		}
	}

	let ctx = Ctx {
		nodes,
		scoping,
		module: program.source_type.is_module(),
		options,
		with_bodies,
		uses_arguments,
	};

	let mut graph = Graph::default();
	graph.run(&ctx);
	graph.settle(&ctx);
	graph.edits(&ctx)
}

/// Every value followed, and what each of its uses was found to need.
#[derive(Default)]
struct Graph {
	decisions: Vec<Decision>,
	decided: HashMap<NodeId, usize>,
	/// `hybrid`: the keys renamed, found while classifying
	renames: HashSet<u32>,
	/// for each `this` followed, whose `this` it is
	this_owner: HashMap<NodeId, ThisOwner>,
	/// every value moved into a tracked local: for each source node, the kinds it carried and how
	inflows: HashMap<SymbolId, HashMap<NodeId, (u8, Via)>>,
	/// the kinds each tracked local may hold
	binding_kind: HashMap<SymbolId, u8>,
	/// the locals a function's `this` was followed into, and what each was given
	this_in: HashMap<SymbolId, HashSet<ThisSource>>,
}

impl Graph {
	fn decision(&self, id: NodeId) -> Option<&Decision> {
		self.decided.get(&id).map(|&i| &self.decisions[i])
	}

	/// Follows every reference to the globals, and every `this`, through each local and member it
	/// reaches, to the fixpoint.
	fn run(&mut self, ctx: &Ctx) {
		let (nodes, scoping) = (ctx.nodes, ctx.scoping);
		// (node, kinds, origin, root)
		let mut work: Vec<(NodeId, u8, Origin, Option<NodeId>)> = Vec::new();

		// A function called on the window or the document has it as `this`, the real one -
		// whatever the call was made through. So `this` is followed like a reference to the
		// globals. A class is left out: its methods are not called on the window by anything the
		// page does in the ordinary way, and an arrow has the `this` of the function around it.
		for n in nodes.iter() {
			if matches!(n.kind(), AstKind::ThisExpression(_))
				&& let Some(owner) = this_owner_of(nodes, n.id(), ctx.module)
			{
				self.this_owner.insert(n.id(), owner);
				work.push((n.id(), W | D, Origin::This, None));
			}
		}
		for (name, refs) in scoping.root_unresolved_references() {
			let kind = if W_SOURCES.contains(name) {
				W
			} else if *name == "document" {
				D
			} else {
				continue;
			};
			for r in refs {
				let reference = scoping.get_reference(*r);
				// `window = x` names the global without reading it
				if reference.is_read() {
					work.push((reference.node_id(), kind, Origin::Global, None));
				}
			}
		}

		let mut this_syms: HashSet<SymbolId> = HashSet::new();
		while let Some((id, kind, origin, root)) = work.pop() {
			let k = match self.decision(id) {
				Some(d) if d.kind | kind == d.kind => continue,
				Some(d) => d.kind | kind,
				None => kind,
			};
			let span = span_of(nodes, id);

			let mut c = if origin == Origin::Global && ctx.in_with(span) {
				// a name inside `with` may be a property of its object instead
				Classified { verdict: Use::Unsafe, flows: Vec::new(), rename: None }
			} else {
				ctx.classify(id, k, origin == Origin::This)
			};
			// A value moved into a local is moved as the proxy - the local keeps what `ppsc` would
			// give it, and only its safe uses change. So the value itself has to be wrapped where
			// it is moved, whatever the rest of its use is. A value from a function's `this` is the
			// exception: there is no proxy to give the local, so the local is followed instead, and
			// the `this` wrapped only if the local turns out to be used unsafely somewhere.
			let root_origin = match origin {
				Origin::Derived => root.and_then(|r| self.decision(r)).map(|d| d.origin),
				o => Some(o),
			};
			let from_this = matches!(root_origin, Some(Origin::This | Origin::ThisAlias));
			let moved = !c.flows.is_empty() && !from_this;
			let this_flows = if from_this { std::mem::take(&mut c.flows) } else { Vec::new() };

			let mut member_object = false;
			let safe = match c.verdict {
				_ if moved => false,
				Use::Safe => true,
				Use::Unsafe | Use::UnsafeName => {
					member_object = matches!(
						nodes.parent_kind(id),
						AstKind::StaticMemberExpression(_) | AstKind::ComputedMemberExpression(_)
					);
					false
				}
				Use::Member(derived, member) => {
					member_object = true;
					if derived != 0 {
						work.push((member, derived, Origin::Derived, Some(root.unwrap_or(id))));
					}
					true
				}
			};
			if safe && let Some(at) = c.rename {
				self.renames.insert(at);
			}
			let d = Decision { kind: k, origin, safe, span, node: id, member_object, root };
			if let Some(&i) = self.decided.get(&id) {
				self.decisions[i] = d;
			} else {
				self.decided.insert(id, self.decisions.len());
				self.decisions.push(d);
			}

			for (sym, _, _) in this_flows {
				// what the local was given: the `this` itself, or the local an alias of it came from
				let alias_root = match origin {
					Origin::This => None,
					Origin::Derived => root,
					_ => Some(id),
				};
				let src = match alias_root.and_then(|r| symbol_of(nodes, scoping, r)) {
					Some(a) => ThisSource::Local(a),
					None => ThisSource::This(root.unwrap_or(id)),
				};
				self.this_in.entry(sym).or_default().insert(src);
				if this_syms.insert(sym) {
					for r in scoping.get_resolved_references(sym).filter(|r| r.is_read()) {
						work.push((r.node_id(), W | D, Origin::ThisAlias, None));
					}
				}
			}
			for (sym, fk, via) in c.flows {
				self.inflows.entry(sym).or_default().insert(id, (fk, via));
				let old = self.binding_kind.get(&sym).copied().unwrap_or(0);
				if old | fk == old {
					continue;
				}
				self.binding_kind.insert(sym, old | fk);
				for r in scoping.get_resolved_references(sym).filter(|r| r.is_read()) {
					work.push((r.node_id(), old | fk, Origin::Alias, None));
				}
			}
		}
	}

	/// What can only be decided once the whole graph is known.
	fn settle(&mut self, ctx: &Ctx) {
		let (nodes, scoping) = (ctx.nodes, ctx.scoping);

		// A derived member that has to be wrapped, but is a link inside an optional chain, cannot
		// be: `$wrap(w?.document).location` throws where the chain would have stopped. Its root is
		// kept as a proxy instead, which answers the whole chain.
		let interior: Vec<usize> = self
			.decided
			.iter()
			.filter(|&(&id, &i)| {
				let d = &self.decisions[i];
				d.origin == Origin::Derived
					&& !d.safe && chain_span(nodes, id).is_some_and(|c| c != d.span)
			})
			.map(|(_, &i)| i)
			.collect();
		for i in interior {
			self.decisions[i].safe = true; // nothing to do at the link itself
			if let Some(&ri) = self.decisions[i].root.and_then(|r| self.decided.get(&r)) {
				self.decisions[ri].safe = false;
			}
		}

		// A local a `this` was followed into exposes it if any use of it is unsafe, or anything
		// reached off it is used unsafely - or if it is also given a global, and so holds the
		// proxy in every other case. Then each `this` that reached it, directly or through other
		// locals, is wrapped before it is handed over, and the local holds the proxy too.
		let mut exposed: Vec<SymbolId> = self
			.this_in
			.keys()
			.filter(|s| self.binding_kind.contains_key(s))
			.copied()
			.collect();
		for d in self.decisions.iter().filter(|d| !d.safe) {
			let alias = match d.origin {
				Origin::ThisAlias => Some(d.node),
				Origin::Derived => d
					.root
					.filter(|&r| self.decision(r).is_some_and(|rd| rd.origin == Origin::ThisAlias)),
				_ => None,
			};
			exposed.extend(alias.and_then(|n| symbol_of(nodes, scoping, n)));
		}
		let mut seen: HashSet<SymbolId> = HashSet::new();
		while let Some(sym) = exposed.pop() {
			if !seen.insert(sym) {
				continue;
			}
			for src in self.this_in.get(&sym).into_iter().flatten() {
				match *src {
					ThisSource::Local(a) => exposed.push(a),
					ThisSource::This(n) => {
						if let Some(&i) = self.decided.get(&n) {
							self.decisions[i].safe = false;
						}
					}
				}
			}
		}
	}

	/// What the visitor does with what was found.
	fn edits(self, ctx: &Ctx) -> Elision {
		let (nodes, scoping) = (ctx.nodes, ctx.scoping);

		// which locals provably hold one global, and which can be given a twin
		let syms: Vec<SymbolId> = self.binding_kind.keys().copied().collect();
		let mut definite: HashMap<SymbolId, Option<&'static str>> = HashMap::new();
		for &sym in &syms {
			definite_name(sym, ctx, &self, &mut definite, 0);
		}
		let twin_sites: HashMap<SymbolId, TwinSite> =
			syms.iter().filter_map(|&s| Some((s, twin_site(s, ctx)?))).collect();

		let mut out = Elision { renames: self.renames.clone(), ..Default::default() };

		// what each safe use of a tracked local reads instead, if anything
		let mut substituted: HashSet<NodeId> = HashSet::new();
		let mut twinned: HashSet<SymbolId> = HashSet::new();
		for d in self.decisions.iter().filter(|d| d.origin == Origin::Alias && d.safe && d.member_object) {
			let Some(sym) = symbol_of(nodes, scoping, d.node) else { continue };
			let use_scope = nodes.get_node(d.node).scope_id();
			let edit = if let Some(Some(name)) = definite.get(&sym)
				&& scoping.find_binding(use_scope, name).is_none()
				&& !ctx.in_with(d.span)
				&& initialized_at(sym, d, ctx)
			{
				IdentEdit::Global(name)
			} else if twin_sites.get(&sym).is_some_and(|site| site.covers(d.span)) {
				twinned.insert(sym);
				IdentEdit::Twin(scoping.symbol_name(sym).to_string())
			} else {
				continue;
			};
			out.idents.insert(d.span.start, edit);
			substituted.insert(d.node);
		}
		for sym in twinned {
			let site = &twin_sites[&sym];
			out.twins.push(Twin {
				name: scoping.symbol_name(sym).to_string(),
				decl: site.decl,
				writes: site.writes.clone(),
			});
		}

		for d in &self.decisions {
			match (d.origin, d.safe) {
				// a global the proxy would answer the same for; and a local named like a global -
				// `var self = this` - which the visitor would otherwise wrap by its name alone
				(Origin::Global | Origin::ThisAlias, true) => {
					out.idents.insert(d.span.start, IdentEdit::Keep);
				}
				// A member reached off a real object - a global left unwrapped, a local's safe use
				// read off the real one, a `this` - is real too, and is wrapped where only the proxy
				// will do. Off a local that kept the proxy it is the proxy already.
				(Origin::Derived, false) => {
					let real_root = d.root.and_then(|r| self.decision(r)).is_some_and(|rd| {
						(rd.origin == Origin::Global && rd.safe)
							|| substituted.contains(&rd.node)
							|| rd.origin == Origin::This
					});
					if real_root {
						out.wrapped_members.insert((d.span.start, d.span.end));
					}
				}
				(Origin::This, false) if ctx.options.wrap_this => match &self.this_owner[&d.node] {
					ThisOwner::Function { params, first: Some(first) }
						if !(params.start <= d.span.start && d.span.end <= params.end) =>
					{
						out.idents.insert(d.span.start, IdentEdit::ThisTemp);
						out.this_preludes.insert(*first);
					}
					// a parameter's default cannot see the body's `$t`, and a script's top level
					// has no body to declare it in
					_ => {
						out.idents.insert(d.span.start, IdentEdit::Wrap);
					}
				},
				_ => {}
			}
		}

		out
	}
}

/// The function a `this` belongs to, or the script, or nothing - a class member's, a module's.
fn this_owner_of(nodes: &AstNodes, id: NodeId, module: bool) -> Option<ThisOwner> {
	let span = span_of(nodes, id);
	for anc in nodes.ancestor_ids(id) {
		match nodes.kind(anc) {
			AstKind::Function(f) => {
				if matches!(nodes.parent_kind(anc), AstKind::MethodDefinition(_)) {
					return None;
				}
				let first = f
					.body
					.as_ref()
					.and_then(|b| b.statements.first())
					.map(|st| st.span().start);
				return Some(ThisOwner::Function { params: f.params.span, first });
			}
			AstKind::PropertyDefinition(_) | AstKind::AccessorProperty(_) | AstKind::StaticBlock(_) => {
				return None;
			}
			// `class A extends this.B` is the outer `this`; one in the body is the class's
			AstKind::Class(c) if c.body.span.start <= span.start && span.end <= c.body.span.end => {
				return None;
			}
			// a module's top level has no `this`
			AstKind::Program(_) => return (!module).then_some(ThisOwner::Script),
			_ => {}
		}
	}
	None
}

/// The local an identifier reference reads, if it reads one.
fn symbol_of(nodes: &AstNodes, scoping: &Scoping, id: NodeId) -> Option<SymbolId> {
	let AstKind::IdentifierReference(r) = nodes.kind(id) else { return None };
	scoping.get_reference(r.reference_id.get()?).symbol_id()
}

/// The global a local provably holds: the one value it is ever given, from its declaration or
/// the only call of its function, is that global or reached off it by a name that hands it back.
fn definite_name(
	sym: SymbolId,
	ctx: &Ctx,
	graph: &Graph,
	memo: &mut HashMap<SymbolId, Option<&'static str>>,
	depth: u32) -> Option<&'static str> {
	if let Some(m) = memo.get(&sym) {
		return *m;
	}
	// a cycle, or a chain of copies too long to be worth following, is not definite
	memo.insert(sym, None);
	if depth > 8 {
		return None;
	}
	let s = ctx.scoping;
	let result = (|| {
		if s.symbol_is_mutated(sym) || !s.symbol_redeclarations(sym).is_empty() {
			return None;
		}
		let flows = graph.inflows.get(&sym)?;
		if flows.len() != 1 {
			return None;
		}
		let (&src, &(kind, via)) = flows.iter().next()?;
		if !matches!(via, Via::Init | Via::Destructure | Via::ParamIife) {
			return None;
		}
		let d = graph.decision(src)?;
		// what arrives is either the root itself, or reached off it: the window again, or its
		// document
		let root = match d.origin {
			Origin::Derived => graph.decision(d.root?)?,
			_ => d,
		};
		let base = match root.origin {
			Origin::Global => match ctx.nodes.kind(root.node) {
				AstKind::IdentifierReference(r) => static_global(r.name.as_str()),
				_ => None,
			},
			Origin::Alias => {
				let rs = symbol_of(ctx.nodes, s, root.node)?;
				definite_name(rs, ctx, graph, memo, depth + 1)
			}
			_ => None,
		}?;
		let reached = via == Via::Destructure || d.origin == Origin::Derived;
		match if reached { kind } else { d.kind } {
			W if base != "document" => Some(base),
			D if reached || base == "document" => Some("document"),
			_ => None,
		}
	})();
	memo.insert(sym, result);
	result
}

/// Whether a local is certainly initialized where it is used, so that reading the global it
/// holds in its place changes nothing: a parameter always is, and a declared local is at a use
/// in the same function that comes after its declaration. Anywhere else - before it, or in a
/// function that could be called before it runs - the local might still be `undefined` or in its
/// temporal dead zone, which the global would not be, and its twin is read instead.
fn initialized_at(sym: SymbolId, d: &Decision, ctx: &Ctx) -> bool {
	let decl = ctx.scoping.symbol_declaration(sym);
	match ctx.nodes.kind(decl) {
		AstKind::FormalParameter(_) => true,
		AstKind::VariableDeclarator(v) => {
			let function_of = |id: NodeId| {
				ctx.nodes.ancestor_ids(id).find(|&a| {
					matches!(
						ctx.nodes.kind(a),
						AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_)
					)
				})
			};
			// and nothing can jump past the declaration to a use after it - `switch`, a label, a
			// loop's `continue` - so it is a statement of the function's body itself
			let statement = ctx.nodes.parent_id(decl);
			let at_body = matches!(
				ctx.nodes.parent_kind(statement),
				AstKind::FunctionBody(_) | AstKind::Program(_)
			);
			at_body && d.span.start >= v.span.end && function_of(decl) == function_of(d.node)
		}
		_ => false,
	}
}

/// The names that can stand in a substitution, as `'static` strings.
fn static_global(name: &str) -> Option<&'static str> {
	["window", "self", "globalThis", "frames", "document"]
		.into_iter()
		.find(|n| *n == name)
}

/// Where a local's twin is declared and kept up to date, and the part of the source that can see it.
struct TwinSite {
	decl: TwinDecl,
	writes: Vec<TwinWrite>,
	/// where a read of the twin sees it declared: a parameter's twin cannot be seen from the
	/// parameter list
	visible: Span,
}

impl TwinSite {
	fn covers(&self, at: Span) -> bool {
		self.visible.start <= at.start && at.end <= self.visible.end
	}
}

/// Whether a local can be given a twin: every write of it is a plain assignment, which the twin
/// can be updated beside, and it is declared somewhere a twin can be declared next to.
fn twin_site(sym: SymbolId, ctx: &Ctx) -> Option<TwinSite> {
	let s = ctx.scoping;
	let nodes = ctx.nodes;
	if !s.symbol_redeclarations(sym).is_empty() {
		return None;
	}
	let mut writes = Vec::new();
	for r in s.get_resolved_references(sym) {
		if !r.is_write() {
			continue;
		}
		// `e += x`, `e++`: the twin could be updated, but it is not worth the shapes
		if r.is_read() {
			return None;
		}
		let id = r.node_id();
		let aid = nodes.parent_id(id);
		let AstKind::AssignmentExpression(a) = nodes.kind(aid) else {
			return None;
		};
		if a.left.span() != span_of(nodes, id) || a.operator != AssignmentOperator::Assign {
			return None;
		}
		// whether anything reads the assignment's value
		let discarded = match nodes.parent_kind(aid) {
			AstKind::ExpressionStatement(_) => !is_arrow_body(nodes, nodes.parent_id(aid)),
			AstKind::SequenceExpression(q) => q.expressions.last().map(GetSpan::span) != Some(a.span),
			AstKind::ForStatement(f) => f.update.as_ref().map(GetSpan::span) == Some(a.span),
			_ => false,
		};
		writes.push(TwinWrite { start: a.span.start, end: a.span.end, discarded });
	}
	let decl = s.symbol_declaration(sym);
	let (decl, visible) = match nodes.kind(decl) {
		AstKind::VariableDeclarator(v) => {
			// `for (let d of xs)` takes a single binding, which there is no room beside, and the
			// loop writes it every iteration without a reference the twin could follow
			if matches!(
				nodes.parent_kind(nodes.parent_id(decl)),
				AstKind::ForInStatement(_) | AstKind::ForOfStatement(_)
			) {
				return None;
			}
			// the twin is visible wherever the local is: the declaration's own scope
			let scope = nodes.get_node(decl).scope_id();
			(TwinDecl::After(v.span.end), nodes.kind(s.get_node_id(scope)).span())
		}
		AstKind::FormalParameter(_) => {
			let func = nodes.parent_id(nodes.parent_id(decl));
			let body = match nodes.kind(func) {
				AstKind::Function(f) => f.body.as_ref()?,
				AstKind::ArrowFunctionExpression(f) if !f.expression => &f.body,
				_ => return None,
			};
			(TwinDecl::Prelude(body.statements.first()?.span().start), body.span)
		}
		AstKind::CatchParameter(_) => {
			let AstKind::CatchClause(c) = nodes.parent_kind(decl) else { return None };
			(TwinDecl::Prelude(c.body.body.first()?.span().start), c.body.span)
		}
		_ => return None,
	};
	Some(TwinSite { decl, writes, visible })
}

/// Whether an expression statement is an arrow's expression body - `() => e = x` - which returns
/// the expression rather than throwing it away.
fn is_arrow_body(nodes: &AstNodes, statement: NodeId) -> bool {
	let body = nodes.parent_id(statement);
	matches!(nodes.kind(body), AstKind::FunctionBody(_))
		&& matches!(nodes.parent_kind(body), AstKind::ArrowFunctionExpression(f) if f.expression)
}

/// Whether `key` names an array index, which on a window is a frame: `"0"`, never `"01"` or `"-0"`.
fn is_array_index(key: &str) -> bool {
	key.parse::<u32>().is_ok_and(|i| i != u32::MAX && i.to_string() == key)
}

/// The span of the optional chain `id` is part of, if it is part of one.
fn chain_span(nodes: &AstNodes, id: NodeId) -> Option<Span> {
	for anc in nodes.ancestor_ids(id) {
		match nodes.kind(anc) {
			AstKind::ChainExpression(c) => return Some(c.span),
			AstKind::StaticMemberExpression(_)
			| AstKind::ComputedMemberExpression(_)
			| AstKind::CallExpression(_)
			| AstKind::PrivateFieldExpression(_) => {}
			_ => return None,
		}
	}
	None
}
