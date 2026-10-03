/**
 * The unproxy layer, for the `ppsc` rewriters.
 *
 * They hand the page a `Proxy` in place of the window and the
 * document. A native rejects one as a receiver - it checks the receiver's
 * internal slots, which a `Proxy` does not have - so `document.querySelector()`
 * and `window.addEventListener()` reach native code as "Illegal invocation".
 * The same goes the other way: a native that hands back a `Window` or a
 * `Document` would hand back the real one, past the proxy the page is supposed
 * to see.
 *
 * Which members those are is not something to guess at, so it is read off the
 * IDL: `tools/generate-unproxy-tables.mjs` walks every definition in
 * `@webref/idl` and writes out every operation, constructor and attribute that
 * takes or returns a `Window` or a `Document`. That table is
 * `client/unproxy.generated.ts` - it lives outside `shared/` because everything
 * in here is loaded as a module, and it is data.
 *
 * Every patch is a layer on the member's slot, through `RawProxy` and
 * `RawTrap`, or for a member that only needs its receiver put right, a bare
 * `Patch` that leaves that to {@link ScramjetClient.fixReceiver}: one member,
 * one patch, one trampoline frame, however many layers end up on it.
 */

import type { ScramjetClient } from "@client/client";
import { flagValue } from "@/shared";
import {
	_Map,
	_Set,
	_WeakMap,
	Object_create,
	Reflect_get,
	Array_isArray,
	Object_freeze,
	Object_isFrozen,
	Promise_then,
} from "@/shared/snapshot";
import {
	OPERATIONS,
	ATTRIBUTES,
	type ArgSelector,
	type ProxyKind,
	type ValueKind,
} from "../unproxy.generated";

// we do not want to override a member derived from a prototype until that
// prototype has been patched
export const order = 3;

/**
 * The real platform object behind a proxy, or `v` itself: this realm's, or
 * another frame's, which the box knows as well.
 */
function unproxyValue(v: any, client: ScramjetClient): any {
	if (typeof v !== "object" || v === null) return v;
	if (v === client.globalProxy) return client.global;
	if (v === client.documentProxy) return (client.global as any).document;

	return client.box.proxied.get(v) ?? v;
}

/**
 * The proxy standing in for `v`, when `v` is a window or a document the page is
 * not allowed to hold directly - this realm's or another frame's, answered by
 * the client that owns it. `kind` is what the IDL said the member hands back;
 * `*` means only the value itself can say.
 */
function proxyValue(v: any, kind: ProxyKind, client: ScramjetClient): any {
	if (typeof v !== "object" || v === null) return v;

	if (kind !== "d") {
		const owner = client.box.globals.get(v);
		if (owner) return owner.globalProxy ?? v;
	}
	if (kind !== "w") {
		const owner = client.box.documents.get(v);
		if (owner) return owner.documentProxy ?? v;
	}

	return v;
}

/**
 * The copies handed out for a frozen list that held a window or a document, so
 * that reading the same list twice gives the same list, as it does natively.
 */
const frozenCopies = new _WeakMap<object, object>();

/**
 * {@link proxyValue} for a value of any shape the IDL describes: a list is
 * wrapped element by element - in place when the member made it fresh, as
 * `composedPath()` does, and as a copy when it is frozen - and a promise once
 * it settles.
 */
function proxyShaped(v: any, kind: ValueKind, client: ScramjetClient): any {
	if (v == null) return v;
	if (kind.length === 1) return proxyValue(v, kind as ProxyKind, client);

	if (kind.startsWith("Promise<")) {
		const inner = kind[8] as ProxyKind;
		return Promise_then(v, (x: any) => proxyValue(x, inner, client));
	}

	const inner = kind[0] as ProxyKind;
	if (!Array_isArray(v)) return v;
	// most lists hold neither, and are handed back untouched
	let first = -1;
	for (let i = 0; i < v.length; i++) {
		if (proxyValue(v[i], inner, client) !== v[i]) {
			first = i;
			break;
		}
	}
	if (first < 0) return v;

	if (!Object_isFrozen(v)) {
		for (let i = first; i < v.length; i++)
			v[i] = proxyValue(v[i], inner, client);
		return v;
	}
	let copy = frozenCopies.get(v);
	if (!copy) {
		const out: any[] = [];
		for (let i = 0; i < v.length; i++)
			out.push(proxyValue(v[i], inner, client));
		copy = Object_freeze(out);
		frozenCopies.set(v, copy);
	}
	return copy;
}

