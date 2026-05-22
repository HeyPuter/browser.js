//! Build a global index of every method in visitor.rs that takes a `&AstNode`
//! as its first non-self argument. For each, recursively analyze the body to
//! determine whether it fully covers all R-reaching fields of that node.
//!
//! Helpers (`recurse_*`, `handle_*`) get the same treatment as visit_* methods
//! — if their body provably walks every R-field of their input, they're
//! recorded as "fully covers". Callers can then credit the corresponding
//! field at the call site.

use std::collections::HashMap;

use syn::{Expr, FnArg, ImplItem, Item, Pat, PatType, Type};

use crate::reachability::AstGraph;

#[derive(Clone, Debug)]
pub struct HelperInfo {
    pub name: String,
    pub node_type: String,
    pub it_param_name: String,
    pub fully_covers: bool,
    /// Set of R-fields/variants of `node_type` that this helper is known to
    /// cover. Used by the snippet generator to steer the witness BFS through
    /// the parts it does NOT cover.
    pub covered_set: std::collections::BTreeSet<String>,
    /// True if covered_set means "everything" (walk_all-equivalent).
    pub covered_all: bool,
}

/// Working copy used only during build_index (carries the body for analysis).
#[derive(Clone, Debug)]
struct WorkingHelper {
    info: HelperInfo,
    body: syn::Block,
}

#[derive(Default, Debug, Clone)]
pub struct HelperIndex {
    by_name: HashMap<String, HelperInfo>,
}

impl HelperIndex {
    pub fn lookup(&self, name: &str) -> Option<&HelperInfo> {
        self.by_name.get(name)
    }
    pub fn all(&self) -> impl Iterator<Item = &HelperInfo> {
        self.by_name.values()
    }
}

/// Lazily parse visitor.rs and build the index. The result contains only
/// owned `String` values and no proc_macro2 tokens — safe to cache across
/// macro invocations.
///
/// We cache the file's content hash + the resulting HelperIndex so we don't
/// re-parse on every proc-macro invocation. (Tokens would be use-after-free
/// across invocations, but Strings/bools are fine.)
pub fn index() -> HelperIndex {
    use std::sync::Mutex;
    static CACHE: Mutex<Option<(u64, HelperIndex)>> = Mutex::new(None);

    let Some(path) = locate_visitor_rs() else {
        return HelperIndex::default();
    };
    let Ok(src) = std::fs::read_to_string(&path) else {
        return HelperIndex::default();
    };
    // Cheap content hash.
    let mut hash: u64 = 1469598103934665603;
    for b in src.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    {
        let g = CACHE.lock().unwrap();
        if let Some((h, idx)) = g.as_ref() {
            if *h == hash {
                return idx.clone();
            }
        }
    }
    let idx = build_index_from(&src);
    let mut g = CACHE.lock().unwrap();
    *g = Some((hash, idx.clone()));
    idx
}

