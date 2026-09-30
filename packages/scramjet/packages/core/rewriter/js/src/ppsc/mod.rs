//! The `ppsc` visitor.
//!
//! Where `dpsc` rewrites the *key* of every member access that could name something unsafe, this
//! one rewrites only the *references* to the globals, handing back a `Proxy` for the window and the
//! document whose traps answer the unsafe names. No member access has to be touched for that - but
//! every read through a proxy pays for its trap, so [`elide`] works out where a reference can be
//! left as the real object after all, and this visitor applies what it found.
//!
//! The runtime half is `client/global.ts` (the proxies) and `client/shared/unproxy.ts` (putting a
//! proxy right where a native is handed one).

pub mod elide;

use std::{collections::BTreeMap, error::Error};

use oxc::{
	allocator::{Allocator, StringBuilder},
	ast::ast::{
		AssignmentExpression, AssignmentTarget, AssignmentTargetMaybeDefault,
		AssignmentTargetProperty, CallExpression, DebuggerStatement, ExportAllDeclaration,
		ExportNamedDeclaration, Expression, FunctionBody, IdentifierReference, ImportDeclaration,
		ImportExpression, MemberExpression, MetaProperty, NewExpression, ObjectExpression,
		ObjectPropertyKind, Program, SimpleAssignmentTarget, StringLiteral, ThisExpression,
		TryStatement, UnaryExpression, UnaryOperator, UpdateExpression,
	},
	ast_visit::{Visit, walk},
	span::{GetSpan, Span},
};

use self::elide::{Elision, IdentEdit, TwinDecl};
use crate::{
	cfg::{Config, Flags, UrlRewriter},
	changes::JsChanges,
	rewrite::rewrite,
};

/// What the proxies stand in for. Wider than `dpsc`'s list: the whole point is that a reference
/// to the global object is replaced, so that everything reached through it is too.
const UNSAFE_GLOBALS: &[&str] = &[
	"window",
	"self",
	"globalThis",
	"parent",
	"top",
	"location",
	"document",
	"eval",
	"frames",
];

pub struct Visitor<'alloc, 'data, E>
where
	E: UrlRewriter,
{
	pub alloc: &'alloc Allocator,
	pub jschanges: JsChanges<'alloc, 'data>,
	pub error: Option<Box<dyn Error + Sync + Send>>,

	pub config: &'data Config,
	pub rewriter: &'data E,
	pub flags: Flags,

	pub elision: Elision,
}

