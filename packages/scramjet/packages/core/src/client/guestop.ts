/**
 * The guest-op seam: what the guest asked scramjet for, and what it got.
 *
 * Recorded from INSIDE the traps scramjet already installs -- `RawProxy`'s
 * `h.apply` and `h.construct`, `Intercept`'s `createProxy`, `RawTrap`'s
 * accessor closures, and the four hand-hooked seams below. Three edits to three
 * funnels, deliberately, and the reason is worth keeping because the cheaper
 * shape was tried first and was wrong.
 *
 * `ScramjetClient.installNative` is the single point all three mechanisms put a
 * patched member back through, so hooking it wrapped everything at once for
 * eight lines. What it wrapped was the `Proxy` those mechanisms install, and a
 * plain wrapper around a Proxy is a different OBJECT: no `[native code]`, no
 * inherited prototype chain, not in `box.unproxy`. Cloudflare's `jsd` census
 * reads exactly that from a pristine child realm, and the sandbox's shimmed
 * members came back non-native (FINDINGS.md #224). One hook in the wrong place
 * cost more than three in the right ones.
 *
 * What it buys: the differ can compare an intercepted API at all. Without it
 * the guest's call reaches a trap, the trap calls the native, and the native's
 * trace record has scramjet's script on top -- so a differ that pairs guest
 * calls against guest calls sees zero of them on the sandbox side. On
 * rateyourmusic that was 43 APIs and 1344 calls in the page realm alone,
 * reported as `missing-call` and baselined into silence.
 *
 * Inert unless the harness installed a recorder: one symbol lookup, once, at
 * install time. Nothing is added to the hot path of a normal build -- the
 * wrapper functions below are never created when the symbol is absent.
 *
 * The recorder itself is NOT here. It lives in the runway harness
 * (`sbxdiff-guestop.js`), because it is measurement apparatus and scramjet
 * should not ship it. This file is only the seam.
 */

const GUESTOP = Symbol.for("sbxdiff.guestop");

type Recorder = {
	/** Runs `fn`, records it if this is the OUTERMOST interception. */
	around<T>(member: string, op: string, args: unknown[], fn: () => T): T;
	note(member: string, kind: string): void;
	threw(name: string, message: string): void;
};

/**
 * Resolved once, lazily, rather than captured at module load.
 *
 * The harness's probe runs with scramjet's bootstrap, and module evaluation
 * order between the two is not something to depend on. Reading it on the first
 * `installNative` is after the probe and before any guest code.
 */
let resolved: Recorder | null | undefined;

function recorder(): Recorder | null {
	if (resolved === undefined) {
		const g = globalThis as unknown as Record<symbol, Recorder | undefined>;
		resolved = g[GUESTOP] ?? null;
		// Taken off the global the moment it is in hand.
		//
		// `Object.getOwnPropertyNames` does not list symbols, which is what the
		// symbol was chosen for -- but `Object.getOwnPropertySymbols` and
		// `Reflect.ownKeys` DO, and `Symbol.keyFor` on a registered symbol hands
		// back the string "sbxdiff.guestop". An instrument that names itself on
		// the global of a page built to fingerprint its environment is not an
		// instrument, it is a tell.
		//
		// Safe to delete here because this resolution happens during scramjet's
		// bootstrap -- the first `installNative` -- which is ahead of any guest
		// script, the same ordering guarantee that lets the recorder capture its
		// sink before scramjet patches it.
		if (resolved) delete g[GUESTOP];
	}

	return resolved;
}

/**
 * Declare, at install time, that this member is intercepted.
 *
 * `coverage.ts` needs to tell "scramjet traps this and the guest never called
 * it" from "scramjet does not trap this", and the two look identical from a
 * trace in which neither appears. Reported rather than inferred.
 */
export function guestOpNote(member: string, kind: string): void {
	recorder()?.note(member, kind);
}

