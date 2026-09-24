import { incumbenceMatrix, type Pattern } from "../incumbence.ts";
import type { Test } from "../testcommon.ts";

/**
 * https://html.spec.whatwg.org/multipage/webappapis.html#backup-incumbent-settings-object-stack
 *
 * The backup incumbent settings object stack, across the callback-taking
 * members the proxy patches from the IDL. Every row hands the host the sink as
 * a *bound native* - `postMessage` on the top, bound - so the callback puts no
 * script of its own on the stack, and the only thing that can say who the
 * incumbent is is the entry "prepare to run a callback" pushed: the incumbent
 * when the callback was converted, which is when the page handed it over.
 *
 * The conversion is always made by a script of a *different* realm from the
 * one that owns the member being called, and usually from the one that later
 * makes the host run it, so an answer naming either of those is wrong in a
 * way the row can see.
 *
 * Every answer is measured against the bare browser, like the rest of the
 * incumbence matrix, and where Chromium and the spec disagree the row follows
 * Chromium and says so.
 */

/** the call to the top's `postMessage`, bound, as seen from `win` */
const bound = (win: string) =>
	`${win}.__top.postMessage.bind(${win}.__top, 'ping', '*', [])`;

const PATTERNS: Pattern[] = [
	// --- tasks ------------------------------------------------------------
	{
		name: "setinterval",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `var h = parent.setInterval(${fn("parent")}, 0); parent.setTimeout(function () { parent.clearInterval(h) }, 200)`,
		}),
	},
	{
		name: "raf",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.requestAnimationFrame(${fn("parent")})`,
		}),
	},
	{
		name: "idle",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.requestIdleCallback(${fn("parent")}, { timeout: 100 })`,
		}),
	},
	{
		name: "scheduler-posttask",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.scheduler.postTask(${fn("parent")})`,
		}),
	},
	{
		// converted by the sub, run by the top's timer: a realm on neither end
		name: "raf-three-realm",
		needsfn: true,
		build: (_c, fn) => ({
			sub: `parent.parent.requestAnimationFrame(${fn("parent.parent")})`,
		}),
	},
	{
		// a script-having callback converts the one that runs: the inner
		// conversion is the sub's script, whoever set the outer timer
		name: "nested-conversion",
		needsfn: true,
		build: (_c, fn) => ({
			sub: `parent.parent.setTimeout(function () { parent.parent.setTimeout(${fn("parent.parent")}) })`,
		}),
	},

	// --- observers ----------------------------------------------------------
	{
		name: "mutationobserver",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `new parent.MutationObserver(${fn("parent")}).observe(parent.document.body, { attributes: true }); parent.document.body.setAttribute('data-x', '1')`,
		}),
	},
	{
		name: "resizeobserver",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `new parent.ResizeObserver(${fn("parent")}).observe(parent.document.body)`,
		}),
	},
	{
		name: "intersectionobserver",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `new parent.IntersectionObserver(${fn("parent")}).observe(parent.document.body)`,
		}),
	},
	{
		name: "performanceobserver",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `new parent.PerformanceObserver(${fn("parent")}).observe({ entryTypes: ['mark'] }); parent.performance.mark('snarkle')`,
		}),
	},

	// --- event handlers and listeners ---------------------------------------
	{
		// an event handler IDL attribute converts on set
		name: "onmessage-port",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `var c = new parent.MessageChannel(); c.port1.onmessage = ${fn("parent")}; c.port2.postMessage(0)`,
		}),
	},
	{
		name: "listener-port",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `var c = new parent.MessageChannel(); c.port1.addEventListener('message', ${fn("parent")}); c.port1.start(); c.port2.postMessage(0)`,
		}),
	},
	{
		// dispatched synchronously by the top's script: the entry the dispatch
		// pushes outranks the top, which is still on the stack beneath it
		name: "onclick-sync",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.document.body.onclick = ${fn("parent")}`,
			top: "onload = () => document.body.click()",
		}),
	},
	{
		name: "onabort-sync",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.ctl = new parent.AbortController(); parent.ctl.signal.onabort = ${fn("parent")}`,
			top: "onload = () => ctl.abort()",
		}),
	},
	{
		name: "listener-abort-sync",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.ctl = new parent.AbortController(); parent.ctl.signal.addEventListener('abort', ${fn("parent")})`,
			top: "onload = () => ctl.abort()",
		}),
	},
	{
		// a callback interface: an object, whose `handleEvent` is looked up
		// when it runs
		name: "listener-object",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.addEventListener('snarkle', { handleEvent: ${fn("parent")} })`,
			top: "onload = () => dispatchEvent(new Event('snarkle'))",
		}),
	},
	{
		name: "listener-once",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.addEventListener('snarkle', ${fn("parent")}, { once: true })`,
			top: "onload = () => dispatchEvent(new Event('snarkle'))",
		}),
	},
	{
		// a duplicate registration is a no-op, so the first conversion's entry
		// is the one that stays
		name: "listener-duplicate",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.shared = ${fn("parent")}; parent.addEventListener('snarkle', parent.shared)`,
			sub: "parent.parent.addEventListener('snarkle', parent.parent.shared)",
			top: "onload = () => dispatchEvent(new Event('snarkle'))",
		}),
	},
	{
		// removed and added again: a new registration, converted by the sub
		name: "listener-readded",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.shared = ${fn("parent")}; parent.addEventListener('snarkle', parent.shared)`,
			sub: "parent.parent.removeEventListener('snarkle', parent.parent.shared); parent.parent.addEventListener('snarkle', parent.parent.shared)",
			top: "onload = () => dispatchEvent(new Event('snarkle'))",
		}),
	},
	{
		// an event handler attribute set again converts again
		name: "onhandler-reassigned",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.shared = ${fn("parent")}; parent.document.body.onclick = parent.shared`,
			sub: "parent.parent.document.body.onclick = parent.parent.shared",
			top: "onload = () => document.body.click()",
		}),
	},
	{
		// the getter hands back the page's own function, not a stand-in
		name: "onhandler-identity",
		build: () => ({
			frame: `var f = function () {}; parent.document.body.onclick = f; parent.__top.postMessage(parent.document.body.onclick === f ? 'same' : 'different', '*')`,
		}),
	},
	{
		name: "mediaquerylist-listener",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `var m = parent.matchMedia('(min-width: 1px)'); m.addListener(${fn("parent")}); m.dispatchEvent(new parent.MediaQueryListEvent('change'))`,
		}),
	},

	// --- other callback members -------------------------------------------
	{
		name: "canvas-toblob",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.document.createElement('canvas').toBlob(${fn("parent")})`,
		}),
	},
	{
		name: "locks-request",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.navigator.locks.request('snarkle', ${fn("parent")})`,
		}),
	},
	{
		// a callback interface run synchronously by the top's script, which
		// the callback's entry outranks
		name: "treewalker-filter",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.walker = parent.document.createTreeWalker(parent.document.body, 1, ${fn("parent")})`,
			top: "onload = () => walker.nextNode()",
		}),
	},
	{
		name: "treewalker-filter-object",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.walker = parent.document.createTreeWalker(parent.document.body, 1, { acceptNode: ${fn("parent")} })`,
			top: "onload = () => walker.nextNode()",
		}),
	},
	{
		name: "treewalker-filter-identity",
		build: () => ({
			frame: `var f = { acceptNode: function () { return 1 } }; var w = parent.document.createTreeWalker(parent.document.body, 1, f); parent.__top.postMessage(w.filter === f ? 'same' : 'different', '*')`,
		}),
	},
	{
		// a callback member of a dictionary, run synchronously by the top's
		// script - which the callback's entry outranks
		name: "dictionary-callback",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.policy = parent.trustedTypes.createPolicy('snarkle', { createHTML: ${fn("parent")} })`,
			top: "onload = () => policy.createHTML('')",
		}),
	},
	{
		// `(ViewTransitionUpdateCallback or StartViewTransitionOptions)`: the
		// dictionary half
		name: "union-dictionary",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.document.startViewTransition({ update: ${fn("parent")} })`,
		}),
	},
	{
		// and the callback half
		name: "union-callback",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.document.startViewTransition(${fn("parent")})`,
		}),
	},
	{
		// Chromium, not the spec: a queuing strategy's `size` is called as a
		// plain function, with no callback prepared, so the top's script that
		// enqueued is the incumbent. The member is left out of the expansion
		name: "strategy-size",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `new parent.ReadableStream({ start: function (c) { parent.ctlr = c } }, { highWaterMark: 1, size: ${fn("parent")} })`,
			// the sink answers undefined, which `enqueue` rejects as a size
			top: "onload = () => { try { ctlr.enqueue(1) } catch (e) {} }",
		}),
	},

	// --- promise reactions -----------------------------------------------
	{
		// Chromium, not the spec: a reaction runs under the handler's own
		// realm - for a bound function, its target's - where HostMakeJobCallback
		// would have recorded the realm that called `then`
		name: "promise-then-crossrealm",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.Promise.resolve().then(${fn("parent")})`,
		}),
	},
	{
		// Chromium runs the checkpoint after a callback with the callback's
		// entry still in effect, so the reaction finds it. HTML reaches the same
		// answer another way - HostMakeJobCallback records the frame, which
		// called `then` - and `promise-then-crossrealm` is where the two part
		name: "promise-then-in-callback",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.setTimeout(function () { Promise.resolve().then(${fn("parent")}) })`,
		}),
	},

	// --- script on the stack ------------------------------------------------
	{
		// the callback is a script: it is the topmost script-having context,
		// entered after the entry was pushed, and answers for itself
		name: "script-callback",
		build: (c) => ({
			frame: `parent.setTimeout(function () { ${c("parent")} })`,
		}),
	},
	{
		// a script-having callback that calls the sink through a builtin: no
		// callback is prepared for `forEach`, so the frame's script is still
		// the topmost script-having context, and the top that converted the
		// timer is not asked
		name: "script-callback-builtin",
		needsfn: true,
		build: (_c, fn) => ({
			frame: `parent.go = function () { [0].forEach(${fn("parent")}) }`,
			top: "onload = () => setTimeout(go)",
		}),
	},
];

