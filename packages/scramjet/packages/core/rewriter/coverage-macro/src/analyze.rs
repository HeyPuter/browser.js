//! Coverage analysis with helper recursion.
//!
//! For each `#[coverage_checked]` method (and each helper indexed from
//! visitor.rs), we compute the set of R-reaching fields covered on every
//! control-flow path that exits the method. Coverage is contributed by:
//!
//!   - The marker macros `walk_all!(it)`, `walk_field!(it.foo)`,
//!     `skip_field!(it.foo, "…")`.
//!   - Bare `walk::walk_*(self, it)` / `walk::walk_*(self, &it.foo)` calls.
//!   - Calls to helper methods that the index has proven to fully cover
//!     their AST arguments — the call credits the corresponding field at
//!     the call site (via origin tracking on local bindings).
//!
//! Control flow:
//!   - sequential stmts → union
//!   - if/else → intersect at merge (no-else branch contributes nothing)
//!   - match → intersect across arms
//!   - return / unreachable / panic / ? → terminate; check coverage there
//!   - loops → body might run 0 times; conservative = body's covers don't
//!     count toward post-loop coverage. (But field credits FROM the loop
//!     itself — i.e. covering `it.foo` because the loop iterates `it.foo`
//!     and processes every element — DO count.)

use std::collections::{BTreeSet, HashMap};

use proc_macro2::TokenStream;
use syn::{Block, Expr, ExprForLoop, ExprIf, ExprMatch, Pat, Stmt};

use crate::helper_index::{HelperInfo, Origin, OriginMap, origin_from_iter, resolve_origin};
use crate::reachability::AstGraph;

#[derive(Clone, Debug)]
pub struct Covered {
    pub all: bool,
    pub fields: BTreeSet<String>,
}

impl Covered {
    pub fn empty() -> Self { Self { all: false, fields: BTreeSet::new() } }
    pub fn full()  -> Self { Self { all: true,  fields: BTreeSet::new() } }
    pub fn add_field(&mut self, name: &str) { self.fields.insert(name.to_string()); }
    pub fn intersect(a: &Self, b: &Self) -> Self {
        if a.all && b.all { return Self::full(); }
        let af: BTreeSet<String> = if a.all { b.fields.clone() } else { a.fields.clone() };
        let bf: BTreeSet<String> = if b.all { a.fields.clone() } else { b.fields.clone() };
        Self { all: a.all && b.all, fields: af.intersection(&bf).cloned().collect() }
    }
    pub fn covers(&self, name: &str) -> bool {
        self.all || self.fields.iter().any(|f| f == name)
    }
}

#[derive(Clone, Debug)]
pub struct Witness {
    pub kind: PathKind,
    pub covered: Covered,
}

#[derive(Clone, Debug)]
pub enum PathKind { FallThrough, Return }

#[derive(Default)]
pub struct Findings {
    pub missing: Vec<MissingCover>,
    pub bad_skips: Vec<BadSkip>,
}

#[derive(Clone, Debug)]
pub struct MissingCover {
    pub field: String,
    pub field_ty: String,
    pub path_label: String,
}

#[derive(Clone, Debug)]
pub struct BadSkip {
    pub field: String,
    pub field_ty: String,
    pub site_repr: String,
}

/// Backward-compatible entry — used when no helper index is available.
pub fn analyze(body: &Block, _findings: &mut Findings, graph: &AstGraph) -> Vec<Witness> {
    let helpers = HashMap::new();
    let origins = OriginMap::new();
    analyze_with_helpers_typed(body, "it", None, &helpers, graph, origins)
}

pub fn analyze_with_helpers(
    body: &Block,
    it_name: &str,
    helpers: &HashMap<String, HelperInfo>,
    graph: &AstGraph,
    origins: OriginMap,
) -> Vec<Witness> {
    analyze_with_helpers_typed(body, it_name, None, helpers, graph, origins)
}

pub fn analyze_with_helpers_typed(
    body: &Block,
    it_name: &str,
    it_node_type: Option<&str>,
    helpers: &HashMap<String, HelperInfo>,
    graph: &AstGraph,
    origins: OriginMap,
) -> Vec<Witness> {
    let mut completed: Vec<Witness> = Vec::new();
    let ctx = Ctx { it_name, it_node_type, helpers, graph };
    let final_cov = walk_block(body, Covered::empty(), origins, &mut completed, &ctx);
    completed.push(Witness { kind: PathKind::FallThrough, covered: final_cov });
    completed
}