impl<'alloc, 'data, E> Visitor<'alloc, 'data, E>
where
	E: UrlRewriter,
{
	fn text(&self, s: &str) -> &'alloc str {
		self.alloc.alloc_str(s)
	}

	fn is_global_name(name: &str) -> bool {
		UNSAFE_GLOBALS.contains(&name)
	}

	/// The changes that sit at no one node the walk visits: the twins' declarations, the
	/// assignments that keep them up to date, and the `$t` preludes. The changes are sorted before
	/// they are made, so where they are added from does not matter.
	fn add_inserts(&mut self) {
		let Config { unwrapfn: unwrap, realsuffix: suffix, .. } = self.config;
		let mut decls: BTreeMap<u32, String> = BTreeMap::new();
		let mut preludes: BTreeMap<u32, String> = BTreeMap::new();
		// Assignments nest - `a = b = x` - and their ends can meet, so what opens and closes at each
		// place is put together here, in order: outermost first where they open, innermost first
		// where they close.
		let mut opens: BTreeMap<u32, Vec<(u32, String)>> = BTreeMap::new();
		let mut closes: BTreeMap<u32, Vec<(u32, String)>> = BTreeMap::new();

		for twin in &self.elision.twins {
			let n = &twin.name;
			match twin.decl {
				TwinDecl::After(at) => {
					decls.entry(at).or_default().push_str(&format!(",{n}{suffix}={unwrap}({n})"));
				}
				TwinDecl::Prelude(at) => {
					preludes
						.entry(at)
						.or_default()
						.push_str(&format!("var {n}{suffix}={unwrap}({n});"));
				}
			}
			for w in &twin.writes {
				// `e = x` becomes `e$r=$unwrap(e = x)` where its value is thrown away, and
				// `(e$r=$unwrap(e = x),e)` where it is not
				let (open, close) = if w.discarded {
					(format!("{n}{suffix}={unwrap}("), ")".to_string())
				} else {
					(format!("({n}{suffix}={unwrap}("), format!("),{n})"))
				};
				opens.entry(w.start).or_default().push((w.end, open));
				closes.entry(w.end).or_default().push((w.start, close));
			}
		}
		for &at in &self.elision.this_preludes {
			let Config { tempthisid: t, rawwindowid: rw, rawdocumentid: rd, wrapfn, .. } = self.config;
			// only the window and the document need the call, and `this` is almost never either:
			// the two it is compared against are constants to the engine
			preludes
				.entry(at)
				.or_default()
				.push_str(&format!("var {t}=this==={rw}||this==={rd}?{wrapfn}(this):this;"));
		}

		for (at, text) in decls {
			let text = self.text(&text);
			self.jschanges.add(rewrite!(Span::new(at, at), Insert { text }));
		}
		for (at, text) in preludes {
			let text = self.text(&text);
			self.jschanges.add(rewrite!(Span::new(at, at), Prelude { text }));
		}
		for (at, mut v) in opens {
			v.sort_by(|a, b| b.0.cmp(&a.0));
			let text = self.text(&v.into_iter().map(|x| x.1).collect::<String>());
			self.jschanges.add(rewrite!(Span::new(at, at), Insert { text }));
		}
		for (at, mut v) in closes {
			v.sort_by(|a, b| b.0.cmp(&a.0));
			let text = self.text(&v.into_iter().map(|x| x.1).collect::<String>());
			self.jschanges.add(rewrite!(Span::new(at, at), Insert { text }));
		}
	}

	fn rewrite_url(&mut self, url: &StringLiteral<'data>, module: bool) {
		let mut builder = StringBuilder::from_str_in(&self.config.prefix, self.alloc);
		if self.error.is_some() {
			builder.push_str("__URL_REWRITER_ALREADY_ERRORED__");
		} else if let Err(err) =
			self.rewriter
				.rewrite(self.config, &self.flags, &url.value, &mut builder, module)
		{
			self.error.replace(err);
			builder.push_str("__URL_REWRITER_ERROR__");
		}
		let text = builder.into_str();

		self.jschanges
			.add(rewrite!(url.span.shrink(1), Replace { text }));
	}

	/// The objects of the members a destructuring assignment writes to, and its defaults and
	/// computed keys - everything in it that is an expression, and none of the names it binds,
	/// which `$wrap(name) = ...` could not.
	fn walk_pattern_target(&mut self, target: &AssignmentTarget<'data>) {
		match target {
			AssignmentTarget::ArrayAssignmentTarget(a) => {
				for el in a.elements.iter().flatten() {
					self.walk_pattern_maybe_default(el);
				}
				if let Some(r) = &a.rest {
					self.walk_pattern_target(&r.target);
				}
			}
			AssignmentTarget::ObjectAssignmentTarget(o) => {
				for p in &o.properties {
					match p {
						AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(p) => {
							if let Some(init) = &p.init {
								self.visit_expression(init);
							}
						}
						AssignmentTargetProperty::AssignmentTargetPropertyProperty(p) => {
							if p.computed
								&& let Some(key) = p.name.as_expression()
							{
								self.visit_expression(key);
							}
							self.walk_pattern_maybe_default(&p.binding);
						}
					}
				}
				if let Some(r) = &o.rest {
					self.walk_pattern_target(&r.target);
				}
			}
			AssignmentTarget::AssignmentTargetIdentifier(_) => {}
			other => {
				if let Some(m) = other.as_member_expression() {
					self.visit_member_expression(m);
				}
			}
		}
	}

	fn walk_pattern_maybe_default(&mut self, t: &AssignmentTargetMaybeDefault<'data>) {
		match t {
			AssignmentTargetMaybeDefault::AssignmentTargetWithDefault(d) => {
				self.walk_pattern_target(&d.binding);
				self.visit_expression(&d.init);
			}
			other => {
				if let Some(t) = other.as_assignment_target() {
					self.walk_pattern_target(t);
				}
			}
		}
	}
}

