//! Incumbency call stamping, shared by both visitors.
//!
//! Under `stamp`, and under `lazystamp` for a call that names `postMessage`, a call is rewritten into
//! a `callfn` call, which records the realm making it: what `postMessage` reads its source, origin
//! and default target origin off. See `client/shared/incumbency.ts`.

use oxc::{
	ast::ast::{CallExpression, ChainElement, Expression, MemberExpression},
	span::{GetSpan, Span},
};

use crate::{
	cfg::{Flags, IncumbencyMode},
	changes::{CallReceiver, JsChanges},
	rewrite::rewrite,
};

/// Whether evaluating `expr` can short circuit the optional chain it is part of: a `?.` anywhere in it that is
/// not behind parentheses, which end a chain.
fn short_circuits(expr: &Expression) -> bool {
	match expr {
		Expression::StaticMemberExpression(m) => m.optional || short_circuits(&m.object),
		Expression::ComputedMemberExpression(c) => c.optional || short_circuits(&c.object),
		Expression::PrivateFieldExpression(p) => p.optional || short_circuits(&p.object),
		Expression::CallExpression(c) => c.optional || short_circuits(&c.callee),
		_ => false,
	}
}

/// Whether `lazystamp` records the realm for a call to `callee`: one that names `postMessage` as it is written.
/// That is the whole of what makes it lazy - a computed key only counts when it is a literal spelling the name.
fn names_post_message(callee: &Expression) -> bool {
	let is_name = |key: &Expression| match key.get_inner_expression() {
		Expression::StringLiteral(s) => s.value == "postMessage",
		Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
			t.quasis.first().and_then(|q| q.value.cooked.as_ref()).is_some_and(|c| c == "postMessage")
		}
		_ => false,
	};

	match callee.get_inner_expression() {
		Expression::Identifier(s) => s.name == "postMessage",
		Expression::StaticMemberExpression(m) => m.property.name == "postMessage",
		Expression::ComputedMemberExpression(c) => is_name(&c.expression),
		Expression::ChainExpression(chain) => match &chain.expression {
			ChainElement::StaticMemberExpression(m) => m.property.name == "postMessage",
			ChainElement::ComputedMemberExpression(c) => is_name(&c.expression),
			_ => false,
		},
		_ => false,
	}
}

#[derive(Debug, Default)]
pub(crate) struct Stamper {
	/// how many `with` bodies the visitor is inside, where a bare `f()` may be called with the `with` object as
	/// its receiver - which is not known until it runs
	pub with_depth: u32,
	/// the members a stamped call has split into a receiver and a lookup, whose links its own rewrite owns
	split_members: Vec<Span>,
}

impl Stamper {
	/// Whether `call` is rewritten into a `callfn` call - which takes it out of any chain it is part of.
	pub fn stamps(&self, flags: &Flags, call: &CallExpression) -> bool {
		let should_stamp = match &flags.incumbency {
			IncumbencyMode::Stamp => true,
			IncumbencyMode::LazyStamp => names_post_message(&call.callee),
			_ => false,
		};
		if !should_stamp {
			return false;
		}

		match call.callee.get_inner_expression() {
			// a direct eval is rewritten as one
			Expression::Identifier(s) if s.name == "eval" && !call.optional => false,
			Expression::Identifier(_) => self.with_depth == 0,
			Expression::Super(_) | Expression::PrivateFieldExpression(_) => false,
			Expression::ChainExpression(c) => !matches!(c.expression, ChainElement::PrivateFieldExpression(_)),
			_ => true,
		}
	}

	/// Whether `object` is a stamped call that can short circuit. Its rewrite ends the chain it was part of, so the
	/// link after it has to short circuit on its own: when the call evaluates to `undefined`, so does the rest of
	/// the chain. That also happens if the call itself returns null or undefined, where the chain would have gone
	/// on and thrown
	fn short_circuited_call(&self, flags: &Flags, object: &Expression) -> bool {
		matches!(object, Expression::CallExpression(c) if self.stamps(flags, c)) && short_circuits(object)
	}

