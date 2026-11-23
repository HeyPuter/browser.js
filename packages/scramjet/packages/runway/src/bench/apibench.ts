// node src/bench/apibench.ts [--base root] [--modes bare,sj] [--filter re]
// ns per call of common page operations, bare and proxied: what the hooks,
// and the rewriter's changes to page code, cost per use
import fs from "node:fs";
import path from "node:path";
import { chromium, type Frame } from "playwright";
import { Store, serveStore } from "./store.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
	const i = args.indexOf("--" + name);
	return i === -1 ? def : args[i + 1];
};
const modes = opt("modes", "bare,sj").split(",");
const filter = new RegExp(opt("filter", "."));

// each case: [name, setup (runs once, returns state), body (runs per op, gets state and i)]
const CASES = String.raw`
const div = document.createElement("div"); document.body.appendChild(div);
div.id = "d"; div.className = "c x";
for (let i = 0; i < 50; i++) { const p = document.createElement("p"); p.className = "c"; div.appendChild(p); }
const a = document.createElement("a"); a.href = "/x/y"; document.body.appendChild(a);
const img = document.createElement("img");
const obj = { location: 1, foo: 2, bar: 3 }; const keys = ["foo", "bar", "location"];
const arr = Array.from({ length: 100 }, (_, i) => i);
function pagefn(x) { return x + 1; }
let sink = 0;
window.CASES = [
	["control: arithmetic loop", (i) => { sink += i * 2; }],
	["control: JSON.stringify small", (i) => { sink += JSON.stringify({ a: i, b: [1, 2] }).length; }],
	["control: array map 100", () => { sink += arr.map((x) => x + 1).length; }],
	["control: method call", (i) => { sink += pagefn(i); }],
	["member: obj.foo", () => { sink += obj.foo; }],
	["member: obj[k] computed", (i) => { sink += obj[keys[i % 2]]; }],
	["member: obj[k] incl location", (i) => { sink += obj[keys[i % 3]] ? 1 : 0; }],
	["member: window.document", () => { sink += window.document ? 1 : 0; }],
	["member: self.top", () => { sink += self.top ? 1 : 0; }],
	["location.href read", () => { sink += location.href.length; }],
	["location.pathname read", () => { sink += location.pathname.length; }],
	["document.URL", () => { sink += document.URL.length; }],
	["document.cookie read", () => { sink += document.cookie.length; }],
	["document.cookie write", (i) => { document.cookie = "k" + (i % 5) + "=v" + i; }],
	["localStorage get", () => { sink += (localStorage.getItem("k") ?? "").length; }],
	["localStorage set", (i) => { localStorage.setItem("k", "v" + i); }],
	["getAttribute class", () => { sink += div.getAttribute("class").length; }],
	["setAttribute data-x", (i) => { div.setAttribute("data-x", "" + i); }],
	["setAttribute href", (i) => { a.setAttribute("href", "/p" + (i % 10)); }],
	["a.href read", () => { sink += a.href.length; }],
	["img.src set", (i) => { img.src = "/i" + (i % 10) + ".png"; }],
	["className get", () => { sink += div.className.length; }],
	["className set", (i) => { div.className = i % 2 ? "c x" : "c y"; }],
	["el.id read", () => { sink += div.id.length; }],
	["style.color set", (i) => { div.style.color = i % 2 ? "red" : "blue"; }],
	["style.setProperty", (i) => { div.style.setProperty("width", (i % 100) + "px"); }],
	["getComputedStyle().display", () => { sink += getComputedStyle(div).display.length; }],
	["createElement div", () => { sink += document.createElement("div") ? 1 : 0; }],
	["appendChild+removeChild", () => { const s = document.createElement("span"); div.appendChild(s); div.removeChild(s); }],
	["append/remove 1 node", () => { const s = document.createElement("span"); div.append(s); s.remove(); }],
	["textContent set", (i) => { img.textContent = "t" + i; }],
	["textContent get", () => { sink += div.textContent.length; }],
	["innerHTML set plain", (i) => { img.innerHTML = "<b>x" + (i % 10) + "</b><i>y</i>"; }],
	["innerHTML set w/ href", (i) => { img.innerHTML = '<a href="/z' + (i % 10) + '">x</a>'; }],
	["innerHTML get", () => { sink += div.innerHTML.length; }],
	["insertAdjacentHTML", () => { div.insertAdjacentHTML("beforeend", "<b>x</b>"); div.lastChild.remove(); }],
	["querySelector #id", () => { sink += document.querySelector("#d") ? 1 : 0; }],
	["querySelectorAll .c", () => { sink += document.querySelectorAll(".c").length; }],
	["getElementById", () => { sink += document.getElementById("d") ? 1 : 0; }],
	["children[0]", () => { sink += div.children[0] ? 1 : 0; }],
	["firstChild/nextSibling walk 50", () => { for (let n = div.firstChild; n; n = n.nextSibling) sink++; }],
	["addEventListener+remove", () => { const f = () => {}; div.addEventListener("click", f); div.removeEventListener("click", f); }],
	["dispatchEvent w/ listener", () => { div.dispatchEvent(new Event("ping")); }],
	["new Event", () => { sink += new Event("x") ? 1 : 0; }],
	["el.click() w/ listener", () => { div.click(); }],
	["new URL", (i) => { sink += new URL("/a/" + (i % 10), location.href).pathname.length; }],
	["Function toString native", () => { sink += Math.max.toString().length; }],
	["Function toString page fn", () => { sink += pagefn.toString().length; }],
	["new Error().stack", () => { sink += new Error("x").stack.length; }],
	["try/catch throw", () => { try { null.x; } catch (e) { sink++; } }],
	["history.replaceState", (i) => { history.replaceState({ i }, "", "?q=" + (i % 10)); }],
	["performance.now", () => { sink += performance.now() > 0 ? 1 : 0; }],
	["Date.now", () => { sink += Date.now() > 0 ? 1 : 0; }],
	["Math.random", () => { sink += Math.random(); }],
	["typeof window.x", () => { sink += typeof window.notdefined === "undefined" ? 1 : 0; }],
	["fn.call / fn.apply", (i) => { sink += pagefn.call(null, i) + pagefn.apply(null, [i]); }],
	["bind + call", (i) => { sink += pagefn.bind(null)(i); }],
	["eval small", (i) => { sink += eval("1+" + (i % 10)); }],
	["new Function", (i) => { sink += new Function("return " + (i % 10))(); }],
	["setTimeout+clearTimeout", () => { clearTimeout(setTimeout(() => {}, 1000)); }],
	["requestAnimationFrame+cancel", () => { cancelAnimationFrame(requestAnimationFrame(() => {})); }],
	["MutationObserver observe+disconnect", () => { const m = new MutationObserver(() => {}); m.observe(div, { childList: true }); m.disconnect(); }],
	["element.matches", () => { sink += div.matches(".c") ? 1 : 0; }],
	["classList.toggle", () => { div.classList.toggle("t"); }],
	["dataset read", () => { sink += (div.dataset.x ?? "").length; }],
	["getBoundingClientRect", () => { sink += div.getBoundingClientRect().width; }],
];
div.addEventListener("click", () => sink++);
div.addEventListener("ping", () => sink++);
window.runCase = (k) => {
	const [, fn] = window.CASES[k];
	for (let i = 0; i < 50; i++) fn(i);
	let n = 64, t;
	for (;;) {
		const s = performance.now();
		for (let i = 0; i < n; i++) fn(i);
		t = performance.now() - s;
		if (t > 60 || n > 1e7) break;
		n *= 4;
	}
	return (t * 1e6) / n;
};
window.caseNames = window.CASES.map((c) => c[0]);
window.benchReady = true;
`;

