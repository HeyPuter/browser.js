use std::{error::Error, str::FromStr};

use oxc::allocator::StringBuilder;
use thiserror::Error as ThisError;

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
	pub wrappropertybase: String,
	pub wrappropertyfn: String,
	pub callfn: String,
	pub cleanrestfn: String,
	pub importfn: String,
	pub rewritefn: String,
	pub metafn: String,
	pub pushsourcemapfn: String,

	pub trysetfn: String,
	pub selfid: String,
	pub templocid: String,
	pub tempreceiverid: String,
	pub tempunusedid: String,
}

/// How a stack frame is traced back to the script that owns it, which is what
/// lets an incumbent settings object be identified. The mirror of
/// `IncumbencyMode` in `types.ts`, and what arrives here is the configured
/// mode already downgraded to what the engine can actually do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum IncumbencyMode {
	/// `Error.prepareStackTrace` plus `CallSite.getScriptHash`, both V8 only
	Pst,
	/// a `//# sourceURL` carrying a per-rewrite nonce
	Nonce,
	/// not implemented yet; acts as `None`
	Stamp,
	/// not implemented yet; acts as `None`
	LazyStamp,
	/// no attribution
	#[default]
	None,
}

#[derive(Debug, ThisError)]
#[error("not an incumbency mode: {0}")]
pub struct InvalidIncumbencyMode(String);

impl FromStr for IncumbencyMode {
	type Err = InvalidIncumbencyMode;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s {
			"pst" => Ok(Self::Pst),
			"nonce" => Ok(Self::Nonce),
			"stamp" => Ok(Self::Stamp),
			"lazystamp" => Ok(Self::LazyStamp),
			"none" => Ok(Self::None),
			_ => Err(InvalidIncumbencyMode(s.to_string())),
		}
	}
}

#[derive(Debug)]
pub struct Flags {
	pub base: String,
	pub sourcetag: String,

	pub is_module: bool,
	pub capture_errors: bool,
	pub do_sourcemaps: bool,
	pub disable_computed_wrap: bool,
	pub destructure_rewrites: bool,

	pub incumbency: IncumbencyMode,
}