/**
 * Record an error scramjet BUILT, with its text.
 *
 * `around` already notes that a call threw, but it records the thrown value as
 * an identity tag and nothing more -- deliberately, because reflecting on an
 * arbitrary thrown object can run a page getter, which is the one thing
 * RULES.md #1 forbids. So the message, which is the only part a detector reads,
 * was never recorded at all.
 *
 * Here it is safe, and only here: this is called from `NativeErrors.stamp` with
 * an error scramjet has just constructed from a snapshotted constructor in its
 * own realm, one instruction earlier. It is not a value from the page.
 *
 * Worth recording because error TEXT is a first-class fingerprinting surface
 * and the challenge reads it on purpose. Measured on rateyourmusic, Cloudflare
 * throws three invalid selectors at `querySelector` and pushes a cross-origin
 * history state, catching each one; the blob workers do
 * `catch(e){postMessage({gQTuX1:String(e)})}`, which ships the text home. A
 * message that names the proxy loses the run, and a message that merely differs
 * is a signal. Neither was visible: the C++ tracer records a `kException` only
 * when a BLINK BINDING throws, and an API scramjet handles in JS never reaches
 * the binding, so the sandbox produced 3 exception records against the oracle's
 * 31 and the differ compared none of them.
 *
 * The recorder's depth gate does not apply. An error is built inside the trap
 * that rejects the call, so it is always nested, and gating it would drop every
 * one -- but it is not scramjet working, it is what the guest receives.
 *
 * Inert, and free, when no recorder is installed.
 */
export function guestOpThrow(error: object): void {
	const rec = recorder();
	if (!rec) return;
	const e = error as { name?: unknown; message?: unknown };
	rec.threw(
		typeof e.name === "string" ? e.name : "",
		typeof e.message === "string" ? e.message : ""
	);
}

/**
 * The name to record this member under, or `""` when nothing is recording.
 *
 * Resolving it means reading `owner.constructor.name`, and the seams call this
 * once per trapped member at install time -- several hundred of them in an
 * ordinary page. A normal build has no recorder, and then the name is never
 * used for anything, so it is never computed: this is the difference between
 * "inert" and "free". `guestOpAround` is inert with any name at all, so `""` is
 * safe to hand it.
 */
export function guestOpMemberName(native: {
	debugname: string;
	key: string | symbol;
	owner?: unknown;
}): string {
	return recorder() ? memberName(native) : "";
}

/**
 * Record one guest op directly, for a seam that is not a descriptor install.
 *
 * The rewriter's `$scramjet$location`, `$scramjet$parent` and `$scramjet$top`
 * accessors are the other half of the interception surface: guest code that
 * writes `location` is REWRITTEN to read one of them, so no interceptor is
 * involved and `installNative` never sees it. They are also where the largest
 * remaining hole was -- 67 `window.location` reads on rateyourmusic with no
 * sandbox counterpart -- and where the cross-origin boundary is decided.
 *
 * Takes the member name per call rather than per install, because one accessor
 * answers for two APIs: `$scramjet$location` on the window is
 * `Window.location.get` and on the document is `HTMLDocument.location.get`,
 * and the oracle records those separately.
 *
 * Inert, and free, when no recorder is installed.
 */
export function guestOpAround<T>(
	member: string,
	op: string,
	args: unknown[],
	fn: () => T
): T {
	const rec = recorder();

	return rec ? rec.around(member, op, args, fn) : fn();
}

/**
 * Wrap a descriptor about to be installed so every guest entry through it is
 * recorded.
 *
 * **Only for a descriptor scramjet AUTHORED.** `location.ts` and
 * `dom/element.ts` build their own `get`/`set` closures and define them
 * straight onto an object, so a wrapper around one is another scramjet closure
 * where there was already a scramjet closure -- no new observable class.
 *
 * It must NOT be used on what `installNative` installs, and that is not a
 * stylistic preference. What `installNative` installs is a `Proxy` over the
 * native: V8 renders a callable Proxy as `function () { [native code] }`, it
 * inherits the target's prototype chain so `instanceof` holds in any realm, and
 * `client.box.unproxy` maps it back. A plain wrapper is none of the three, and
 * Cloudflare's `jsd` census reads exactly that pair --
 * `Z instanceof X.Function && toString.call(Z).indexOf("[native code]") > 0` --
 * from a pristine child realm. It classified the sandbox's shimmed members as
 * non-native and three of the four graded payload bodies were this wrapper
 * rather than the sandbox (FINDINGS.md #224, #227). Wrapping with a Proxy
 * instead fixes the census and breaks `unproxy`, which is worse (#226).
 *
 * The seams that install through `installNative` record inside the trap bodies
 * they already have instead -- `RawProxy`'s `h.apply`, `Intercept`'s
 * `createProxy`, `RawTrap`'s accessor closures -- so nothing is added to the
 * page at all.
 *
 * Mutates in place: the caller owns this descriptor and has not defined it yet.
 *
 * `get`/`set`/`value` and nothing else. A data property whose value is not
 * callable is left alone -- there is no call to record.
 */