const DIR = path.resolve(import.meta.dirname, "../../bench-data/apibench");
fs.mkdirSync(DIR, { recursive: true });
const store = new Store(DIR);
store.entries = [];
store.byKey.clear();
store.byPath.clear();
store.record(
	"GET",
	"https://bench.test/",
	200,
	[["content-type", "text/html; charset=utf-8"]],
	Buffer.from(`<!doctype html><body><script>${CASES}</script>`)
);
store.save();
fs.writeFileSync(path.join(DIR, "url.txt"), "https://bench.test/");

process.env.RUNWAY_PORT_BASE ??= "4580";
const { startHarness, PORT } = await import("../harness/scramjet/index.ts");
const baseRoot = opt("base", "");
let BASE_PORT = 0;
if (baseRoot) {
	const saved = { ...process.env };
	process.env.RUNWAY_PORT_BASE = String(PORT + 4);
	process.env.RUNWAY_SCRAMJET_ROOT = baseRoot;
	const base = await import("../harness/scramjet/index.ts?base");
	BASE_PORT = base.PORT;
	await base.startHarness();
	process.env = saved;
}
await startHarness();
await serveStore(store, 4590);
const browser = await chromium.launch({ headless: true });

async function open(mode: string): Promise<Frame> {
	const context = await browser.newContext();
	const page = await context.newPage();
	if (mode === "bare") {
		await context.route("**/*", (route) => {
			const hit = store.lookup(route.request().method(), route.request().url());
			return hit
				? route.fulfill({
						status: hit.status,
						headers: Object.fromEntries(hit.headers),
						body: hit.body,
					})
				: route.fulfill({ status: 404, body: "" });
		});
		await page.goto("https://bench.test/");
		await page.waitForFunction(() => (window as any).benchReady);
		return page.mainFrame();
	}
	await page.goto(`http://localhost:${mode === "base" ? BASE_PORT : PORT}/`);
	await page.waitForFunction(() => (window as any).__runwayNavigate);
	await page.evaluate((s) => ((window as any).__runwayCleartextSite = s), {
		roots: ["bench.test"],
		httpPort: 4590,
	});
	if (profile) {
		const cdp = await context.newCDPSession(page);
		await cdp.send("Profiler.enable");
		await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
		(globalThis as any).__cdp = cdp;
	}
	const frame = (await (await page.$("#testframe"))!.contentFrame())!;
	await page.evaluate(() =>
		(window as any).__runwayNavigate("https://bench.test/")
	);
	await frame.waitForFunction(() => (window as any).benchReady, null, {
		timeout: 30000,
	});
	return frame;
}

