pub mod dpsc;
pub mod ppsc;

// js MUST not be able to get a reference to any of these because sbx
//
// maybe move this out of this lib?
pub(crate) const UNSAFE_GLOBALS: &[&str] = &["parent", "top", "location", "eval"];
