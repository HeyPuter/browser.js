use std::error::Error;

use oxc::{
	allocator::{Allocator, StringBuilder},
	ast::ast::{
		AssignmentExpression, AssignmentTarget, AssignmentTargetMaybeDefault,
		AssignmentTargetProperty, AssignmentTargetPropertyIdentifier, BindingPattern,
		BindingPatternKind, BindingProperty, CallExpression, ComputedMemberExpression,
		DebuggerStatement, ExportAllDeclaration, ExportNamedDeclaration, Expression, ForStatement,
		ForStatementInit, ForStatementLeft, FormalParameter, FunctionBody, IdentifierReference,
		ImportDeclaration, ImportExpression, MemberExpression, MetaProperty, NewExpression,
		ObjectAssignmentTarget, ObjectExpression, ObjectPattern, ObjectPropertyKind,
		PrivateIdentifier, PropertyKey, ReturnStatement, SimpleAssignmentTarget, Statement,
		StringLiteral, ThisExpression, UnaryExpression, UnaryOperator, UpdateExpression,
		VariableDeclaration, VariableDeclarationKind, VariableDeclarator,
	},
	ast_visit::{Visit, walk},
	span::{Atom, GetSpan, Span},
};

use crate::{
	cfg::{Config, Flags, UrlRewriter},
	changes::JsChanges,
	rewrite::rewrite,
};

// js MUST not be able to get a reference to any of these because sbx
//
// maybe move this out of this lib?
const UNSAFE_GLOBALS: &[&str] = &[
	"window",
	"self",
	"globalThis",
	"this",
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
}

impl<'data, E> Visitor<'_, 'data, E>
where
	E: UrlRewriter,
{
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

	fn rewrite_ident(&mut self, name: &Atom, span: Span) {
		if UNSAFE_GLOBALS.contains(&name.as_str()) {
			self.jschanges.add(rewrite!(span, WrapFn { enclose: true }));
		}
	}

	fn walk_member_expression(&mut self, it: &Expression) -> bool {
		match it {
			Expression::Identifier(s) => {
				self.rewrite_ident(&s.name, s.span);
				true
			}
			Expression::StaticMemberExpression(s) => self.walk_member_expression(&s.object),
			Expression::ComputedMemberExpression(s) => self.walk_member_expression(&s.object),
			_ => false,
		}
	}

	fn scramitize(&mut self, span: Span) {
		self.jschanges.add(rewrite!(span, Scramitize));
	}
}

