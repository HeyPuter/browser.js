use oxc::{
	ast::ast::AssignmentOperator,
	span::{Atom, Span},
};
use smallvec::{SmallVec, smallvec};

use crate::changes::{JsChange, change};

macro_rules! rewrite {
    ($span:expr, $($ty:tt)*) => {
		$crate::rewrite::Rewrite::new($span, $crate::rewrite::RewriteType::$($ty)*)
    };
}
pub(crate) use rewrite;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RewriteType<'alloc: 'data, 'data> {
	/// `(cfg.wrapfn(ident))` | `cfg.wrapfn(ident)`
	WrapFn {
		enclose: bool,
	},
	/// `cfg.setrealmfn({}).ident`
	SetRealmFn,

	/// `(cfg.importfn("cfg.base"))`
	ImportFn,
	/// `cfg.metafn("cfg.base")`
	MetaFn,

	/// `window.attr` -> cfg.wrapattr(window)
	WrapGet {
		ident: Atom<'data>,
		propspan: Span,
		enclose: bool,
	},
	/// `window["attr"]` -> cfg.wrapgetcomputed(window, "attr")
	WrapGetComputed {
		leftspan: Span,
		propspan: Span,
		enclose: bool,
	},
	/// `window.attr` -> cfg.wrapattr(window)
	WrapSet {
		ident: Atom<'data>,
		propspan: Span,
		leftspan: Span,
		rightspan: Span,
	},
	/// `cfg.wrapcomputedsetfn(window, "attr", t)`
	WrapSetComputed {
		propspan: Span,
		leftspan: Span,
		rightspan: Span,
	},
	// dead code only if debug is disabled
	#[allow(dead_code)]
	/// `$scramerr(name)`
	ScramErr {
		ident: Atom<'data>,
	},
	/// `$scramitize(span)`
	Scramitize,

	/// `eval(cfg.rewritefn(inner))`
	Eval {
		inner: Span,
	},
	/// `((t)=>$scramjet$tryset(name,"op",t)||(name op t))(rhs)`
	Assignment {
		name: Atom<'data>,
		rhs: Span,
		op: AssignmentOperator,
	},
	/// `ident,` -> `ident: cfg.wrapfn(ident),`
	ShorthandObj {
		name: Atom<'data>,
	},
	SourceTag,

	// don't use for anything static, only use for stuff like rewriteurl
	Replace {
		text: &'alloc str,
	},
	Delete,
}

#[derive(Debug)]
pub(crate) struct Rewrite<'alloc, 'data> {
	span: Span,
	ty: RewriteType<'alloc, 'data>,
}

impl<'alloc: 'data, 'data> Rewrite<'alloc, 'data> {
	pub fn new(span: Span, ty: RewriteType<'alloc, 'data>) -> Self {
		Self { span, ty }
	}

	pub fn into_inner(self) -> SmallVec<[JsChange<'alloc, 'data>; 2]> {
		self.ty.into_inner(self.span)
	}
}

impl<'alloc: 'data, 'data> RewriteType<'alloc, 'data> {
	fn into_inner(self, span: Span) -> SmallVec<[JsChange<'alloc, 'data>; 2]> {
		macro_rules! span {
			(start) => {
				Span::new(span.start, span.start)
			};
			(end) => {
				Span::new(span.end, span.end)
			};
			($span1:ident $span2:ident start) => {
				Span::new($span1.start, $span2.start)
			};
			($span1:ident $span2:ident end) => {
				Span::new($span1.end, $span2.end)
			};
			($span1:ident $span2:ident between) => {
				Span::new($span1.end, $span2.start)
			};
		}

		match self {
			Self::WrapFn { enclose } => smallvec![
				change!(span!(start), WrapFnLeft { enclose }),
				change!(span!(end), WrapFnRight { enclose }),
			],
			Self::WrapGet {
				ident,
				propspan,
				enclose,
			} => smallvec![
				change!(span!(start), WrapGetLeft { ident, enclose }),
				change!(propspan.expand_left(1), WrapGetRight { enclose }),
			],
			Self::WrapGetComputed {
				leftspan,
				propspan,
				enclose,
			} => smallvec![
				change!(span!(start), WrapGetComputedLeft { enclose }),
				// replace the bracket with ,
				change!(span!(leftspan propspan between), Replace { text: "," }),
				// replace the other bracket with )
				change!(
					propspan.expand_right(1),
					ClosingParen {
						semi: false,
						replace: true
					}
				),
			],
			Self::WrapSet {
				ident,
				propspan,
				leftspan,
				rightspan,
			} => smallvec![
				change!(span!(start), WrapSet { ident, propspan }),
				change!(propspan, Delete),
				change!(span!(leftspan rightspan between), Replace { text: "," }),
				change!(
					span!(end),
					ClosingParen {
						semi: false,
						replace: true
					}
				)
			],
			RewriteType::WrapSetComputed {
				leftspan,
				rightspan,
				propspan,
			} => smallvec![
				change!(span!(start), WrapSetComputed),
				// replace the bracket with ,
				change!(span!(leftspan propspan between), Replace { text: "," }),
				// replace the other bracket with another ,
				change!(span!(propspan rightspan between), Replace { text: "," }),
				change!(
					span!(end),
					ClosingParen {
						semi: false,
						replace: true
					}
				)
			],
			Self::SetRealmFn => smallvec![change!(span, SetRealmFn)],
			Self::ImportFn => smallvec![change!(span, ImportFn)],
			Self::MetaFn => smallvec![change!(span, MetaFn)],
			Self::ScramErr { ident } => smallvec![change!(span!(end), ScramErrFn { ident })],
			Self::Scramitize => smallvec![
				change!(span!(start), ScramitizeFn),
				change!(
					span!(end),
					ClosingParen {
						semi: false,
						replace: false
					}
				)
			],
			Self::Eval { inner } => smallvec![
				change!(span!(span inner start), EvalRewriteFn),
				change!(
					span!(inner span end),
					ClosingParen {
						semi: false,
						replace: false,
					}
				)
			],
			Self::Assignment { name, rhs, op } => smallvec![
				change!(span!(span rhs start), AssignmentLeft { name, op }),
				change!(
					span!(rhs span end),
					ClosingParen {
						semi: false,
						replace: true
					}
				)
			],
			Self::ShorthandObj { name } => {
				smallvec![change!(span!(end), ShorthandObj { ident: name })]
			}
			Self::SourceTag => smallvec![change!(span, SourceTag)],
			Self::Replace { text } => smallvec![change!(span, Replace { text })],
			Self::Delete => smallvec![change!(span, Delete)],
		}
	}
}
