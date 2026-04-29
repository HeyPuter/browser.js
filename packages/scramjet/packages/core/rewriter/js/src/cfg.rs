use std::error::Error;
use std::fmt;
use std::str::FromStr;

use oxc::allocator::StringBuilder;

pub trait UrlRewriter {
	fn rewrite(
		&self,
		cfg: &Config,
		flags: &Flags,
		url: &str,
		builder: &mut StringBuilder,
		module: bool,
	) -> Result<(), Box<dyn Error + Sync + Send>>;
}

pub struct Config {
	pub prefix: String,

	pub wrapfn: String,
	pub wrapthisfn: String,
	pub wrappropertybase: String,
	pub wrappropertyfn: String,
	pub cleanrestfn: String,
	pub importfn: String,
	pub rewritefn: String,
	pub wrappostmessagefn: String,
	pub metafn: String,
	pub pushsourcemapfn: String,

	pub trysetfn: String,
	pub templocid: String,
	pub tempunusedid: String,
}

/// Selects which AST visitor implementation the rewriter uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VisitorKind {
	/// The full destructure-pattern-and-scope-cleanup visitor (the historical default).
	#[default]
	Dpsc,
	/// Stub visitor; performs no rewrites.
	Ppsc,
}

impl VisitorKind {
	pub fn as_str(&self) -> &'static str {
		match self {
			Self::Dpsc => "dpsc",
			Self::Ppsc => "ppsc",
		}
	}
}

impl fmt::Display for VisitorKind {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(self.as_str())
	}
}

impl FromStr for VisitorKind {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s {
			"dpsc" | "DPSC" | "Dpsc" => Ok(Self::Dpsc),
			"ppsc" | "PPSC" | "Ppsc" => Ok(Self::Ppsc),
			other => Err(format!("unknown visitor kind: {other}")),
		}
	}
}

#[derive(Debug)]
pub struct Flags {
	pub base: String,
	pub sourcetag: String,

	pub is_module: bool,
	pub capture_errors: bool,
	pub scramitize: bool,
	pub do_sourcemaps: bool,
	pub strict_rewrites: bool,
	pub destructure_rewrites: bool,

	pub visitor: VisitorKind,
}
