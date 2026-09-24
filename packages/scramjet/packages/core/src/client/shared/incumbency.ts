import { ScramjetClient } from "@client/index";
import {
	Object_defineProperty,
	Reflect_apply,
	Reflect_construct,
} from "@/shared/snapshot";
import { CallSite, incumbencyMode, rawCallSites } from "@/shared/incumbency";
import { flagValue } from "@/shared";

/**
 * What one rewritten script has to be made to look like, and how a frame is
 * traced back to it.
 */
export type ScriptRealm = {
	/**
	 * The realm the script was evaluated in, and the whole point of the
	 * exercise - `SingletonBox` is shared across the client tree, so a record
	 * in it says nothing about which realm without the client that put it there.
	 *
	 * Sound because `registerrealmfn` is installed per realm, on each realm's
	 * own global: a script resolving that identifier necessarily reaches its
	 * own realm's copy, so the client this closure captured is the script's.
	 */
	client: ScramjetClient;
	/** the scramtag the rewriter stamped into this script's functions */
	tag: string;
};

/**
 * Only the modes that install anything. `none` records nothing and gets no
 * globals - a global nothing calls is a surface for nothing.
 */
export const enabled = (client: ScramjetClient) => {
	const mode = incumbencyMode(client.context, client.url);

	return mode === "pst" || mode === "stamp" || mode === "lazystamp";
};

/**
 * The realm whose script is running, as the stamp modes record it: the
 * innermost rewritten call site on the stack.
 *
 * Null when nothing the rewriter touched is on the stack at all - a callback
 * the host invoked directly, where the answer is the backup incumbent settings
 * object and nothing has recorded one.
 */
export function incumbentClient(client: ScramjetClient): ScramjetClient | null {
	const realm = client.box.incumbent;

	return (realm && client.box.globals.get(realm)) ?? null;
}

/** see {@link BackupIncumbencyMode} */
export const backupIncumbencyMode = (client: ScramjetClient) =>
	flagValue("backupIncumbency", client.context, client.url);

/**
 * How many frames an `Intercept` member's body sits above its caller: the body
 * itself, `invoke`, `attemptToCallHandler` and the proxy's `apply` - and the
 * trampoline, with `debugTrampolines` on.
 */
export const interceptDepth = (client: ScramjetClient) =>
	client.flagEnabled("debugTrampolines") ? 5 : 4;

/**
 * The same for a `Proxy` / `RawProxy` handler and a `Trap` / `RawTrap` one:
 * the handler, the proxy's trap or the accessor, and the trampoline between
 * them with `debugTrampolines` on.
 */
export const proxyDepth = (client: ScramjetClient) =>
	client.flagEnabled("debugTrampolines") ? 3 : 2;

/**
 * One entry of the backup incumbent settings object stack.
 * https://html.spec.whatwg.org/multipage/webappapis.html#backup-incumbent-settings-object-stack
 */
export type BackupIncumbent = {
	client: ScramjetClient;
	/**
	 * When it was pushed, on the clock `callfn` stamps with - which is how the
	 * stamp modes tell whether the last rewritten call happened in the callback
	 * or before it. See {@link incumbentFor}.
	 */
	epoch: number;
};

/**
 * The incumbent for the member whose body called this, `depth` frames above
 * the page's call into it.
 *
 * https://html.spec.whatwg.org/multipage/webappapis.html#incumbent-settings-object
 *
 *   1. Let context be the topmost script-having execution context.
 *   2. If context is null, or if context's skip-when-determining-incumbent
 *      counter is greater than zero, then [...] return the topmost entry of
 *      the backup incumbent settings object stack.
 *   3. Return context's Realm component's settings object.
 *
 * "Prepare to run a callback" pushes the callback's entry and increments the
 * counter of whichever script context was topmost at the time, so a script
 * context only answers when it was entered *after* the most recent callback
 * began. How that is decided depends on the mode:
 *
 * - `pst` reads the frame at the fixed offset: the member's caller. If that is
 *   a registered script, it is the topmost script-having context, and it is
 *   newer than any callback running - a callback's own script is above the
 *   stand-in that pushed its entry. If it is not - the stand-in itself, when
 *   the host called a native through it - the counter of whatever script lies
 *   below is positive, and the backup stack answers.
 * - the stamp modes compare clocks: the last rewritten call answers if it was
 *   made after the backup stack's top was pushed.
 *
 * Null in `none`, which records nothing, and when there is no answer at all.
 */