struct Ctx<'a> {
    it_name: &'a str,
    it_node_type: Option<&'a str>,
    helpers: &'a HashMap<String, HelperInfo>,
    graph: &'a AstGraph,
}

fn walk_block(
    block: &Block,
    mut cov: Covered,
    mut origins: OriginMap,
    completed: &mut Vec<Witness>,
    ctx: &Ctx,
) -> Covered {
    for stmt in &block.stmts {
        let out = walk_stmt(stmt, cov.clone(), &mut origins, completed, ctx);
        match out {
            Out::Continue(c) => cov = c,
            Out::Terminated => return Covered::full(),
        }
    }
    cov
}

enum Out { Continue(Covered), Terminated }

fn walk_stmt(
    stmt: &Stmt,
    cov: Covered,
    origins: &mut OriginMap,
    completed: &mut Vec<Witness>,
    ctx: &Ctx,
) -> Out {
    match stmt {
        Stmt::Expr(e, _) => walk_expr_stmt(e, cov, origins, completed, ctx),
        Stmt::Local(loc) => {
            if let Some(init) = &loc.init {
                let (new_cov, terminated) = inspect_expr(&init.expr, cov.clone(), origins, completed, ctx);
                // Track origin: `let x = <expr>` or `let &x = <expr>` etc.
                if let Pat::Ident(pid) = &loc.pat {
                    let name = pid.ident.to_string();
                    let origin = resolve_origin(&init.expr, origins, ctx.it_name);
                    origins.set(&name, origin);
                }
                if terminated { return Out::Terminated; }
                return Out::Continue(new_cov);
            }
            Out::Continue(cov)
        }
        Stmt::Item(_) => Out::Continue(cov),
        Stmt::Macro(m) => Out::Continue(handle_macro_invocation(&m.mac, cov)),
    }
}

fn walk_expr_stmt(
    expr: &Expr,
    cov: Covered,
    origins: &mut OriginMap,
    completed: &mut Vec<Witness>,
    ctx: &Ctx,
) -> Out {
    let (new_cov, terminated) = inspect_expr(expr, cov, origins, completed, ctx);
    if terminated { Out::Terminated } else { Out::Continue(new_cov) }
}

fn inspect_expr(
    expr: &Expr,
    mut cov: Covered,
    origins: &mut OriginMap,
    completed: &mut Vec<Witness>,
    ctx: &Ctx,
) -> (Covered, bool) {
    match expr {
        Expr::Return(_) => {
            completed.push(Witness { kind: PathKind::Return, covered: cov });
            (Covered::full(), true)
        }
        Expr::Macro(m) => (handle_macro_invocation(&m.mac, cov), false),
        Expr::If(eif) => (walk_if(eif, cov, origins, completed, ctx), false),
        Expr::Match(em) => (walk_match(em, cov, origins, completed, ctx), false),
        Expr::Block(b) => (walk_block(&b.block, cov, origins.clone(), completed, ctx), false),
        Expr::Unsafe(b) => (walk_block(&b.block, cov, origins.clone(), completed, ctx), false),
        Expr::ForLoop(efl) => {
            cov = walk_for_loop(efl, cov, origins.clone(), completed, ctx);
            (cov, false)
        }
        Expr::While(ew) => {
            // While-body may run zero times. Don't merge body cov into outer.
            // But field credits emitted directly by the loop iterator (e.g.
            // `for v in &it.foo`) DO count via walk_for_loop. While doesn't
            // have that pattern, so just walk the body for its own assertions.
            let _ = walk_block(&ew.body, cov.clone(), origins.clone(), completed, ctx);
            (cov, false)
        }
        Expr::Loop(el) => {
            let _ = walk_block(&el.body, cov.clone(), origins.clone(), completed, ctx);
            (cov, false)
        }
        Expr::Call(call) => {
            cov = handle_call(call, cov, origins, ctx);
            (cov, false)
        }
        Expr::MethodCall(mc) => {
            cov = handle_method_call(mc, cov, origins, ctx);
            (cov, false)
        }
        Expr::Let(_) => (cov, false),
        Expr::Assign(a) => {
            let (c, _) = inspect_expr(&a.right, cov, origins, completed, ctx);
            (c, false)
        }
        _ => (cov, false),
    }
}

