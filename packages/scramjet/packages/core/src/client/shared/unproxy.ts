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
import { SCRAMJETCLIENT } from "@/symbols";
import { flagValue } from "@/shared";
import { _Set } from "@/shared/snapshot";
import {
	OPERATIONS,
	ATTRIBUTES,
	type ArgSelector,
	type ProxyKind,
} from "../unproxy.generated";

// we do not want to override a member derived from a prototype until that
// prototype has been patched
export const order = 3;

/**
 * The real platform object behind one of this realm's proxies, or `v` itself.
 *
 * A value arriving from another frame is answered by the client that owns it,
 * which is why the stash is read off the value rather than compared against
 * this client's two proxies alone. Reading it can throw for a cross origin
 * window, so it is guarded.
 */
function unproxyValue(v: any, client: ScramjetClient): any {
	if (v == null) return v;
	if (v === client.globalProxy) return client.global;
	if (v === client.documentProxy) return (client.global as any).document;

	try {
		const c = (v as any)[SCRAMJETCLIENT];
		if (c) {
			if (v === c.globalProxy) return c.global;
			if (v === c.documentProxy) return c.global.document;
		}
	} catch {}

	return v;
}

/**
 * The proxy standing in for `v`, when `v` is a window or a document the page is
 * not allowed to hold directly. `kind` is what the IDL said the member hands
 * back; `*` means the overloads disagreed and only the value itself can say.
 */
function proxyValue(v: any, kind: ProxyKind, client: ScramjetClient): any {
	if (v == null) return v;

	if (kind !== "d") {
		if (v === client.global) return client.globalProxy ?? v;
	}
	if (kind !== "w") {
		if (client.documentProxy && v === (client.global as any).document) {
			return client.documentProxy;
		}
	}

	// another frame's, answered by the client that owns it
	try {
		const c = (v as any)[SCRAMJETCLIENT];
		if (c) {
			if (kind !== "d" && c.globalProxy && v === c.global) return c.globalProxy;
			if (kind !== "w" && c.documentProxy && v === c.global.document) {
				return c.documentProxy;
			}
		}
	} catch {}

	return v;
}

/**
 * Replaces each argument the IDL named with its real platform object. A
 * selector with a path past the kind reaches into a dictionary argument, which
 * is how `options.root` and its like are described.
 */
function unproxyArgs(
	args: any[],
	selectors: readonly ArgSelector[],
	client: ScramjetClient
) {
	for (let s = 0; s < selectors.length; s++) {
		const sel = selectors[s];
		const argIdx = sel[0];

		if (sel.length <= 2) {
			args[argIdx] = unproxyValue(args[argIdx], client);
			continue;
		}

		let obj = args[argIdx];
		for (let i = 2; i < sel.length - 1; i++) {
			if (obj == null) break;
			obj = obj[sel[i] as string];
		}
		if (obj == null) continue;
		const last = sel[sel.length - 1] as string;
		obj[last] = unproxyValue(obj[last], client);
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
	client.fixReceiver = (that: any) =>
		that === gProxy ? gReal : that === dProxy && dProxy ? dReal : that;

	for (let i = 0; i < OPERATIONS.length; i++) {
		const op = OPERATIONS[i];
		const owner = op[0],
			member = op[1],
			isStatic = op[2],
			isCtor = op[3],
			argSelectors = op[4],
			returnKind = op[5];
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
						unproxyArgs(ctx.args as any[], argSelectors, client);
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
					if (wrapsArgs) unproxyArgs(ctx.args as any[], argSelectors, client);

					if (wrapsReturn) {
						ctx.return(proxyValue(ctx.call(), returnKind as ProxyKind, client));
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
				return proxyValue(ctx.get(), kind as ProxyKind, client);
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

	// The reflection builtins are not described by IDL, and take any object at
	// all - including a proxy, which they would then answer about rather than
	// about the thing it stands for.
	client.Proxy("Object.defineProperty", {
		apply(ctx) {
			ctx.args[0] = unproxyValue(ctx.args[0], client);
		},
	});

	client.Proxy("Object.getOwnPropertyDescriptor", {
		apply(ctx) {
			ctx.args[0] = unproxyValue(ctx.args[0], client);

			const desc = ctx.call();
			if (!desc) return;

			// the halves a descriptor carries are native accessors, and take the
			// platform object as their receiver just as a method does
			if (desc.get) {
				client.RawProxy(desc, "get", {
					apply(c) {
						c.this = unproxyValue(c.this, client);
					},
				});
			}
			if (desc.set) {
				client.RawProxy(desc, "set", {
					apply(c) {
						c.this = unproxyValue(c.this, client);
						for (let i = 0; i < c.args.length; i++) {
							c.args[i] = unproxyValue(c.args[i], client);
						}
					},
				});
			}

			ctx.return(desc);
		},
	});
}