export function incumbentFor(
	client: ScramjetClient,
	depth: number
): ScramjetClient | null {
	const box = client.box;
	const mode = incumbencyMode(client.context, client.url);
	const stack = box.backupincumbents;
	const top = stack.length ? stack[stack.length - 1] : box.backupfloor;

	if (mode === "pst") {
		// rawCallSites and this function, then the member's own frames
		const caller = rawCallSites()?.[2 + depth];
		const realm = caller && realmForFrame(client, caller);
		if (realm) return realm.client;
	} else if (mode === "stamp" || mode === "lazystamp") {
		const stamped = incumbentClient(client);
		if (stamped && (!top || box.incumbentEpoch > top.epoch)) return stamped;
	} else {
		return null;
	}

	return top ? top.client : null;
}

/**
 * https://html.spec.whatwg.org/multipage/webappapis.html#prepare-to-run-a-callback
 * https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-a-callback
 *
 * Run `fn` - a callback the host is invoking - with `incumbent`, the
 * incumbent it was converted under, on the backup incumbent settings object
 * stack, and take it off again however `fn` exits.
 */
export function callWithBackupIncumbent(
	client: ScramjetClient,
	incumbent: ScramjetClient,
	fn: (...args: any[]) => any,
	that: any,
	args: any[]
) {
	const box = client.box;
	const stack = box.backupincumbents;
	const depth = stack.length;
	const entry = { client: incumbent, epoch: ++box.epoch };

	// a callback of its own: whatever checkpoint the last one ended with is over
	if (depth === 0) box.backupfloor = null;
	stack[depth] = entry;

	try {
		return Reflect_apply(fn, that, args);
	} finally {
		stack.length = depth;
		if (depth === 0 && hostInvoked(client)) holdForCheckpoint(client, entry);
	}
}

/**
 * Chromium, and not the spec: the microtask checkpoint that follows a
 * callback runs with the callback's entry still in effect.
 *
 * Blink closes the callback's backup incumbent scope after the microtask
 * scope inside it, and that is where the checkpoint happens - so a promise
 * reaction the callback queued runs while the callback's entry is still the
 * backup incumbent, where HTML has "clean up after running a callback" pop it
 * first. A reaction queued from a script that is not a callback finds no
 * entry at all, and answers with its handler's realm. Measured, in
 * `tests/incumbent-backup.ts`.
 *
 * So the entry is left as the stack's floor, for the reactions that
 * checkpoint runs, and taken off again by a microtask queued behind them. A
 * reaction queued by one of those reactions runs after that, and finds it
 * gone.
 */
function holdForCheckpoint(client: ScramjetClient, entry: BackupIncumbent) {
	const box = client.box;
	box.backupfloor = entry;

	// the native, saved before any module patched it - `queueMicrotask` is a
	// callback member like any other
	Reflect_apply(
		client.nativeStore.get("window").queueMicrotask.value,
		client.global,
		[
			() => {
				if (box.backupfloor === entry) box.backupfloor = null;
			},
		]
	);
}

/**
 * Whether the callback just run was called by the host, with no script below
 * it - which is when a microtask checkpoint follows it. One dispatched
 * synchronously by a script returns to that script, and the checkpoint waits
 * until it is done.
 *
 * Read off the stack under `pst`: this function, `callWithBackupIncumbent` and
 * the stand-in the host called, and nothing else. The stamp modes cannot tell,
 * and take every callback to be the host's, which is the usual case.
 */
function hostInvoked(client: ScramjetClient): boolean {
	if (incumbencyMode(client.context, client.url) !== "pst") return true;

	const frames = rawCallSites();

	return !!frames && frames.length === 4;
}

/**
 * The function to hand the host in place of the callback `fn`, converted
 * under `incumbent` - or `fn` itself, with no incumbent to push.
 *
 * Recorded against `fn`, so a member that hands a callback back - an `on*`
 * getter - can answer with the page's own. See `shared/callbacks.ts`.
 */
export function backupIncumbentCallback<F extends (...args: any[]) => any>(
	client: ScramjetClient,
	incumbent: ScramjetClient | null,
	fn: F
): F {
	if (!incumbent) return fn;

	const standIn = function (this: any, ...args: any[]) {
		return callWithBackupIncumbent(client, incumbent, fn, this, args);
	} as F;
	client.box.callbackOriginals.set(standIn, fn);

	return standIn;
}

/**
 * `backupIncumbency: "bind"`.
 *
 * The backup incumbent settings object stack is pushed when the host runs a
 * callback, with the incumbent the callback was converted under - by every
 * member that takes one. It only decides anything for a callback that puts no
 * script of its own on the stack: a script-having one is its own incumbent.
 * And the one such callback that can reach an incumbent-sensitive member is
 * that member itself, bound.
 *
 * So the entry is recorded on the bound function instead, when it is made:
 * binding a member in {@link SingletonBox.incumbentSinks} binds a stand-in
 * that runs it with the incumbent of `bind`'s caller pushed. That is the
 * converting realm whenever the realm that binds is the one that hands the
 * result over, which is assumed - a function bound in one realm and handed to
 * a host API by another answers with the first.
 *
 * It also answers where the spec would not ask the backup stack at all: a
 * bound sink called directly by a script of *another* realm names the realm
 * that bound it rather than the caller.
 */