/**
 * The members of a dictionary argument to unwrap: `true` for one, or the
 * members of one in it. Made with no prototype, so a key is only ever its own.
 */
type DictPlan = { [key: string]: DictPlan | true };

/** What of an operation's arguments to unwrap: whole ones, and members of dictionary ones */
type ArgPlan = { whole: number[]; dicts: [index: number, plan: DictPlan][] };

function planArgs(selectors: readonly ArgSelector[]): ArgPlan {
	const whole: number[] = [];
	const dicts = new _Map<number, DictPlan>();
	for (let s = 0; s < selectors.length; s++) {
		const sel = selectors[s];
		if (sel.length <= 2) {
			whole.push(sel[0]);
			continue;
		}
		let plan = dicts.get(sel[0]);
		if (!plan) dicts.set(sel[0], (plan = Object_create(null) as DictPlan));
		for (let i = 2; i < sel.length - 1; i++) {
			const key = sel[i] as string;
			let next = plan[key];
			if (next === true) break;
			if (!next) plan[key] = next = Object_create(null) as DictPlan;
			plan = next;
		}
		plan[sel[sel.length - 1] as string] = true;
	}
	const out: ArgPlan = { whole, dicts: [] };
	dicts.forEach((plan, index) => out.dicts.push([index, plan]));

	return out;
}

/**
 * A dictionary argument as the native should see it: every member read
 * straight through to the page's object when the native asks for it, and the
 * ones the IDL names unwrapped on the way.
 *
 * Web IDL converts a dictionary by reading each member once, in its own order,
 * so the object itself is never written to - it can be frozen, or all getters,
 * and a page can watch the reads - and nothing is read ahead of the native.
 */
function dictView(v: any, plan: DictPlan, client: ScramjetClient): any {
	if (typeof v !== "object" || v === null) return v;

	return new Proxy(
		{},
		{
			get(_target, key) {
				const value = Reflect_get(v, key);
				const inner = typeof key === "string" ? plan[key] : undefined;
				if (inner === undefined) return value;

				return inner === true
					? unproxyValue(value, client)
					: dictView(value, inner, client);
			},
		}
	);
}

function unproxyArgs(args: any[], plan: ArgPlan, client: ScramjetClient) {
	for (let i = 0; i < plan.whole.length; i++) {
		const index = plan.whole[i];
		args[index] = unproxyValue(args[index], client);
	}
	for (let i = 0; i < plan.dicts.length; i++) {
		const index = plan.dicts[i][0];
		args[index] = dictView(args[index], plan.dicts[i][1], client);
	}
}

/**
 * The interfaces whose members the engine installs on the global object itself
 * rather than on a prototype, so that is where the layer has to go.
 */
const GLOBAL_OWNERS = new _Set<string>([
	"Window",
	"WorkerGlobalScope",
	"DedicatedWorkerGlobalScope",
	"SharedWorkerGlobalScope",
	"ServiceWorkerGlobalScope",
]);

/**
 * Whether one of the proxies can turn up as the receiver of a call on `owner`,
 * which is reason enough to patch a member that takes and returns nothing
 * interesting. `Window` is an `EventTarget`, so `globalProxy.addEventListener`
 * lands on `EventTarget.prototype` and would reach native code as a proxy.
 */
function ownerNeedsThisUnproxy(owner: string): boolean {
	return (
		GLOBAL_OWNERS.has(owner) ||
		owner === "EventTarget" ||
		owner === "Document" ||
		owner === "Node"
	);
}

