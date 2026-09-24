use std::cell::RefCell;

use oxc::{
	allocator::{Allocator, Vec},
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

use cfg::{Config, Flags, IncumbencyMode, UrlRewriter};
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

	pub errors: std::vec::Vec<OxcDiagnostic>,
	pub flags: Flags,
}

/// Where the prelude may go without changing what the script means, and what
/// has to precede it there: `;` to end a directive that relied on ASI, or a
/// line break to end a hashbang that runs to the end of the source. A byte
/// offset that is the same in the output as in the input, since the rewriter
/// changes nothing before it.
///
/// https://tc39.es/ecma262/#sec-directive-prologues-and-the-use-strict-directive
///
/// The prelude has to go after every directive: one in front of a directive
/// ends the prologue, and the script silently stops being strict. And it has
/// to stay on a line that was already there, so that no line number in a
/// stack trace moves - which is why a hashbang's prelude goes at the start of
/// the next line rather than on a line of its own.
fn prelude_boundary(program: &oxc::ast::ast::Program, js: &str) -> (u32, &'static str) {
	if let Some(last) = program.directives.last() {
		let end = last.span.end;
		let semi = end > 0 && js.as_bytes()[end as usize - 1] == b';';

		return (end, if semi { "" } else { ";" });
	}

	if let Some(hashbang) = &program.hashbang {
		// a hashbang comment runs to the end of its line, so the prelude goes
		// after the line terminator that ends it
		let end = hashbang.span.end as usize;
		let rest = &js[end..];
		let terminator = rest
			.chars()
			.next()
			.filter(|c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'));

		return match terminator {
			Some('\r') if rest.as_bytes().get(1) == Some(&b'\n') => ((end + 2) as u32, ""),
			Some(c) => ((end + c.len_utf8()) as u32, ""),
			None => (end as u32, "\n"),
		};
	}

	(0, "")
}

/// https://datatracker.ietf.org/doc/html/rfc4648#section-4
fn push_base64(out: &mut String, bytes: &[u8]) {
	const ALPHABET: &[u8; 64] =
		b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

	for chunk in bytes.chunks(3) {
		let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
		let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;

		out.push(ALPHABET[(n >> 18) as usize & 63] as char);
		out.push(ALPHABET[(n >> 12) as usize & 63] as char);
		out.push(if chunk.len() > 1 { ALPHABET[(n >> 6) as usize & 63] as char } else { '=' });
		out.push(if chunk.len() > 2 { ALPHABET[n as usize & 63] as char } else { '=' });
	}
}

/// The calls a rewritten script makes before its own first statement, as one
/// statement whose completion is empty - or nothing, if it makes none.
///
/// Empty, because a script's completion value is its last statement that has
/// one, and `eval` hands that back: a script that is nothing but its prologue -
/// `eval("'use strict'")` - completes with the directive's string. An
/// expression statement after it would complete with the call's `undefined`
/// instead. A lexical declaration's completion is empty, and so is the block
/// around it, which keeps the binding out of the script's scope.
/// https://tc39.es/ecma262/#sec-block-runtime-semantics-evaluation
fn build_prelude(config: &Config, flags: &Flags, sourcemap: &[u8]) -> String {
	let mut calls = std::vec::Vec::new();

	if flags.do_sourcemaps && flags.inline_sourcemap {
		let mut call = format!("{}(\"", config.pushsourcemapfn);
		push_base64(&mut call, sourcemap);
		call.push_str(&format!("\",\"{}\")", flags.sourcetag));
		calls.push(call);
	}

	if flags.incumbency == IncumbencyMode::Pst {
		calls.push(format!(
			"{}(\"{}\",\"{}\")",
			config.registerrealmfn, flags.script_id, flags.sourcetag
		));
	}

	if calls.is_empty() {
		return String::new();
	}

	format!("{{const $=({})}}", calls.join(","))
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

		let (prelude_at, prelude_lead) = prelude_boundary(&parsed.program, js);
		let prelude_at = prelude_at as usize;

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

		let sourcemap: Vec<'alloc, u8> = changed.map;

		// spliced in after the rewrite rather than as one of its changes: it
		// carries the sourcemap, which the rewrite is what produces
		let prelude = build_prelude(&config, &visitor.flags, &sourcemap);
		let js: Vec<'alloc, u8> = if prelude.is_empty() {
			changed.source
		} else {
			let source = changed.source;
			let mut out =
				Vec::with_capacity_in(source.len() + prelude_lead.len() + prelude.len(), alloc);
			out.extend_from_slice(&source[..prelude_at]);
			out.extend_from_slice(prelude_lead.as_bytes());
			out.extend_from_slice(prelude.as_bytes());
			out.extend_from_slice(&source[prelude_at..]);
			out
		};

		Ok(RewriteResult {
			js,
			sourcemap,
			errors: parsed.errors,
			flags: visitor.flags,
		})
	}
}
