use std::cell::RefCell;

use oxc::{
	allocator::{Allocator, Vec},
	ast::Comment,
	ast_visit::Visit,
	diagnostics::OxcDiagnostic,
	parser::{ParseOptions, Parser},
	span::SourceType,
};
use thiserror::Error;

pub mod cfg;
mod changes;
mod rewrite;
mod visitor;

use cfg::{Config, Flags, UrlRewriter};
use changes::JsChanges;
use visitor::Visitor;

#[derive(Error, Debug)]
pub enum RewriterError {
	#[error("transformer error: {0}")]
	Transformer(#[from] transform::TransformError),
	#[error("url rewriter error: {0}")]
	Url(Box<dyn std::error::Error + Sync + Send>),
	#[error("formatting error: {0}")]
	Formatting(#[from] std::fmt::Error),

	#[error("oxc panicked in parser: {0}")]
	OxcPanicked(String),
	#[error("Already rewriting")]
	AlreadyRewriting,
	#[error("Not rewriting")]
	NotRewriting,
	#[error("Changes left over")]
	Leftover,
}

#[derive(Debug)]
pub struct RewriteResult<'alloc> {
	pub js: Vec<'alloc, u8>,
	pub sourcemap: Vec<'alloc, u8>,

	/// The `//# sourceURL` this source already carried, if any. Rewriting
	/// appends one of scramjet's own, which wins - a page that reads a stack
	/// trace has to be handed this back in its place.
	pub page_source_url: Option<std::string::String>,

	pub errors: std::vec::Vec<OxcDiagnostic>,
	pub flags: Flags,
}

/// The sourceURL V8 would take from this source, matched the way V8 matches
/// it. Measured against d8 rather than inferred, because a mismatch here is a
/// stack frame that names the wrong file and gives the proxy away:
///
///   - line comments only; the same text inside a block comment is not one
///   - `#` or `@`, then exactly one space: `//#sourceURL=` and `//#  sourceURL=`
///     are both ignored
///   - `sourceURL` is case-sensitive and `=` follows it immediately
///   - the value is the run of non-whitespace after any spacing, and anything
///     but whitespace following it voids the directive
///   - the last such comment wins, and a voided one clears an earlier valid
///     one rather than losing to it
///
/// Comments that merely start `//#` - `sourceMappingURL` above all - do not
/// participate at all.
fn page_source_url(js: &str, comments: &[Comment]) -> Option<std::string::String> {
	let mut found = None;

	for comment in comments {
		if !comment.is_line() {
			continue;
		}

		let span = comment.content_span();
		let content = &js[span.start as usize..span.end as usize];

		let Some(rest) = content
			.strip_prefix("# ")
			.or_else(|| content.strip_prefix("@ "))
		else {
			continue;
		};
		let Some(value) = rest.strip_prefix("sourceURL=") else {
			continue;
		};

		let mut words = value.split_whitespace();
		found = match (words.next(), words.next()) {
			(Some(url), None) => Some(url.to_string()),
			_ => None,
		};
	}

	found
}

pub struct Rewriter {
	changes: RefCell<Option<JsChanges<'static, 'static>>>,
}

impl Rewriter {
	fn take_changes<'alloc: 'data, 'data>(
		&'data self,
		alloc: &'alloc Allocator,
	) -> Result<JsChanges<'alloc, 'data>, RewriterError> {
		let mut slot = self
			.changes
			.try_borrow_mut()
			.map_err(|_| RewriterError::AlreadyRewriting)?;

		slot.take()
			.ok_or(RewriterError::AlreadyRewriting)
			.and_then(|x| {
				let mut x = unsafe {
					std::mem::transmute::<JsChanges<'static, 'static>, JsChanges<'alloc, 'data>>(x)
				};
				x.set_alloc(alloc)?;
				Ok(x)
			})
	}

	fn put_changes<'alloc: 'data, 'data>(
		&'data self,
		mut changes: JsChanges<'alloc, 'data>,
	) -> Result<(), RewriterError> {
		if !changes.empty() {
			return Err(RewriterError::Leftover);
		}

		let mut slot = self
			.changes
			.try_borrow_mut()
			.map_err(|_| RewriterError::AlreadyRewriting)?;

		if slot.is_some() {
			Err(RewriterError::NotRewriting)
		} else {
			changes.take_alloc()?;

			let changes = unsafe {
				std::mem::transmute::<JsChanges<'alloc, 'data>, JsChanges<'static, 'static>>(
					changes,
				)
			};

			slot.replace(changes);

			Ok(())
		}
	}

	pub fn new() -> Self {
		Self {
			changes: RefCell::new(Some(JsChanges::new())),
		}
	}

	pub fn rewrite<'alloc: 'data, 'data, E: UrlRewriter>(
		&'data self,
		alloc: &'alloc Allocator,
		js: &'data str,
		config: Config,
		flags: Flags,
		rewriter: &E,
	) -> Result<RewriteResult<'alloc>, RewriterError> {
		let source_type = SourceType::unambiguous()
			.with_javascript(true)
			.with_module(flags.is_module)
			.with_standard(true);
		let parsed = Parser::new(alloc, js, source_type)
			.with_options(ParseOptions {
				allow_v8_intrinsics: true,
				allow_return_outside_function: true,
				..Default::default()
			})
			.parse();

		if parsed.panicked {
			use std::fmt::Write;

			let mut errors = String::new();
			for error in parsed.errors {
				writeln!(errors, "{error}")?;
			}
			return Err(RewriterError::OxcPanicked(errors));
		}

		// read off the original source, before `js` is shadowed by the rewritten
		// bytes and before scramjet appends a sourceURL of its own
		let page_source_url = page_source_url(js, &parsed.program.comments);

		let jschanges = self.take_changes(alloc)?;

		let mut visitor = Visitor {
			alloc,
			jschanges,
			error: None,

			config: &config,
			rewriter: rewriter,
			flags,
		};
		visitor.visit_program(&parsed.program);
		if let Some(error) = visitor.error {
			return Err(RewriterError::Url(error));
		}
		let mut jschanges = visitor.jschanges;

		let changed = jschanges.perform(js, &config, &visitor.flags)?;

		self.put_changes(jschanges)?;

		let js: Vec<'alloc, u8> = changed.source;
		let sourcemap: Vec<'alloc, u8> = changed.map;

		Ok(RewriteResult {
			js,
			sourcemap,
			page_source_url,
			errors: parsed.errors,
			flags: visitor.flags,
		})
	}
}