fn walk_if(
    eif: &ExprIf,
    cov: Covered,
    origins: &mut OriginMap,
    completed: &mut Vec<Witness>,
    ctx: &Ctx,
) -> Covered {
    // Detect `if let Pat = scrutinee { ... }` and update origins inside then.
    let mut then_origins = origins.clone();
    let mut scrut_field: Option<String> = None;
    if let Expr::Let(el) = eif.cond.as_ref() {
        bind_pattern_origins(&el.pat, &el.expr, &mut then_origins, ctx.it_name);
        if let Origin::Field(name) = resolve_origin(&el.expr, origins, ctx.it_name) {
            scrut_field = Some(name);
        }
    }
    let then_cov = walk_block(&eif.then_branch, cov.clone(), then_origins, completed, ctx);
    match &eif.else_branch {
        Some((_, e)) => {
            let else_cov = match e.as_ref() {
                Expr::Block(b) => {
                    walk_block(&b.block, cov.clone(), origins.clone(), completed, ctx)
                }
                Expr::If(inner) => walk_if(inner, cov.clone(), origins, completed, ctx),
                _ => cov.clone(),
            };
            Covered::intersect(&then_cov, &else_cov)
        }
        None => {
            // No else. If the if-let matched on &it.<field>, the implicit
            // false branch (None / non-matching variant) requires no further
            // walking — so the result is simply the then-coverage plus the
            // scrutinee's field (credited unconditionally). For a plain
            // condition (`if cond { ... }`) we can only retain the prior
            // coverage.
            if let Some(f) = &scrut_field {
                let mut c = then_cov;
                c.add_field(f);
                c
            } else {
                cov
            }
        }
    }
}

fn walk_match(
    em: &ExprMatch,
    cov: Covered,
    origins: &mut OriginMap,
    completed: &mut Vec<Witness>,
    ctx: &Ctx,
) -> Covered {
    // Enum-aware coverage: if the scrutinee is `&it.<field>` and field's type
    // T is an enum, the match covers `<field>` iff every R-variant V of T has
    // an arm whose body fully covers V (with the variant binding as the new
    // "it" of type V).
    let scrut_field = match resolve_origin(&em.expr, origins, ctx.it_name) {
        Origin::Field(name) => Some(name),
        _ => None,
    };
    let scrut_field_type = scrut_field.as_ref().and_then(|f| field_type(ctx, f));

    let mut arm_covs = Vec::new();
    for arm in &em.arms {
        let mut arm_origins = origins.clone();
        bind_pattern_origins(&arm.pat, &em.expr, &mut arm_origins, ctx.it_name);
        let mut arm_cov = cov.clone();
        match arm.body.as_ref() {
            Expr::Block(b) => {
                arm_cov = walk_block(&b.block, arm_cov, arm_origins, completed, ctx);
            }
            other => {
                let (c, terminated) = inspect_expr(other, arm_cov.clone(), &mut arm_origins, completed, ctx);
                arm_cov = if terminated { Covered::full() } else { c };
            }
        }
        arm_covs.push(arm_cov);
    }

    let mut base = {
        let mut it = arm_covs.clone().into_iter();
        let first = it.next().unwrap_or_else(Covered::full);
        it.fold(first, |acc, c| Covered::intersect(&acc, &c))
    };

    // Enum-aware promotion. Also credit each individually covered variant
    // by name (so callers can identify which variants of the enum are NOT
    // covered → used by the witness generator).
    if let (Some(field_name), Some(t)) = (&scrut_field, &scrut_field_type) {
        if let Some(def) = ctx.graph.nodes.get(t.as_str()) {
            if !def.variants.is_empty() {
                let mut all_covered = true;
                for v in def.variants {
                    if !ctx.graph.in_r(v) {
                        continue;
                    }
                    let arm = find_arm_for_variant(em, v);
                    let covered = arm.map(|a| arm_covers_variant(a, v, ctx)).unwrap_or(false);
                    if covered {
                        base.add_field(v);
                    } else {
                        all_covered = false;
                    }
                }
                if all_covered {
                    base.add_field(field_name);
                }
            }
        }
    }

    base
}

