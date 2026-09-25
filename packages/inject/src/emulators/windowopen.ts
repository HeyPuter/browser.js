import { ExecutionContextWrapper, findSequence } from "../context";
import { chromeframe } from "..";
import { reduceSequence } from "..";
import type { ScramjetClient } from "@mercuryworkshop/scramjet/bundled";
import type { RpcHelper } from "@mercuryworkshop/rpc";
import type { Chromebound, Framebound } from "../types";

// keep in sync with chrome/src/proxy/spares.ts
const SPARE_PREFIX = "__sj_spare_";

/**
 * A spare tab frame of this origin that is ready to be claimed: a sibling of
 * ours in the chrome's document, same-origin (so its name is readable at all)
 * and already sitting on its about:blank.
 */
function findSpare(): Window | null {
	const frames = chromeframe.frames;
	for (let i = 0; i < frames.length; i++) {
		try {
			const f = frames[i];
			if (f.name.startsWith(SPARE_PREFIX) && f.location.href === "about:blank")
				return f;
		} catch {
			// cross-origin: another origin's spare, or a tab
		}
	}
	return null;
}

/** Whether a frame anywhere in the chrome that we can see is called `name`. */
function namedFrameExists(win: Window, name: string): boolean {
	for (let i = 0; i < win.frames.length; i++) {
		const f = win.frames[i];
		try {
			if (f.name === name) return true;
		} catch {}
		if (namedFrameExists(f, name)) return true;
	}
	return false;
}

/**
 * https://html.spec.whatwg.org/multipage/nav-history-apis.html#concept-window-open-features-tokenize
 * reduced to the two booleans that decide whether the opener is handed over
 */
function wantsNoOpener(features: string): boolean {
	let noopener = false;
	for (const token of features.split(/[\s,]+/)) {
		const [rawKey, rawValue] = token.split("=");
		const key = rawKey.trim().toLowerCase();
		if (key !== "noopener" && key !== "noreferrer") continue;
		const value = (rawValue ?? "").trim().toLowerCase();
		const n = parseInt(value, 10);
		if (
			value === "" ||
			value === "yes" ||
			value === "true" ||
			(!isNaN(n) && n !== 0)
		)
			noopener = true;
	}
	return noopener;
}

export function setupWindowOpen({
	self,
	rpc,
	client,
}: ExecutionContextWrapper) {
	// windows this context opened by name, so a second open() with that name
	// can go to the native steps - which will find it - rather than a new tab.
	// A cross-origin window's name can't be read, so this is the only record
	const named = new Map<string, Window>();

	client.Proxy("window.open", {
		apply(ctx) {
			const [rawUrl, rawTarget, rawFeatures] = ctx.args as any[];
			const target =
				rawTarget === undefined || rawTarget === null
					? "_blank"
					: String(rawTarget);
			const features = rawFeatures === undefined ? "" : String(rawFeatures);
			const lower = target.toLowerCase();

			const isNew = target === "" || lower === "_blank";
			if (!isNew) {
				if (lower === "_self" || lower === "_parent" || lower === "_top")
					return ctx.return(ctx.next(ctx.this, ctx.args));

				const known = named.get(target);
				if ((known && !known.closed) || namedFrameExists(chromeframe, target))
					return ctx.return(ctx.next(ctx.this, ctx.args));
			}

			const url =
				rawUrl === undefined || rawUrl === "" ? undefined : String(rawUrl);
			const absolute =
				url === undefined ? undefined : new URL(url, client.url).href;

			const spare = findSpare();
			if (!spare) {
				console.warn(
					"windowopen: no spare frame ready, falling back to a detached proxy"
				);
				return ctx.return(fallback(rpc, client, absolute ?? "about:blank"));
			}
			const spareName = spare.name;

			// claim the frame without navigating it, the way a popup starts on its
			// initial about:blank. Renaming has to happen before the navigation:
			// a cross-process navigation snapshots the name when it starts
			const noopener = wantsNoOpener(features);
			const win = noopener
				? // noopener would make the native steps ignore the name and open
					// a real popup, so claim the frame first and cut the opener by
					// hand. The page never sees this window, so it needs no hooking
					((ctx.fn as any).call(ctx.this, "", spareName) as Window)
				: // the native steps, pointed at the spare: opener set to us, and
					// the window hooked before we hand it back
					(ctx.next(ctx.this, ["", spareName, features] as any) as Window);
			if (noopener) win.opener = null;
			win.name = isNew ? "" : target;
			if (!isNew && !noopener) named.set(target, win);

			// the frame is not on its *initial* about:blank, so only a replace
			// keeps the spare out of the joint session history
			// (Location's methods are unforgeable own properties, so this is the
			// native even though the window's realm is hooked by now)
			if (url !== undefined)
				win.location.replace((client as any).rewriteUrl(url));

			ctx.return(noopener ? null : win);

			void rpc.call("adoptwindow", {
				sequence: findSequence(top!, win)!,
				url: absolute,
			});
		},
	});

	// a tab is an iframe to the browser, so the native close() does nothing.
	// Only the tab's own window asks; the chrome knows whether it was opened
	// by script. (A cross-origin opener's `w.close()` runs in the other
	// process and never reaches here - a known gap.)
	client.Proxy("window.close", {
		apply(ctx) {
			if (ctx.this === self && self.parent === chromeframe)
				void rpc.call("closewindow", {});
			ctx.return(undefined);
		},
	});
}