impl<'data, E> Visit<'data> for Visitor<'_, 'data, E>
where
	E: UrlRewriter,
{
	fn visit_identifier_reference(&mut self, it: &IdentifierReference) {
		if UNSAFE_GLOBALS.contains(&it.name.as_str()) {
			self.jschanges
				.add(rewrite!(it.span, WrapFn { enclose: false }));
		}
	}

	fn visit_new_expression(&mut self, it: &NewExpression<'data>) {
		// match &it.callee {
		// 	Expression::StaticMemberExpression(_) | Expression::Identifier(_) => {
		// 		// new top(), new location.top(), etc
		// 		// rewriting to new $wrap(location).top() WILL change semantics
		// 		// so it has to be wrapped to new ($wrap(location).top)()
		// 		// TODO: skip paren wrap if it's determined to be safe
		// 		self.jschanges.add(rewrite!(it.callee.span(), WrapNew));
		// 		walk::walk_expression(self, &it.callee);
		// 	}
		// 	Expression::ComputedMemberExpression(c) => {
		// 		walk::walk_expression(self, &c.expression);
		// 	}
		// 	_=>{
		// 		// any other kind of expression
		// 		// new (f(location))()
		// 		walk::walk_expression(self, &it.callee);
		// 	}
		// }
		// walk::walk_arguments(self, &it.arguments);
	}

	fn visit_member_expression(&mut self, it: &MemberExpression<'data>) {
		// TODO
		// you could break this with ["postMessage"] etc
		// however this code only exists because of recaptcha whatever
		// and it would slow down js execution a lot
		if let MemberExpression::StaticMemberExpression(s) = it {
			if s.property.name == "postMessage" {
				// self.jschanges.add(rewrite!(s.property.span, SetRealmFn));

				walk::walk_expression(self, &s.object);
				return; // unwise to walk the rest of the tree
			}

			if !self.flags.strict_rewrites
				&& !UNSAFE_GLOBALS.contains(&s.property.name.as_str())
				&& let Expression::Identifier(_) | Expression::ThisExpression(_) = &s.object
			{
				// cull tree - this should be safe
				return;
			}

			if self.flags.scramitize
				&& !matches!(s.object, Expression::MetaProperty(_) | Expression::Super(_))
			{
				self.scramitize(s.object.span());
			}
		}

		walk::walk_member_expression(self, it);
	}

	fn visit_this_expression(&mut self, it: &ThisExpression) {
		self.jschanges.add(rewrite!(it.span, WrapThisFn));
	}

	fn visit_debugger_statement(&mut self, it: &DebuggerStatement) {
		// delete debugger statements entirely. some sites will spam debugger as an anti-debugging measure, and we don't want that!
		self.jschanges.add(rewrite!(it.span, Delete));
	}

	// we can't overwrite window.eval in the normal way because that would make everything an
	// indirect eval, which could break things. we handle that edge case here
	fn visit_call_expression(&mut self, it: &CallExpression<'data>) {
		if let Expression::Identifier(s) = &it.callee {
			// if it's optional that actually makes it an indirect eval which is handled separately
			if s.name == "eval" && !it.optional {
				self.jschanges.add(rewrite!(
					it.span,
					Eval {
						inner: Span::new(s.span.end + 1, it.span.end - 1),
					}
				));

				// then we walk the arguments, but not the callee, since we want it to resolve to
				// the real eval
				walk::walk_arguments(self, &it.arguments);
				return;
			}
		}
		if self.flags.scramitize {
			self.scramitize(it.span);
		}
		walk::walk_call_expression(self, it);
	}

	fn visit_import_declaration(&mut self, it: &ImportDeclaration<'data>) {
		let str = it.source.to_string();
		if str.contains(":")
			|| str.starts_with("/")
			|| str.starts_with(".")
			|| str.starts_with("..")
		{
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
		// do not walk further, we don't want to rewrite the identifiers
	}

	fn visit_try_statement(&mut self, it: &oxc::ast::ast::TryStatement<'data>) {
		// for debugging we need to know what the error was

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
		for prop in &it.properties {
			if let ObjectPropertyKind::ObjectProperty(p) = prop
				&& let Expression::Identifier(s) = &p.value
				&& UNSAFE_GLOBALS.contains(&s.name.to_string().as_str())
				&& p.shorthand
			{
				self.jschanges
					.add(rewrite!(s.span, ShorthandObj { name: s.name }));
				return;
			}
		}

		walk::walk_object_expression(self, it);
	}

	fn visit_function_body(&mut self, it: &FunctionBody<'data>) {
		// tag function for use in sourcemaps

		if self.flags.do_sourcemaps {
			self.jschanges
				.add(rewrite!(Span::new(it.span.start, it.span.start), SourceTag));
		}

		walk::walk_function_body(self, it);
	}

	fn visit_unary_expression(&mut self, it: &UnaryExpression<'data>) {
		if matches!(it.operator, UnaryOperator::Typeof) {
			match it.argument {
				Expression::Identifier(_) => {
					// `typeof location` -> `typeof $wrap(location)` seems like a sane rewrite but it's incorrect
					// typeof has the special property of not caring whether the identifier is undefined
					// and this won't escape anyway, so don't rewrite
					return;
				}
				_ => {
					// `typeof (location)` / `typeof location.href` / `typeof function()`
					// this is safe to rewrite
				}
			}
		}
		walk::walk_unary_expression(self, it);
	}

	fn visit_update_expression(&mut self, it: &UpdateExpression<'data>) {
		// this is like a ++ or -- operator
		match it.argument {
			SimpleAssignmentTarget::AssignmentTargetIdentifier(_) => {
				// if it's an identifier we cannot rewrite it
				// $wrap(location)++ is invalid syntax

				// so it's safer to assume that this "location" is a local
				// even if it's real location you can't escape with it anyway
				// unless you consider navigating to "https://proxy.com/NaN" escaping
				return;
			}
			_ => {}
		}

		// if it's not a simple identifier it's probably a member expression which is safe
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
				// location = ...
				// location is the only unsafe global that has a setter
				if &s.name == "location" {
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
			AssignmentTarget::ArrayAssignmentTarget(a) => {
				// not worth the edge case
				return;
			}
			_ => {
				walk::walk_assignment_target(self, &it.left);
			}
		}
		walk::walk_expression(self, &it.right);
	}
}