impl<'data, E> Visit<'data> for Visitor<'_, 'data, E>
where
	E: UrlRewriter,
{
	fn visit_program(&mut self, it: &Program<'data>) {
		self.add_inserts();
		walk::walk_program(self, it);
	}

	fn visit_identifier_reference(&mut self, it: &IdentifierReference) {
		match self.elision.idents.get(&it.span.start) {
			Some(IdentEdit::Global(name)) => {
				self.jschanges
					.add(rewrite!(it.span, Replace { text: name }));
			}
			Some(IdentEdit::Twin(name)) => {
				let text = self.text(&format!("{name}{}", self.config.realsuffix));
				self.jschanges.add(rewrite!(it.span, Replace { text }));
			}
			Some(_) => {}
			// every other reference to a global, and any local named like one, is the proxy
			None if Self::is_global_name(&it.name) => {
				self.jschanges
					.add(rewrite!(it.span, WrapFn { enclose: false }));
			}
			None => {}
		}
	}

	fn visit_this_expression(&mut self, it: &ThisExpression) {
		match self.elision.idents.get(&it.span.start) {
			Some(IdentEdit::ThisTemp) => {
				let text = self.text(&self.config.tempthisid);
				self.jschanges.add(rewrite!(it.span, Replace { text }));
			}
			Some(IdentEdit::Wrap) => {
				self.jschanges
					.add(rewrite!(it.span, WrapFn { enclose: false }));
			}
			_ => {}
		}
	}

	fn visit_new_expression(&mut self, it: &NewExpression<'data>) {
		match &it.callee {
			Expression::StaticMemberExpression(_) | Expression::Identifier(_) => {
				self.jschanges.add(rewrite!(it.callee.span(), WrapNew));
				walk::walk_expression(self, &it.callee);
			}
			Expression::ComputedMemberExpression(c) => {
				walk::walk_expression(self, &c.expression);
			}
			_ => walk::walk_expression(self, &it.callee),
		}
		walk::walk_arguments(self, &it.arguments);
	}

	fn visit_member_expression(&mut self, it: &MemberExpression<'data>) {
		// `hybrid`: an unsafe name read statically, renamed to the accessor that answers it
		match it {
			MemberExpression::StaticMemberExpression(m)
				if self.elision.renames.contains(&m.property.span.start) =>
			{
				self.jschanges.add(rewrite!(
					m.property.span,
					RewriteProperty { ident: m.property.name }
				));
			}
			MemberExpression::ComputedMemberExpression(m) => {
				if let Expression::StringLiteral(l) = &m.expression
					&& self.elision.renames.contains(&(l.span.start + 1))
				{
					self.jschanges
						.add(rewrite!(l.span.shrink(1), RewriteProperty { ident: l.value }));
				}
			}
			_ => {}
		}

		// `w.document` reached off a real window and used where only the proxy will do
		let span = it.span();
		if self.elision.wrapped_members.contains(&(span.start, span.end)) {
			self.jschanges
				.add(rewrite!(span, WrapFn { enclose: false }));
		}

		// Cull the tree: `name.safe` and `this.safe` have nothing to change - unless the object
		// is a global (`location.href` reads a safe name off the proxy it has to be), or has an
		// edit of its own (a local read off its twin, a `this` read from `$t`).
		if let MemberExpression::StaticMemberExpression(s) = it
			&& !Self::is_global_name(&s.property.name)
		{
			let cullable = match &s.object {
				Expression::Identifier(i) => {
					!Self::is_global_name(&i.name) && !self.elision.idents.contains_key(&i.span.start)
				}
				Expression::ThisExpression(t) => !self.elision.idents.contains_key(&t.span.start),
				_ => false,
			};
			if cullable {
				return;
			}
		}

		walk::walk_member_expression(self, it);
	}

	fn visit_debugger_statement(&mut self, it: &DebuggerStatement) {
		self.jschanges.add(rewrite!(it.span, Delete));
	}

	fn visit_call_expression(&mut self, it: &CallExpression<'data>) {
		if let Expression::Identifier(s) = &it.callee
			&& s.name == "eval"
			&& !it.optional
		{
			self.jschanges.add(rewrite!(
				it.span,
				Eval {
					inner: Span::new(s.span.end + 1, it.span.end - 1),
				}
			));

			walk::walk_arguments(self, &it.arguments);
			return;
		}
		walk::walk_call_expression(self, it);
	}

	fn visit_import_declaration(&mut self, it: &ImportDeclaration<'data>) {
		let str = it.source.to_string();
		if str.contains(':') || str.starts_with('/') || str.starts_with('.') {
			self.rewrite_url(&it.source, true);
		}
		walk::walk_import_declaration(self, it);
	}

	fn visit_import_expression(&mut self, it: &ImportExpression<'data>) {
		self.jschanges.add(rewrite!(
			Span::new(it.span.start, it.span.start + 7),
			ImportFn
		));
		walk::walk_import_expression(self, it);
	}

	fn visit_export_all_declaration(&mut self, it: &ExportAllDeclaration<'data>) {
		self.rewrite_url(&it.source, true);
	}

	fn visit_export_named_declaration(&mut self, it: &ExportNamedDeclaration<'data>) {
		if let Some(source) = &it.source {
			self.rewrite_url(source, true);
		}
		if let Some(declaration) = &it.declaration {
			self.visit_declaration(declaration);
		}
	}

	fn visit_try_statement(&mut self, it: &TryStatement<'data>) {
		if self.flags.capture_errors
			&& let Some(h) = &it.handler
			&& let Some(name) = &h.param
			&& let Some(ident) = name.pattern.get_identifier_name()
		{
			let start = h.body.span.start + 1;
			self.jschanges
				.add(rewrite!(Span::new(start, start), ScramErr { ident }));
		}

		walk::walk_try_statement(self, it);
	}

	fn visit_object_expression(&mut self, it: &ObjectExpression<'data>) {
		// every property is walked: a shorthand global is written out as `window: $wrap(window)`,
		// and the rest of the literal still has to be visited - `{window, b: document.location}`
		for prop in &it.properties {
			if let ObjectPropertyKind::ObjectProperty(p) = prop
				&& let Expression::Identifier(s) = &p.value
				&& p.shorthand
			{
				if Self::is_global_name(&s.name) && !self.elision.idents.contains_key(&s.span.start) {
					self.jschanges
						.add(rewrite!(s.span, ShorthandObj { name: s.name }));
				}
				continue;
			}
			self.visit_object_property_kind(prop);
		}
	}

	fn visit_function_body(&mut self, it: &FunctionBody<'data>) {
		if self.flags.do_sourcemaps {
			self.jschanges
				.add(rewrite!(Span::new(it.span.start, it.span.start), SourceTag));
		}

		walk::walk_function_body(self, it);
	}

	fn visit_unary_expression(&mut self, it: &UnaryExpression<'data>) {
		// `typeof x` does not care whether x is defined, and cannot escape
		if matches!(it.operator, UnaryOperator::Typeof) && matches!(it.argument, Expression::Identifier(_)) {
			return;
		}
		walk::walk_unary_expression(self, it);
	}

	fn visit_update_expression(&mut self, it: &UpdateExpression<'data>) {
		// `$wrap(ident)++` is not valid syntax
		if matches!(it.argument, SimpleAssignmentTarget::AssignmentTargetIdentifier(_)) {
			return;
		}
		walk::walk_update_expression(self, it);
	}

	fn visit_meta_property(&mut self, it: &MetaProperty<'data>) {
		if it.meta.name == "import" {
			self.jschanges.add(rewrite!(it.span, MetaFn));
		}
	}

	fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'data>) {
		match &it.left {
			AssignmentTarget::AssignmentTargetIdentifier(s) => {
				// `location` is the only one of them with a setter
				if s.name == "location" {
					self.jschanges.add(rewrite!(
						it.span,
						Assignment {
							name: s.name,
							rhs: it.right.span(),
							op: it.operator,
						}
					));
				}
			}
			// a destructuring assignment binds names this visitor never rewrites, but a member it
			// assigns to is read off an object like any other: `({a: window.location} = o)`
			AssignmentTarget::ArrayAssignmentTarget(_) | AssignmentTarget::ObjectAssignmentTarget(_) => {
				self.walk_pattern_target(&it.left);
			}
			_ => walk::walk_assignment_target(self, &it.left),
		}
		walk::walk_expression(self, &it.right);
	}
}