/** The same answers for the setup in `incumbent-postmessage.ts`. */
const matrix = (prefix: string, expect: Record<string, string>) =>
	incumbenceMatrix({
		prefix,
		patterns: PATTERNS,
		sink: (win) => `${win}.__top.postMessage('ping', '*')`,
		sinkfn: bound,
		setup: {
			top: `addEventListener('message', function (e) {
				if (e.data === 'same' || e.data === 'different') {
					if (e.data === 'same') pass('same'); else fail('different');
					return;
				}
				var realm = 'unknown';
				try {
					if (e.source === window) realm = 'top';
					else if (e.source === frames[0]) realm = 'frame';
					else if (frames[0] && e.source === frames[0].frames[0]) realm = 'sub';
				} catch (err) {}
				__report(realm);
			})`,
		},
		expect: expect as any,
	});

const EXPECT: Record<string, string> = {
	setinterval: "frame",
	raf: "frame",
	idle: "frame",
	"scheduler-posttask": "frame",
	"raf-three-realm": "sub",
	"nested-conversion": "sub",
	mutationobserver: "frame",
	resizeobserver: "frame",
	intersectionobserver: "frame",
	performanceobserver: "frame",
	"onmessage-port": "frame",
	"listener-port": "frame",
	"onclick-sync": "frame",
	"onabort-sync": "frame",
	"listener-abort-sync": "frame",
	"listener-object": "frame",
	"listener-once": "frame",
	"listener-duplicate": "frame",
	"listener-readded": "sub",
	"onhandler-reassigned": "sub",
	"onhandler-identity": "frame",
	"mediaquerylist-listener": "frame",
	"canvas-toblob": "frame",
	"locks-request": "frame",
	"treewalker-filter": "frame",
	"treewalker-filter-object": "frame",
	"treewalker-filter-identity": "frame",
	"dictionary-callback": "frame",
	"union-dictionary": "frame",
	"union-callback": "frame",
	"strategy-size": "top",
	"promise-then-crossrealm": "top",
	"promise-then-in-callback": "frame",
	"script-callback": "frame",
	"script-callback-builtin": "frame",
};