// --profile file: a cpu profile of the last mode while it runs the cases
const profile = opt("profile", "");
const frames: Record<string, Frame> = {};
for (const m of modes) frames[m] = await open(m);
const names: string[] = await frames[modes[0]].evaluate(
	() => (window as any).caseNames
);
const rows: [string, number[]][] = [];
const cdp = (globalThis as any).__cdp;
if (cdp) await cdp.send("Profiler.start");
for (let k = 0; k < names.length; k++) {
	if (!filter.test(names[k])) continue;
	const vals: number[] = [];
	for (const m of modes) {
		// best of 3, against noise
		let best = Infinity;
		for (let r = 0; r < 3; r++)
			best = Math.min(
				best,
				await frames[m].evaluate((k) => (window as any).runCase(k), k)
			);
		vals.push(best);
	}
	rows.push([names[k], vals]);
}
if (cdp) {
	const { profile: p } = await cdp.send("Profiler.stop");
	fs.writeFileSync(profile, JSON.stringify(p));
}
const ref = modes.indexOf("bare");
console.log(
	"ns/op".padEnd(38) +
		modes.map((m) => m.padStart(10)).join("") +
		(ref !== -1 ? "   x bare" : "")
);
for (const [name, vals] of rows.sort((x, y) =>
	ref === -1 ? 0 : y[1][1] / y[1][ref] - x[1][1] / x[1][ref]
))
	console.log(
		name.slice(0, 37).padEnd(38) +
			vals.map((v) => v.toFixed(1).padStart(10)).join("") +
			(ref !== -1
				? (vals[vals.length - 1] / vals[ref]).toFixed(1).padStart(9)
				: "")
	);
await browser.close();
process.exit(0);
