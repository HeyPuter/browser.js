use std::error::Error;

use oxc::{
	allocator::Allocator,
	ast_visit::Visit,
};

use crate::{
	cfg::{Config, Flags, UrlRewriter},
	changes::JsChanges,
};

/// Stub PPSC visitor.
///
/// This visitor is a placeholder. It uses the default `Visit` implementation,
/// which traverses the AST without producing any rewrites. As a result the
/// rewriter passes the input through unchanged when this visitor is selected.
///
/// Fields mirror those on `dpsc::Visitor` so the rewriter dispatcher in
/// `lib.rs` can construct either visitor from the same set of inputs. They are
/// currently unread by the stub `Visit` impl below but will be needed once a
/// real PPSC implementation is written.
#[allow(dead_code)]
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

impl<'data, E> Visit<'data> for Visitor<'_, 'data, E>
where
	E: UrlRewriter,
{
	// TODO: implement PPSC-specific rewriting logic.
	// All `visit_*` methods fall back to the default `walk::*` traversal,
	// which means no changes are emitted into `jschanges`.
}