/**
 * The rows `backupIncumbency: "bind"` cannot answer, and why. It records the
 * incumbent of whoever *bound* the sink, not of whoever converted it, and it
 * records it for promise reactions and strategies too.
 */
const BIND_MISSES = new Set([
	// the sub converts a function the frame bound
	"listener-readded",
	"onhandler-reassigned",
	// Chromium answers with the top; the bound stand-in still pushes the frame
	"promise-then-crossrealm",
	"strategy-size",
]);

/** The rows `backupIncumbency: "none"` still answers: those with script on the stack. */
const NONE_ANSWERS = new Set([
	"script-callback",
	"strategy-size",
	"promise-then-crossrealm",
]);

// under the default `pst`
const modes: [string, "full" | "bind" | "none", (row: string) => boolean][] = [
	["incumbent-backup", "full", () => true],
	["incumbent-backup-bind", "bind", (row) => !BIND_MISSES.has(row)],
	["incumbent-backup-none", "none", (row) => NONE_ANSWERS.has(row)],
];

const tests: Test[] = [];
for (const [prefix, mode, answers] of modes) {
	const expect = Object.fromEntries(
		Object.entries(EXPECT).filter(([row]) => answers(row))
	);
	for (const test of matrix(prefix, expect)) {
		test.backupIncumbency = mode;
		tests.push(test);
	}
}

// the stamp modes read no stack: the rewriter stamps each conversion's realm
// (see `stampfn`), and a stamp made after a callback's entry outranks it
for (const test of matrix("incumbent-backup-lazystamp", EXPECT)) {
	test.backupIncumbency = "full";
	test.incumbencyMode = "lazystamp";
	tests.push(test);
}

export default tests;
