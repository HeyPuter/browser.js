// Random programs for the `elide_diff` test: values reached from the window and document, moved
// through locals, parameters, patterns and chains, and used every way the analysis distinguishes.
//
//   node generate.mjs <cases> <seed> <out dir>
//   ELIDE_DIFF=<out dir> cargo test -p native --release elide_diff -- --nocapture
//
// `THIS=0` leaves out the uses that call a function through an unwrapped receiver and read its
// `this`, which only `ppsc_wrap_this` answers as the proxy would: those cases go in
// `ELIDE_DIFF_THIS` instead.
import fs from "node:fs";
let seed = Number(process.argv[3] ?? 1);
const outDir = process.argv[4] ?? ".";
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const SRC = ["window", "document", "self", "frames", "window.document", "self.window", "(typeof window < 'u' ? window : {})", "(window.nope || document)", "(0, window)", "window?.document"];
let n = 0;
const v = () => "v" + n++;
const withThis = process.env.THIS !== "0";
function use(x) {
  return pick([
    `${x}.location.href`, `${x}["location"].href`, `${x}[K].href`, `String(${x}.title ?? ${x}.innerWidth)`,
    `${x}?.location?.href`, `${x}?.document?.location?.href`, `(${x}.document || ${x}).location.href`,
    `R(${x})`, `(function(){ return ${x} })().location.href`, `(() => ${x})().location.href`,
    `[${x}][0].location.href`, `({ q: ${x} }).q.location.href`, `String(${x} === PW || ${x} === PD)`,
    `String(${x} === window || ${x} === document)`, `typeof ${x}`, `String("title" in ${x})`,
    `(O.f = ${x}, O.f.location.href)`, `String(!${x})`, `${x}.defaultView ? ${x}.defaultView.location.href : "nd"`,
    `(${x}.top || ${x}).location.href`, `String(${x}.self === ${x})`,
    ...(withThis ? [`((${x}).pm = function(){ return this && this.location ? this.location.href : "nl" }, ${x}.pm())`] : []),
    ...(withThis ? [`((${x}).pt = function(s){ return this && this.location ? this.location.href : "nl" }, (${x}).pt\`q\`)`] : []),
    `((${x}).pk = function(){ this.v = 1 }, String(new (${x}).pk().v))`, `String(${x}.createElement ? ${x}.createElement("a").ownerDocument === document : "ne")`,
    ...(withThis ? [`(${x}.addEventListener ? (${x}.addEventListener("e", function(){ out += (this.location && this.location.href) + "|" }), "ae") : "nae")`] : []),
    `((${x}).px = 1, String(window.px || document.px))`, `((${x}).title = "t2", String(document.title))`,
  ]);
}
function stmt(x, depth) {
  const y = v();
  const forms = [
    () => `var ${y} = ${x}; out += ${use(y)} + ";";`,
    () => `let ${y} = ${x}; ${y} = ${pick([x, "{}", "O", y])}; out += ${use(y)} + ";";`,
    () => `const ${y} = ${x}; out += (function(){ return ${use(y)} })() + ";";`,
    () => `out += (function(${y}){ ${depth ? stmt(y, depth - 1) : ""} return ${use(y)} })(${x}) + ";";`,
    () => `out += (function(r, f){ return f(r) })(${x}, function(${y}){ ${depth ? stmt(y, depth - 1) : ""} return ${use(y)} }) + ";";`,
    () => `var { document: ${y} = document } = ${pick(["window", "self", x])}; out += ${use(y)} + ";";`,
    () => `var ${y}; for (var i = 0; i < 2; i++) { ${y} = i ? ${x} : ${pick(["window", "document", "O"])}; out += ${use(y)} + ";"; }`,
    () => `var ${y} = ${x}; if (${pick(["true", "false"])}) ${y} = ${pick(["O", "window", "document"])}; out += ${use(y)} + ";";`,
    () => `function ${y}f(${y}) { return ${use(y)} } out += ${y}f(${x}) + ${y}f(O) + ";";`,
    () => `var ${y} = ${x}; ${pick(["", "eval('0');", "arguments.length;"])} out += ${use(y)} + ";";`,
    () => `out += ${use(x)} + ";";`,
    () => `var ${y} = ${x}; var ${y}g = function(){ return ${use(y)} }; ${y} = ${pick(["O", "window", "document", y])}; out += ${y}g() + ";";`,
    () => `try { throw ${x} } catch (${y}) { out += ${use(y)} + ";"; }`,
    () => `for (const ${y} of [${x}, O]) out += ${use(y)} + ";";`,
    () => `class ${y}C { f = ${x}; m() { return this.f } } var ${y} = new ${y}C().m(); out += ${use(y)} + ";";`,
    () => `var ${y}a = (${y}) => ${use(y)}; out += ${y}a(${x}) + ";";`,
    () => `var ${y}, ${y}b; ${y} = ${y}b = ${x}; out += ${use(y)} + ${use(y + "b")} + ";";`,
    () => `var ${y}; out += String((${y} = ${x}).title) + ${use(y)} + ";";`,
    () => `var ${y}; out += R(${y} = ${x}) + ${use(y)} + ";";`,
    () => `var ${y}; for (${y} = ${x}, i = 0; i < 2; i++, ${y} = ${pick(["O", "window", "document"])}) out += ${use(y)} + ";";`,
    () => `function ${y}h() { try { return ${use(y)} } catch (e) { return "early" } } out += ${y}h() + ";"; var ${y} = ${x}; out += ${y}h() + ";";`,
    () => `switch (${pick(["1", "2"])}) { case 1: var ${y} = ${x}; case 2: try { out += ${use(y)} + ";"; } catch (e) { out += "sw;"; } }`,
    () => `let ${y} = ${x}; { let ${y} = O; out += ${use(y)} + ";"; } out += ${use(y)} + ";";`,
    () => `var ${y} = ${x}; out += (function(){ var window = O, document = O; return ${use(y)} })() + ";";`,
    () => `var ${y} = [${x}]; out += ${use(y + "[0]")} + ";";`,
    () => `var ${y} = { get g() { return ${x} } }; out += ${use(y + ".g")} + ";";`,
    () => `out += (function(){ var ${y} = ${x}; return function(){ return ${use(y)} } })()() + ";";`,
    () => `var { ${pick(["document", "self", "window", "innerWidth"])}: ${y} } = ${x}; out += ${use(y)} + ";";`,
  ];
  return pick(forms)();
}
const cases = [];
const N = Number(process.argv[2] ?? 500);
for (let c = 0; c < N; c++) {
  n = 0;
  const body = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => stmt(pick(SRC), 2)).join("\n  ");
  cases.push(`T("g${c}", function(){ var out = "", K = "location", O = { location: { href: "O" }, title: "O" };\n  ${body}\n  return out; });`);
}
const pre = `function R(x){ return x && x.location ? x.location.href : "none" }\n`;
fs.writeFileSync(`${outDir}/gen-${process.argv[3] ?? 1}.js`, pre + cases.join("\n") + "\n");