export function recordGuestOps(
	native: { debugname: string; key: string | symbol; owner?: unknown },
	next: PropertyDescriptor
): void {
	const rec = recorder();
	if (!rec) return;
	const member = memberName(native);

	if (typeof next.get === "function") {
		const inner = next.get;
		rec.note(member, "get");
		next.get = function (this: unknown) {
			return rec.around(member, "get", [], () => inner.call(this));
		};
	}
	if (typeof next.set === "function") {
		const inner = next.set;
		rec.note(member, "set");
		next.set = function (this: unknown, v: unknown) {
			return rec.around(member, "set", [v], () => inner.call(this, v));
		};
	}
	if (typeof next.value === "function") {
		const inner = next.value as (...a: unknown[]) => unknown;
		rec.note(member, "call");
		// A plain function, not a Proxy: the value here is ALREADY a Proxy over
		// the native (that is what `RawProxy` and `Intercept` install), and
		// wrapping a Proxy in another Proxy doubles every trap the page can
		// observe. A function forwards `new.target` badly, so a constructor
		// member keeps its Proxy untouched -- `construct` is recorded by the
		// funnel itself, not here.
		//
		// `Function.prototype.toString` on this would render the wrapper, so
		// the unproxy table scramjet keeps for `shared/sourcemaps.ts` is what
		// answers instead, and it maps the Proxy, which is unchanged.
		if (!isConstructorish(inner)) {
			next.value = function (this: unknown, ...args: unknown[]) {
				return rec.around(member, "call", args, () => inner.apply(this, args));
			};
			// Carry the identity a page can read off a function. Without these
			// the wrapper reports `length 0` and the wrong `name`, which is a
			// difference a fingerprinter reads directly.
			try {
				Object.defineProperty(next.value, "name", {
					value: inner.name,
					configurable: true,
				});
				Object.defineProperty(next.value, "length", {
					value: inner.length,
					configurable: true,
				});
			} catch {
				/* frozen in some engine; the name is a nicety, not the point */
			}
		}
	}
}

/**
 * The name to record this member under.
 *
 * Most call sites pass a dotted `debugname` and it is used as-is. Some do not:
 * `element.ts` traps `host`, `pathname` and the rest of the URL properties in a
 * loop over several interfaces, `event.ts` traps every `on*` handler the same
 * way, and `memory.ts` traps `performance.memory`. Those arrive as a bare
 * property name, which maps to `Window.host` -- a member no browser has, and a
 * name the oracle's trace can never match, so the op would read as "the
 * sandbox never did this".
 *
 * The owner knows. `resolveNative` has already walked to the object that really
 * owns the member, which is the interface prototype, and reading its
 * `constructor.name` happens once at install time -- before any guest code
 * exists to have replaced it.
 */
function memberName(native: {
	debugname: string;
	key: string | symbol;
	owner?: unknown;
}): string {
	const key = String(native.key);
	if (native.debugname && native.debugname.includes("."))
		return native.debugname;
	const owner = native.owner as { constructor?: { name?: string } } | undefined;
	let iface: string | undefined;
	try {
		iface = owner?.constructor?.name;
	} catch {
		/* a getter that throws; fall through to the bare name */
	}

	return iface ? `${iface}.${key}` : native.debugname || key;
}

/**
 * Does this look like something the page will `new`?
 *
 * A wrapper built from a plain function cannot stand in for a constructor --
 * `new` through it throws or loses `new.target` -- so constructors are left
 * with their own Proxy, which handles `construct` correctly. The test is the
 * presence of a non-writable `prototype`, which is what a class and a native
 * constructor have and an ordinary method does not.
 */
function isConstructorish(fn: (...a: unknown[]) => unknown): boolean {
	const d = Object.getOwnPropertyDescriptor(fn, "prototype");

	return !!d && d.writable === false;
}