fn build_index_from(src: &str) -> HelperIndex {
    let Ok(file) = syn::parse_file(src) else {
        return HelperIndex::default();
    };

    let mut working: HashMap<String, WorkingHelper> = HashMap::new();

    for item in &file.items {
        if let Item::Impl(imp) = item {
            for ii in &imp.items {
                if let ImplItem::Fn(f) = ii {
                    if let Some(w) = extract_method(f) {
                        working.insert(w.info.name.clone(), w);
                    }
                }
            }
        }
    }

    // Fixpoint: re-check each helper's full-coverage until stable.
    let graph = AstGraph::build();
    loop {
        let mut changed = false;
        let names: Vec<String> = working.keys().cloned().collect();
        // Snapshot infos for analyze_helper input.
        let infos_snapshot: HashMap<String, HelperInfo> = working
            .iter()
            .map(|(k, v)| (k.clone(), v.info.clone()))
            .collect();
        for name in names {
            let w = working.get(&name).unwrap().clone();
            if w.info.fully_covers {
                continue;
            }
            let (now, covered_set, covered_all) = analyze_helper(&w, &infos_snapshot, &graph);
            let prev_set_len = w.info.covered_set.len();
            let info = &mut working.get_mut(&name).unwrap().info;
            if now != info.fully_covers
                || covered_set.len() != prev_set_len
                || covered_all != info.covered_all
            {
                info.fully_covers = now;
                info.covered_set = covered_set;
                info.covered_all = covered_all;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    HelperIndex {
        by_name: working.into_iter().map(|(k, v)| (k, v.info)).collect(),
    }
}

fn locate_visitor_rs() -> Option<String> {
    if let Ok(p) = std::env::var("COVERAGE_VISITOR_FILE") {
        return Some(p);
    }
    // Default: relative to coverage-macro's CARGO_MANIFEST_DIR.
    let dir = env!("CARGO_MANIFEST_DIR");
    Some(format!("{dir}/../js/src/visitor.rs"))
}

fn extract_method(f: &syn::ImplItemFn) -> Option<WorkingHelper> {
    let name = f.sig.ident.to_string();
    let mut iter = f.sig.inputs.iter();
    let _recv = iter.next()?;
    let arg = iter.next()?;
    let FnArg::Typed(PatType { pat, ty, .. }) = arg else {
        return None;
    };
    let param_name = match pat.as_ref() {
        Pat::Ident(p) => p.ident.to_string(),
        _ => return None,
    };
    let node_type = extract_ref_type_name(ty)?;
    Some(WorkingHelper {
        info: HelperInfo {
            name,
            node_type,
            it_param_name: param_name,
            fully_covers: false,
            covered_set: std::collections::BTreeSet::new(),
            covered_all: false,
        },
        body: f.block.clone(),
    })
}

/// Given a `&Foo<'a>` or `&Foo` type, return `"Foo"`. Handles fully-qualified
/// paths like `oxc::ast::ast::Foo` by taking the last segment.
fn extract_ref_type_name(ty: &Type) -> Option<String> {
    let Type::Reference(r) = ty else { return None };
    let Type::Path(tp) = r.elem.as_ref() else {
        return None;
    };
    let last = tp.path.segments.last()?;
    Some(last.ident.to_string())
}

/// Returns (fully_covers, covered_set, covered_all) for the helper.
fn analyze_helper(
    w: &WorkingHelper,
    helpers: &HashMap<String, HelperInfo>,
    graph: &AstGraph,
) -> (bool, std::collections::BTreeSet<String>, bool) {
    let Some(def) = graph.nodes.get(w.info.node_type.as_str()) else {
        return (false, std::collections::BTreeSet::new(), false);
    };

    let mut origins = OriginMap::new();
    origins.set(&w.info.it_param_name, Origin::It);

    // Optimistic self-coverage: when a helper recurses on itself, the
    // pessimistic "self is uncovered" view ripples through the analysis and
    // makes legitimately-covering branches appear uncovered too. To compute
    // an accurate `covered_set` (the set of fields/variants the helper does
    // cover), we temporarily mark *self* as fully_covers in the helpers map
    // before analyzing. The final fully_covers verdict is computed against
    // the actual coverage from the body, not the assumption.
    let mut optimistic_helpers = helpers.clone();
    if let Some(self_info) = optimistic_helpers.get_mut(&w.info.name) {
        self_info.fully_covers = true;
    }

    let paths = crate::analyze::analyze_with_helpers_typed(
        &w.body,
        &w.info.it_param_name,
        Some(&w.info.node_type),
        &optimistic_helpers,
        graph,
        origins,
    );

    // Compute intersection of covered across all paths (the conservative
    // "always covered" set).
    let mut combined: Option<crate::analyze::Covered> = None;
    for p in &paths {
        combined = Some(match combined {
            None => p.covered.clone(),
            Some(prev) => crate::analyze::Covered::intersect(&prev, &p.covered),
        });
    }
    let combined = combined.unwrap_or(crate::analyze::Covered::empty());

    // Verify fully_covers across all paths.
    let mut fully = true;
    for p in &paths {
        let covered_all = p.covered.all;
        for f in def.fields {
            if !graph.field_in_r(f) {
                continue;
            }
            if !covered_all && !p.covered.fields.iter().any(|n| n == f.name) {
                fully = false;
                break;
            }
        }
        // For enum node_types (no fields, only variants), fully_covers
        // requires covered_all (the helper must walk the whole enum).
        if def.fields.is_empty() && !def.variants.is_empty() && !covered_all {
            fully = false;
        }
        if !fully { break; }
    }

    (fully, combined.fields, combined.all)
}

/// Tracks the AST-origin of each local binding within a method body.
#[derive(Clone, Debug, Default)]
pub struct OriginMap {
    map: HashMap<String, Origin>,
}

impl OriginMap {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn set(&mut self, name: &str, origin: Origin) {
        self.map.insert(name.to_string(), origin);
    }
    pub fn get(&self, name: &str) -> Origin {
        self.map.get(name).cloned().unwrap_or(Origin::Unknown)
    }
}

#[derive(Clone, Debug)]
pub enum Origin {
    /// Refers to the `it` arg itself.
    It,
    /// A field of `it`. Sub-accesses (`.bar`, `[i]`) on a Field still carry
    /// the parent field name — we only care which top-level R-field of `it`
    /// is being touched.
    Field(String),
    Unknown,
}

/// Resolve the origin of an expression: trace `&x`, `x.y`, `it.foo`, etc.
pub fn resolve_origin(e: &Expr, origins: &OriginMap, it_name: &str) -> Origin {
    let inner = match e {
        Expr::Reference(r) => r.expr.as_ref(),
        other => other,
    };
    match inner {
        Expr::Path(p) => {
            if p.path.is_ident(it_name) {
                return Origin::It;
            }
            if let Some(seg) = p.path.get_ident() {
                return origins.get(&seg.to_string());
            }
            Origin::Unknown
        }
        Expr::Field(f) => {
            // Could be `it.foo`, `it.foo.bar`, or `local.field`.
            // Trace the base.
            let base = resolve_origin(&f.base, origins, it_name);
            match base {
                Origin::It => {
                    if let syn::Member::Named(n) = &f.member {
                        return Origin::Field(n.to_string());
                    }
                    Origin::Unknown
                }
                other => other,
            }
        }
        Expr::Index(idx) => resolve_origin(&idx.expr, origins, it_name),
        Expr::MethodCall(m) => {
            // e.g. `.unwrap()`, `.as_assignment_target()`. Pass through.
            resolve_origin(&m.receiver, origins, it_name)
        }
        _ => Origin::Unknown,
    }
}

/// For loops: `for v in &it.foo` → v's origin = Field("foo").
/// `resolve_origin` already does the right thing by returning the top-level
/// `Field(name)` regardless of how deeply we project, so we just delegate.
pub fn origin_from_iter(iter: &Expr, origins: &OriginMap, it_name: &str) -> Origin {
    resolve_origin(iter, origins, it_name)
}

#[allow(dead_code)]
pub fn dump_helpers(idx: &HelperIndex) -> String {
    let mut names: Vec<_> = idx.by_name.keys().cloned().collect();
    names.sort();
    let mut s = String::new();
    for n in names {
        let h = &idx.by_name[&n];
        s.push_str(&format!(
            "  {} : &{} -> fully_covers={}\n",
            h.name, h.node_type, h.fully_covers
        ));
    }
    s
}