function installBind(client: ScramjetClient) {
	const box = client.box;

	client.Proxy("Function.prototype.bind", {
		apply(ctx) {
			const target = ctx.this;
			if (!box.incumbentSinks.has(target)) return;

			const incumbent = incumbentFor(client, proxyDepth(client));
			if (!incumbent) return;

			const standIn: any = new Proxy(target as (...args: any[]) => any, {
				apply(fn, that, args) {
					return callWithBackupIncumbent(client, incumbent, fn, that, args);
				},
				construct(fn, args, newTarget) {
					// a bound function constructed with itself as newTarget
					// hands over its target, which is this stand-in
					return Reflect_construct(
						fn,
						args,
						newTarget === standIn ? fn : newTarget
					);
				},
			});
			box.unproxy.set(standIn, target);

			ctx.this = standIn;
		},
	});
}

export default function (client: ScramjetClient, self: Self) {
	const mode = incumbencyMode(client.context, client.url);

	if (backupIncumbencyMode(client) === "bind") installBind(client);

	if (mode === "stamp" || mode === "lazystamp") {
		installCallFn(client, self);

		return;
	}

	// every rewritten script registers itself before it runs
	Object_defineProperty(self, client.config.globals.registerrealmfn, {
		value: (scriptId: string, tag: string) => {
			const realm: ScriptRealm = { client, tag };
			client.box.scriptrealms[scriptId] = realm;

			if (mode !== "pst") return;

			// this runs at the top of the script being registered, which is
			// the frame after rawCallSites() and this function. eval'd code and
			// `new Function` are that frame too - the script that evaluated them
			// is below it
			const self = rawCallSites()?.[2];
			const hash = self && self.getScriptHash?.();

			// its hash is the key a later stack walk looks it up by, and nothing
			// had to be written into the source - or shown to the page - to get
			// it there
			if (hash) client.box.scripthashes[hash] = scriptId;
		},
		enumerable: false,
		writable: false,
		configurable: false,
	});
}

/**
 * The realm a PST stack frame belongs to: look up the registered script and
 * the client it ran in by its hash.
 */
export function realmForFrame(
	client: ScramjetClient,
	frame: CallSite
): ScriptRealm | null {
	try {
		const hash = frame.getScriptHash?.();
		const scriptId = hash && client.box.scripthashes[hash];
		return scriptId ? (client.box.scriptrealms[scriptId] ?? null) : null;
	} catch {
		// Not a usable V8 CallSite.
		return null;
	}
}

/**
 * `callfn`, which every call in a `stamp`-rewritten script goes through.
 *
 * `$call(realm, receiver, fn, ...args)` - `realm` is the global of the script
 * the call is written in, which is what makes it the incumbent for the length
 * of the call. It arrives as a value rather than being read here, because the
 * name the rewriter emits for it resolves in the realm the code is *running*
 * in: code `parent.eval`'d into another realm names that realm's global, which
 * is the realm the browser would call incumbent too.
 *
 * `lazystamp` narrows the rewrite to calls that look like `postMessage` rather
 * than narrowing anything here - by the time a call reaches this function it
 * has already been decided to be worth recording.
 */
function installCallFn(client: ScramjetClient, self: Self) {
	const box = client.box;

	Object_defineProperty(self, client.config.globals.callfn, {
		value: function (realm: Self, receiver: any, fn: any, ...args: any[]) {
			// only the innermost call can be the incumbent, so there is nothing
			// to keep a stack of, and nothing to put back afterwards either:
			// the next rewritten call overwrites this before anything reads
			// it, and until one does, what is left behind is the realm that
			// was running when the host was handed whatever it is now calling
			// - which is what the backup incumbent settings object would have
			// recorded. Restoring instead would answer a callback the host
			// invoked with nothing at all
			box.incumbent = realm;
			box.incumbentEpoch = ++box.epoch;

			return Reflect_apply(fn, receiver, args);
		},
		writable: false,
		configurable: false,
		enumerable: false,
	});

	/**
	 * `stampfn(realm, value)`, around what a member that converts a callback
	 * is handed where the rewriter cannot route the member through `callfn`:
	 * the value of an `on*` assignment, and a constructor's last argument. The
	 * realm is recorded just before the conversion reads it, and `value` goes
	 * through untouched.
	 */
	Object_defineProperty(self, client.config.globals.stampfn, {
		value: function (realm: Self, value: any) {
			box.incumbent = realm;
			box.incumbentEpoch = ++box.epoch;

			return value;
		},
		writable: false,
		configurable: false,
		enumerable: false,
	});
}