	/// The rewrite for a call, if it is stamped; the caller walks the call as it otherwise would.
	pub fn call<'alloc: 'data, 'data>(
		&mut self,
		flags: &Flags,
		jschanges: &mut JsChanges<'alloc, 'data>,
		it: &CallExpression<'data>,
	) {
		let should_stamp = match &flags.incumbency {
			IncumbencyMode::Stamp => true,
			IncumbencyMode::LazyStamp => names_post_message(&it.callee),
			_ => false,
		};

		if should_stamp {
			let args = it.arguments_span();
			let callee = it.callee.get_inner_expression();
			// `(a?.b)()` is still a call of `a.b` with `a` as its receiver. It is not part of the chain, though: when
			// the chain short circuits, the call is of `undefined`
			let (member, throws) = match callee {
				Expression::ComputedMemberExpression(c) => {
					(Some((&c.object, c.expression.span(), c.optional, true)), false)
				}
				Expression::StaticMemberExpression(m) => {
					(Some((&m.object, m.property.span(), m.optional, false)), false)
				}
				Expression::ChainExpression(chain) => match &chain.expression {
					ChainElement::ComputedMemberExpression(c) => {
						(Some((&c.object, c.expression.span(), c.optional, true)), !it.optional)
					}
					ChainElement::StaticMemberExpression(m) => {
						(Some((&m.object, m.property.span(), m.optional, false)), !it.optional)
					}
					_ => (None, false),
				},
				_ => (None, false),
			};
			let private = matches!(callee, Expression::PrivateFieldExpression(_))
				|| matches!(callee, Expression::ChainExpression(c) if matches!(c.expression, ChainElement::PrivateFieldExpression(_)));

			match member {
				// `super.m()` looks the method up on the home object but calls it with the `this` already in scope,
				// and `super` is a keyword that cannot be parked in a temp. `super.m` does read as a value though,
				// so hand the lookup over whole and name the receiver directly
				Some((object, ..))
					if matches!(object.get_inner_expression(), Expression::Super(_)) =>
				{
					jschanges.add(rewrite!(it.span, LiteralCallFn {
						args,
						inner: it.callee.span(),
						receiver: CallReceiver::This,
						optional_call: it.optional,
					}))
				}
				Some((object, expression, optional, computed)) => {
					// splitting the callee into a receiver and a lookup loses the short circuit a `?.` further up
					// the chain would have done, so every one of them gets a nullish check of its own
					let mut guards = 0;
					let mut link = object.get_inner_expression();
					loop {
						let (inner, property, optional, computed) = match link {
							Expression::ComputedMemberExpression(c) => {
								(&c.object, c.expression.span(), c.optional, true)
							}
							Expression::StaticMemberExpression(m) => {
								(&m.object, m.property.span(), m.optional, false)
							}
							_ => break,
						};
						self.split_members.push(link.span());
						if optional || self.short_circuited_call(flags, inner) {
							let gap = Span::new(inner.span().end, property.start);
							jschanges.add(rewrite!(gap, ChainGuard { computed, throws }));
							guards += 1;
						}
						link = inner.get_inner_expression();
					}

					self.split_members.push(callee.span());
					jschanges.add(rewrite!(it.span, MemberCallFn {
						args,
						object: object.span(),
						expression,
						optional: optional || self.short_circuited_call(flags, object),
						computed,
						optional_call: it.optional,
						guards,
						throws,
					}))
				}
				// even if you set `this.#p()` to a native method, it will always throw illegal invocation or a typeerror
				// if you ever use this for something other than incumbency stamping this must be handled properly
				None if private => {}
				// `super()` runs the parent constructor rather than calling a function value, and `super` does not
				// read as one - there is nothing here to hand to `callfn`
				None if matches!(callee, Expression::Super(_)) => {}
				// inside `with`, a bare `f()` is called with the `with` object as its receiver if that is where `f`
				// was found, which only the running code knows
				None if self.with_depth > 0 && matches!(callee, Expression::Identifier(_)) => {}
				// anything else is called with no receiver of its own
				None => jschanges.add(rewrite!(it.span, LiteralCallFn {
					args,
					inner: it.callee.span(),
					receiver: CallReceiver::Undefined,
					optional_call: it.optional || self.short_circuited_call(flags, &it.callee),
				})),
			}
		} else if !it.optional && self.short_circuited_call(flags, &it.callee) {
			// the call's opening paren, up to its first argument or its closing paren
			let end = it.arguments.first().map_or(it.span.end - 1, |a| a.span().start);
			jschanges.add(rewrite!(
				Span::new(it.callee.span().end, end),
				OptionalLink { opener: "?.(" }
			));
		}
	}

	/// A member read off a stamped call that can short circuit: its rewrite ended the chain, so the
	/// member has to short circuit on its own.
	pub fn member<'alloc: 'data, 'data>(
		&self,
		flags: &Flags,
		jschanges: &mut JsChanges<'alloc, 'data>,
		it: &MemberExpression<'data>,
	) {
		if !it.optional() && !self.split_members.contains(&it.span()) && self.short_circuited_call(flags, it.object()) {
			let object_end = it.object().span().end;
			let (end, opener) = match &it {
				MemberExpression::StaticMemberExpression(s) => (s.property.span.start, "?."),
				MemberExpression::ComputedMemberExpression(c) => (c.expression.span().start, "?.["),
				MemberExpression::PrivateFieldExpression(p) => (p.field.span.start, "?."),
			};
			jschanges.add(rewrite!(Span::new(object_end, end), OptionalLink { opener }));
		}
	}
}
