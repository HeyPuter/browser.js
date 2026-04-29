use std::{
	env,
	ffi::OsString,
	fs,
	path::PathBuf,
	sync::Arc,
	time::{Duration, Instant},
};

use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use js::cfg::VisitorKind;
use oxc::{
	allocator::{Allocator, StringBuilder},
	diagnostics::NamedSource,
};
use rewriter::NativeRewriter;

mod rewriter;
mod test_runner;

/// Mirror of `js::cfg::VisitorKind` that derives `clap::ValueEnum` so the
/// rewriter's visitor can be selected from the command line. Kept here (rather
/// than on the upstream type) so the `js` crate doesn't pull in clap.
#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum CliVisitorKind {
	/// Full destructure-pattern-and-scope-cleanup visitor (default).
	Dpsc,
	/// Stub visitor; performs no rewrites.
	Ppsc,
}

impl From<CliVisitorKind> for VisitorKind {
	fn from(v: CliVisitorKind) -> Self {
		match v {
			CliVisitorKind::Dpsc => Self::Dpsc,
			CliVisitorKind::Ppsc => Self::Ppsc,
		}
	}
}

#[derive(Parser)]
pub struct RewriterOptions {
	#[clap(long, default_value = "/scrammedjet/")]
	prefix: String,
	#[clap(long, default_value = "$wrap")]
	wrapfn: String,
	#[clap(long, default_value = "$sj_")]
	wrappropertybase: String,
	#[clap(long, default_value = "$prop")]
	wrappropertyfn: String,
	#[clap(long, default_value = "$clean")]
	cleanrestfn: String,
	#[clap(long, default_value = "$import")]
	importfn: String,
	#[clap(long, default_value = "$rewrite")]
	rewritefn: String,
	#[clap(long, default_value = "$meta")]
	metafn: String,
	#[clap(long, default_value = "$wrapPostMessage")]
	wrappostmessage: String,
	#[clap(long, default_value = "$pushsourcemap")]
	pushsourcemapfn: String,

	#[clap(long, default_value = "$tryset")]
	trysetfn: String,
	#[clap(long, default_value = "$temploc")]
	templocid: String,
	#[clap(long, default_value = "$tempunused")]
	tempunusedid: String,

	#[clap(long, default_value = "https://google.com/glorngle/si.js")]
	base: String,
	#[clap(long, default_value = "glongle1")]
	sourcetag: String,
	#[clap(long, default_value_t = false)]
	is_module: bool,

	#[clap(long, default_value_t = false)]
	capture_errors: bool,
	#[clap(long, default_value_t = false)]
	do_sourcemaps: bool,
	#[clap(long, default_value_t = false)]
	scramitize: bool,
	#[clap(long, default_value_t = false)]
	strict_rewrites: bool,
	#[clap(long, default_value_t = false)]
	destructure_rewrites: bool,

	/// Which AST visitor to use for rewriting.
	#[clap(long, value_enum, default_value_t = CliVisitorKind::Dpsc)]
	visitor: CliVisitorKind,
}

impl Default for RewriterOptions {
	fn default() -> Self {
		Self::parse_from(std::iter::empty::<OsString>())
	}
}

#[derive(Parser)]
#[command(version = clap::crate_version!())]
pub enum Cli {
	/// Rewrite a file
	Rewrite {
		file: PathBuf,
		#[clap(flatten)]
		config: RewriterOptions,
	},
	/// Rewrite a file multiple times for flamegraphing
	Bench {
		file: PathBuf,
		iterations: u32,
		#[clap(flatten)]
		config: RewriterOptions,
	},
}

fn main() -> Result<()> {
	let args = Cli::parse();

	match args {
		Cli::Rewrite { file, config } => {
			let mut rewriter = NativeRewriter::new(&config);

			let data = fs::read_to_string(file).context("failed to read file")?;

			let res = rewriter.rewrite(&data, &config)?;

			let source =
				Arc::new(NamedSource::new(data.clone(), config.base).with_language("javascript"));

			eprintln!(
				"rewritten:\n",
			);
			println!("{}", str::from_utf8(&res.js).context("failed to parse rewritten js")?);

			let unrewritten = NativeRewriter::unrewrite(&res);
			// println!(
			//     "unrewritten:\n{}",
			//              str::from_utf8(&unrewritten).context("failed to parse unrewritten js")?
			// );

			eprintln!("errors:");
			for err in res.errors {
				eprintln!("{}", err.with_source_code(source.clone()));
			}

			rewriter.reset();

			eprintln!(
				"unrewritten matches orig: {}",
				data.as_bytes() == unrewritten.as_slice()
			);
		}
		Cli::Bench {
			file,
			iterations,
			config,
		} => {
			let mut rewriter = NativeRewriter::new(&config);

			let data = fs::read_to_string(file).context("failed to read file")?;
			let mut duration = Duration::from_secs(0);

			let cnt = iterations * 100;

			for x in 1..=cnt {
				let before = Instant::now();
				rewriter
					.rewrite(&data, &config)
					.context("failed to rewrite")?;
				let after = Instant::now();

				rewriter.reset();

				duration += after - before;

				if x % 100 == 0 {
					println!("{x}...");
				}
			}

			println!("iterations: {cnt}");
			println!("total time: {duration:?}");
			println!("avg time: {:?}", duration / cnt);
		}
	}

	Ok(())
}