/** Where a member lives, as it would be written: `Document.prototype.open`, `Window.open` */
function debugName(owner: string, member: string, isStatic: boolean): string {
	return isStatic || GLOBAL_OWNERS.has(owner)
		? `${owner}.${member}`
		: `${owner}.prototype.${member}`;
}

export const enabled = (client: ScramjetClient) =>
	flagValue("jsRewriter", client.context) !== "dpsc";

export default function (client: ScramjetClient, self: Self) {
	// Over half of what the IDL names needs nothing but its receiver put right,
	// and a layer for that alone costs a `ctx` and three closures per call. The
	// slot does it instead, once, for every member it dispatches - so those
	// members only have to be patched, not layered on.
	const gProxy = client.globalProxy;
	const dProxy = client.documentProxy;
	const gReal = client.global as any;
	const dReal = (client.global as any).document;
	const proxied = client.box.proxied;
	client.fixReceiver = (that: any) => {
		if (that === gProxy) return gReal;
		if (that === dProxy && dProxy) return dReal;
		// another frame's proxy, calling a member of this realm - which needs
		// another frame with proxies to have happened at all
		if (
			client.box.proxyClients > 1 &&
			typeof that === "object" &&
			that !== null
		)
			return proxied.get(that) ?? that;

		return that;
	};

	for (let i = 0; i < OPERATIONS.length; i++) {
		const op = OPERATIONS[i];
		const owner = op[0],
			member = op[1],
			isStatic = op[2],
			isCtor = op[3],
			argSelectors = op[4],
			returnKind = op[5];
		const args = planArgs(argSelectors);
		const ctor = (self as any)[owner];
		if (!ctor) continue;

		// nothing to unwrap, nothing to wrap, and no proxy can be the receiver
		if (
			argSelectors.length === 0 &&
			!returnKind &&
			!ownerNeedsThisUnproxy(owner)
		) {
			continue;
		}

		if (isCtor) {
			if (argSelectors.length === 0) continue;
			client.RawProxy(
				self,
				owner,
				{
					construct(ctx) {
						unproxyArgs(ctx.args as any[], args, client);
					},
				},
				`${owner} constructor`
			);
			continue;
		}

		const target = isStatic
			? ctor
			: GLOBAL_OWNERS.has(owner)
				? self
				: ctor.prototype;
		if (!target) continue;

		const wrapsArgs = argSelectors.length > 0;
		const wrapsReturn = !!returnKind;

		// nothing but the receiver, which the slot now handles: patch it so the
		// call reaches a slot at all, and leave it unlayered
		if (!wrapsArgs && !wrapsReturn) {
			client.Patch(target, member, debugName(owner, member, isStatic));
			continue;
		}

		client.RawProxy(
			target,
			member,
			{
				apply(ctx) {
					if (wrapsArgs) unproxyArgs(ctx.args as any[], args, client);

					if (wrapsReturn) {
						ctx.return(
							proxyShaped(ctx.call(), returnKind as ValueKind, client)
						);
					}
				},
			},
			debugName(owner, member, isStatic)
		);
	}

	for (let i = 0; i < ATTRIBUTES.length; i++) {
		const attr = ATTRIBUTES[i];
		const owner = attr[0],
			member = attr[1],
			isStatic = attr[2],
			kind = attr[3],
			readonly = attr[4];
		const ctor = (self as any)[owner];
		if (!ctor) continue;
		const target = isStatic
			? ctor
			: GLOBAL_OWNERS.has(owner)
				? self
				: ctor.prototype;
		if (!target) continue;

		const trap: {
			get?: (ctx: any) => any;
			set?: (ctx: any, v: any) => void;
		} = {
			get(ctx) {
				return proxyShaped(ctx.get(), kind, client);
			},
		};
		if (!readonly) {
			trap.set = (ctx, v) => ctx.set(unproxyValue(v, client));
		}

		client.RawTrap(
			target,
			member,
			trap as any,
			debugName(owner, member, isStatic)
		);
	}
}