fn field_type(ctx: &Ctx, field: &str) -> Option<String> {
    let parent_ty = ctx.it_node_type?;
    let def = ctx.graph.nodes.get(parent_ty)?;
    def.fields
        .iter()
        .find(|f| f.name == field)
        .map(|f| f.ty.to_string())
}

fn check_match_covers_enum(
    em: &ExprMatch,
    enum_def: &crate::ast_table::NodeDef,
    ctx: &Ctx,
) -> bool {
    use crate::ast_table::NodeDef;

    // Build the set of R-variants we need to cover.
    let mut needed: Vec<&str> = Vec::new();
    for v in enum_def.variants {
        if ctx.graph.in_r(v) {
            needed.push(*v);
        }
    }

    // For each variant, find an arm that matches it and check its body covers V.
    for variant in &needed {
        let arm = find_arm_for_variant(em, variant);
        let Some(arm) = arm else { return false; };
        if !arm_covers_variant(arm, variant, ctx) {
            return false;
        }
    }
    let _: &NodeDef = enum_def;
    true
}

/// Find the first arm whose pattern matches `variant`. A wildcard arm
/// matches everything.
fn find_arm_for_variant<'a>(em: &'a ExprMatch, variant: &str) -> Option<&'a syn::Arm> {
    for arm in &em.arms {
        if arm_matches_variant(&arm.pat, variant) {
            return Some(arm);
        }
    }
    None
}

fn arm_matches_variant(pat: &Pat, variant: &str) -> bool {
    match pat {
        Pat::Wild(_) => true,
        Pat::Ident(p) if p.ident == "_" => true,
        Pat::TupleStruct(ts) => {
            // Path like `T::Variant(_)` or `Variant(_)`.
            ts.path
                .segments
                .last()
                .map(|s| s.ident == variant)
                .unwrap_or(false)
        }
        Pat::Path(p) => p
            .path
            .segments
            .last()
            .map(|s| s.ident == variant)
            .unwrap_or(false),
        Pat::Struct(s) => s
            .path
            .segments
            .last()
            .map(|s| s.ident == variant)
            .unwrap_or(false),
        Pat::Or(o) => o.cases.iter().any(|c| arm_matches_variant(c, variant)),
        Pat::Paren(p) => arm_matches_variant(&p.pat, variant),
        Pat::Reference(r) => arm_matches_variant(&r.pat, variant),
        _ => false,
    }
}

fn arm_covers_variant(arm: &syn::Arm, variant: &str, ctx: &Ctx) -> bool {
    // Extract the binding name (if any) from the arm pattern.
    let binding = extract_arm_binding(&arm.pat);
    let v_def = ctx.graph.nodes.get(variant);

    // Wildcard arm: must walk the binding itself (we have no binding name in
    // a wild arm — so the only way to cover an enum variant is to have made
    // the catch-all arm walk it via some other means, which is rare).
    // Conservative: wildcard arm only "covers" a variant if the arm body
    // contains a walk_all/walk::walk_* on the original scrutinee — out of
    // scope here. We return false to err on the safe side: a `_ => {}` arm
    // does NOT cover variants caught by it (unless those variants have no
    // R-fields themselves).
    if binding.is_none() {
        // Check if variant has any R-content.
        if let Some(d) = v_def {
            let has_r_field = d
                .fields
                .iter()
                .any(|f| ctx.graph.field_in_r(f));
            let has_r_variant = d.variants.iter().any(|v| ctx.graph.in_r(v));
            if !has_r_field && !has_r_variant {
                return true; // trivially covers (variant has no R-content)
            }
        } else {
            // unknown type → assume needs walking
        }
        // Wildcard arm with R-bearing variant — only covers if body terminates
        // with full walks (we don't currently introspect for this).
        return false;
    }

    let bname = binding.unwrap();
    let Some(v_def) = v_def else {
        return false;
    };

    // Run a mini analyze on the arm body, with `bname` as the new "it" and
    // v_def as the target type. We need this analysis to credit fields of
    // v_def via walks/helpers on `bname`.
    let body_block = match arm.body.as_ref() {
        Expr::Block(b) => b.block.clone(),
        other => {
            // wrap single expr in a block
            syn::Block {
                brace_token: Default::default(),
                stmts: vec![Stmt::Expr(other.clone(), None)],
            }
        }
    };
    let mut origins = OriginMap::new();
    origins.set(&bname, Origin::It);
    let paths = analyze_with_helpers_typed(
        &body_block,
        &bname,
        Some(variant),
        ctx.helpers,
        ctx.graph,
        origins,
    );

    // Coverage criterion for v_def (variant type):
    // - For struct-like: every R-field covered on every path.
    // - For enum-like: covered_all on every path (the arm must walk the whole
    //   sub-enum, e.g. via walk::walk_<variant>).
    for p in &paths {
        if !p.covered.all {
            if v_def.fields.is_empty() && !v_def.variants.is_empty() {
                return false;
            }
            for f in v_def.fields {
                if !ctx.graph.field_in_r(f) {
                    continue;
                }
                if !p.covered.fields.iter().any(|n| n == f.name) {
                    return false;
                }
            }
        }
    }
    true
}