/**
 * The old behaviour, for when no spare is ready (the first open from an origin
 * whose pool is still loading, or several in one task): ask the chrome for a
 * tab and hand back a stand-in that forwards to it once it exists.
 */
function fallback(
	rpc: RpcHelper<Framebound, Chromebound>,
	client: ScramjetClient,
	href: string
): any {
	const url = new URL(href);
	// TODO: return real window in singlethreaded mode

	let realWindow: Window | null = null;
	let realWindowResolve!: (window: Window) => void;
	const realWindowPromise: Promise<Window> = new Promise((resolve) => {
		realWindowResolve = resolve;
	});

	rpc
		.call("newtab", {
			url: url.href,
		})
		.then(({ sequence }) => {
			console.error(`windowopenproxy: newtab: sequence was received`, sequence);
			let newWindow = reduceSequence(sequence);
			if (!newWindow) {
				throw new Error("Failed to reduce sequence");
			}
			realWindow = newWindow;
			realWindowResolve(realWindow);
		});

	const windowProxy = new Proxy(
		{},
		{
			get(target, prop) {
				// TODO: hardcoded scramjet prefix
				if (typeof prop === "string" && prop.startsWith("$scramjet__")) {
					prop = prop.slice(11);
				}

				console.log(`windowopenproxy: property ${String(prop)} was accessed`);

				if (realWindow) {
					return Reflect.get(realWindow, prop);
				} else {
					if (prop === "location") {
						// this doesn't need to be undetectable, just working
						return new Proxy(
							{},
							{
								get(target, prop) {
									if (
										typeof prop === "string" &&
										prop.startsWith("$scramjet__")
									) {
										prop = prop.slice(11);
									}
									if (prop in url) {
										return url[prop];
									}
									if (prop === "assign") {
										return (target: string | URL) => {
											console.log(
												`windowopenproxy.location.assign: ${String(target)} was called`
											);
											realWindowPromise.then((realWindow) => {
												console.log(realWindow);
												console.log(typeof realWindow);
												console.log(
													`windowopenproxy.location.assign: real window was created, calling assign on it`,
													realWindow
												);
												realWindow.location.assign(target);
											});
										};
									} else if (prop === "reload") {
										return () => {
											realWindowPromise.then((realWindow) => {
												realWindow.location.reload();
											});
										};
									} else if (prop === "replace") {
										return (target: string | URL) => {
											realWindowPromise.then((realWindow) => {
												realWindow.location.replace(target);
											});
										};
									}
									console.warn(
										`windowopenproxy.location: property ${String(prop)} was accessed, but real window.location was not yet created`
									);
									return undefined;
								},
								set(target, prop, value) {
									realWindowPromise.then((realWindow) => {
										Reflect.set(realWindow.location, prop, value);
									});
									return true;
								},
							}
						);
					}

					console.warn(
						`windowopenproxy: property ${String(prop)} was accessed, but real window was not yet created`
					);
				}
			},
			set(target, prop, value) {
				if (realWindow) {
					Reflect.set(realWindow, prop, value);
				} else {
					realWindowPromise.then((window) => {
						Reflect.set(window, prop, value);
					});
				}
				return true;
			},
		}
	);

	return windowProxy;
}