fn extract_arm_binding(pat: &Pat) -> Option<String> {
    match pat {
        Pat::Ident(p) if p.ident == "_" => None,
        Pat::Ident(p) => Some(p.ident.to_string()),
        Pat::TupleStruct(ts) => {
            if let Some(inner) = ts.elems.first() {
                return extract_arm_binding(inner);
            }
            None
        }
        Pat::Tuple(t) => {
            if let Some(inner) = t.elems.first() {
                return extract_arm_binding(inner);
            }
            None
        }
        Pat::Struct(s) => {
            if let Some(f) = s.fields.first() {
                return extract_arm_binding(&f.pat);
            }
            None
        }
        Pat::Reference(r) => extract_arm_binding(&r.pat),
        Pat::Paren(p) => extract_arm_binding(&p.pat),
        Pat::Wild(_) => None,
        _ => None,
    }
}

fn walk_for_loop(
    efl: &ExprForLoop,
    mut cov: Covered,
    mut origins: OriginMap,
    completed: &mut Vec<Witness>,
    ctx: &Ctx,
) -> Covered {
    // Bind loop var → origin of iter (peeling .items/.elements/etc.).
    if let Pat::Ident(pid) = efl.pat.as_ref() {
        let name = pid.ident.to_string();
        let origin = origin_from_iter(&efl.expr, &origins, ctx.it_name);
        origins.set(&name, origin);
    }
    // The loop body runs over EVERY element. If the body fully covers each
    // element, the parent field IS covered. We detect this by running the
    // body and observing whether any field credits from `it.<field>` appear
    // via the loop variable's origin propagating to walks/helpers inside.
    let body_cov = walk_block(&efl.body, Covered::empty(), origins.clone(), completed, ctx);
    // Promote body covers up: anything credited in the body during this loop
    // applies to the outer cov as well (since the iteration covers ALL items
    // when the loop iterates over an `it.<field>` collection).
    if body_cov.all {
        cov.all = true;
    } else {
        for f in &body_cov.fields {
            cov.fields.insert(f.clone());
        }
    }
    cov
}

/// Bind locals from a pattern matched against a scrutinee expression. Used
/// for `if let`, `match`, and similar. Conservative — only handles common
/// shapes (TupleStruct, Struct with named, Ident).
fn bind_pattern_origins(pat: &Pat, scrut: &Expr, origins: &mut OriginMap, it_name: &str) {
    let scrut_origin = resolve_origin(scrut, origins, it_name);
    bind_pat_with_origin(pat, &scrut_origin, origins);
}

fn bind_pat_with_origin(pat: &Pat, origin: &Origin, origins: &mut OriginMap) {
    match pat {
        Pat::Ident(p) => {
            origins.set(&p.ident.to_string(), origin.clone());
            if let Some((_, sub)) = &p.subpat {
                bind_pat_with_origin(sub, origin, origins);
            }
        }
        Pat::Reference(r) => bind_pat_with_origin(&r.pat, origin, origins),
        Pat::TupleStruct(ts) => {
            for elem in &ts.elems {
                bind_pat_with_origin(elem, origin, origins);
            }
        }
        Pat::Tuple(t) => {
            for elem in &t.elems {
                bind_pat_with_origin(elem, origin, origins);
            }
        }
        Pat::Struct(s) => {
            for f in &s.fields {
                bind_pat_with_origin(&f.pat, origin, origins);
            }
        }
        Pat::Or(o) => {
            for case in &o.cases {
                bind_pat_with_origin(case, origin, origins);
            }
        }
        Pat::Paren(p) => bind_pat_with_origin(&p.pat, origin, origins),
        Pat::Slice(s) => {
            for elem in &s.elems {
                bind_pat_with_origin(elem, origin, origins);
            }
        }
        _ => {}
    }
}

fn handle_call(call: &syn::ExprCall, mut cov: Covered, origins: &OriginMap, ctx: &Ctx) -> Covered {
    // Recognize `walk::walk_*(self, target)` patterns.
    let Expr::Path(p) = call.func.as_ref() else { return cov };
    let segs: Vec<String> = p.path.segments.iter().map(|s| s.ident.to_string()).collect();
    if segs.len() < 2 || segs[0] != "walk" || !segs[1].starts_with("walk_") {
        return cov;
    }
    if call.args.len() < 2 { return cov; }
    let target = &call.args[1];
    apply_origin_to_cov(target, origins, ctx.it_name, &mut cov, /*all_if_root*/ true);
    cov
}

fn handle_method_call(
    mc: &syn::ExprMethodCall,
    mut cov: Covered,
    origins: &OriginMap,
    ctx: &Ctx,
) -> Covered {
    // self.helper(args) — receiver must be `self`.
    let Expr::Path(p) = mc.receiver.as_ref() else { return cov };
    if !p.path.is_ident("self") { return cov; }
    let name = mc.method.to_string();
    let Some(info) = ctx.helpers.get(&name) else { return cov };
    if !info.fully_covers { return cov; }
    // The helper covers its first AST arg. Find which positional arg
    // corresponds to the helper's `it` param. We only know it's the first
    // non-self arg by convention.
    if let Some(arg0) = mc.args.first() {
        apply_origin_to_cov(arg0, origins, ctx.it_name, &mut cov, /*all_if_root*/ true);
    }
    let _ = info;
    cov
}

fn apply_origin_to_cov(
    e: &Expr,
    origins: &OriginMap,
    it_name: &str,
    cov: &mut Covered,
    all_if_root: bool,
) {
    let o = resolve_origin(e, origins, it_name);
    match o {
        Origin::It => {
            if all_if_root { cov.all = true; }
        }
        Origin::Field(name) => cov.add_field(&name),
        Origin::Unknown => {}
    }
}

fn handle_macro_invocation(mac: &syn::Macro, mut cov: Covered) -> Covered {
    let name = mac.path.segments.iter().last().map(|s| s.ident.to_string()).unwrap_or_default();
    match name.as_str() {
        "walk_all" => cov.all = true,
        "walk_field" | "walk_field_ctx" | "skip_field" => {
            if let Some(f) = extract_field_name(&mac.tokens) {
                cov.add_field(&f);
            }
        }
        _ => {}
    }
    cov
}

pub fn extract_field_name(ts: &TokenStream) -> Option<String> {
    use proc_macro2::TokenTree;
    let toks: Vec<TokenTree> = ts.clone().into_iter().collect();
    let mut last: Option<String> = None;
    let mut i = 0;
    while i + 2 < toks.len() {
        if let (TokenTree::Ident(a), TokenTree::Punct(p), TokenTree::Ident(c)) =
            (&toks[i], &toks[i + 1], &toks[i + 2])
        {
            if a == "it" && p.as_char() == '.' {
                last = Some(c.to_string());
                i += 3;
                continue;
            }
        }
        i += 1;
    }
    last
}

pub fn extract_receiver_and_field(ts: &TokenStream) -> Option<(syn::Ident, String)> {
    use proc_macro2::TokenTree;
    let toks: Vec<TokenTree> = ts.clone().into_iter().collect();
    let mut found = None;
    let mut i = 0;
    while i + 2 < toks.len() {
        if let (TokenTree::Ident(a), TokenTree::Punct(p), TokenTree::Ident(c)) =
            (&toks[i], &toks[i + 1], &toks[i + 2])
        {
            if p.as_char() == '.' {
                found = Some((a.clone(), c.to_string()));
            }
        }
        i += 1;
    }
    found
}
