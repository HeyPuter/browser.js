import {
	BareCompatibleClient,
	ProxyTransport,
	RawHeaders,
} from "@mercuryworkshop/proxy-transports";
import { SCRAMJETCLIENT } from "@/symbols";
import { getOwnPropertyDescriptorHandler } from "@client/helpers";
import { createLocationProxy } from "@client/location";
import { createWrapFn } from "@client/shared/wrap";
import { LifecycleHooks } from "@client/events";
import {
	rewriteUrl,
	RewriteUrlOptions,
	unrewriteUrl,
	type URLMeta,
} from "@rewriters/url";
import {
	flagEnabled,
	HtmlRewriterHooks,
	ScramjetContext,
	ScramjetHeaders,
} from "@/shared";
import { iswindow } from "./entry";
import { SingletonBox } from "./singletonbox";
import { ScramjetConfig } from "@/types";
import { Tap } from "@/Tap";
import {
	type CookieSyncEntry,
	type CookieSyncOptions,
	TrackedHistoryState,
} from "@/fetch";
import { AnyFunction } from "@/types";
import {
	AsyncFunction_prototype,
	_URL,
	Error,
	String,
	String_endsWith,
	Reflect_get,
	Reflect_ownKeys,
	Array_isArray,
	Reflect_has,
	Reflect_apply,
	Reflect_construct,
	Object_getOwnPropertyDescriptor,
	Object_defineProperty,
	Object_defineProperties,
	_Map,
	Object_getOwnPropertyDescriptors,
	Object_getOwnPropertyNames,
	Object_getPrototypeOf,
	Object_setPrototypeOf,
	Function_call,
	Function_apply,
	Object_assign,
} from "@/shared/snapshot";
import {
	isConstructorMember,
	memberValidator,
	type IDLValidator,
} from "./webidl";
import { createIndirectEval } from "./shared/eval";
import { NativeErrors } from "./nativeerror";

// https://github.com/Microsoft/TypeScript/issues/27024#issuecomment-421529650
type IfEquals<T, U, Y = unknown, N = never> =
	(<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2 ? Y : N;
// thank you psm (https://github.com/psmpm) <3
type Traverse<
	O extends Record<any, any>,
	P extends string,
> = P extends `${infer K}.${infer R}` ? Traverse<O[K], R> : O[P];
type GlobalTraverse<P extends string> = Traverse<
	GlobalThis & Record<string, any>,
	P
>;
type ProxyApplyThis<T extends string> =
	unknown extends ThisParameterType<Extract<GlobalTraverse<T>, AnyFunction>>
		? T extends `${infer ClassName}.prototype.${string}`
			? GlobalTraverse<ClassName> extends { prototype: infer Proto }
				? Proto
				: unknown
			: unknown
		: ThisParameterType<Extract<GlobalTraverse<T>, AnyFunction>>;

export type ScramjetClientInit = {
	context: ScramjetContext;
	transport: ProxyTransport;
	sendSetCookie: (
		cookies: CookieSyncEntry[],
		options?: CookieSyncOptions
	) => Promise<void>;
	shouldBlockMessageEvent?: (ev: MessageEvent) => boolean;
	hookSubcontext: (self: Self, frame?: HTMLIFrameElement) => ScramjetClient;
	initHeaders: RawHeaders;
	history: TrackedHistoryState[];
};

export type ProxyCtx<
	T extends string = string,
	U extends "construct" | "apply" = "apply",
> = {
	fn: GlobalTraverse<T>;
	this: IfEquals<U, "construct", null, ProxyApplyThis<T>>;
	args: IfEquals<
		U,
		"construct",
		ConstructorParameters<GlobalTraverse<T>>,
		Parameters<GlobalTraverse<T>>
	>;
	newTarget: IfEquals<U, "construct", GlobalTraverse<T>, null>;
	return: (
		r: IfEquals<
			U,
			"construct",
			InstanceType<GlobalTraverse<T>>,
			ReturnType<GlobalTraverse<T>>
		>
	) => void;
	call: () => IfEquals<
		U,
		"construct",
		InstanceType<GlobalTraverse<T>>,
		ReturnType<GlobalTraverse<T>>
	>;
};
export type Proxy<T extends string = string> = {
	construct?(ctx: ProxyCtx<T, "construct">): any;
	apply?(ctx: ProxyCtx<T, "apply">): any;
};

export type TrapCtx<T extends string> = {
	this: any;
	get: () => GlobalTraverse<T>;
	set: (v: GlobalTraverse<T>) => void;
};
export type Trap<T extends string> = {
	writable?: boolean;
	value?: any;
	enumerable?: boolean;
	configurable?: boolean;
	get?: (ctx: TrapCtx<T>) => GlobalTraverse<T>;
	set?: (ctx: TrapCtx<T>, v: GlobalTraverse<T>) => void;
};

export type ScramjetModule = {
	enabled: (client: ScramjetClient, self: GlobalThis) => boolean | undefined;
	disabled: (client: ScramjetClient, self: GlobalThis) => void | undefined;
	order: number | undefined;
	default: (client: ScramjetClient, self: GlobalThis) => void;
};

function findBox(global: Window, seen: Window[]): SingletonBox | null {
	if (seen.includes(global)) return null;
	seen.push(global);

	try {
		if ((SCRAMJETCLIENT in global) as any) {
			return global[SCRAMJETCLIENT].box;
		}
	} catch {}

	try {
		const b = findBox(global.parent, seen);
		if (b) return b;
	} catch {}

	try {
		const b = findBox(global.top, seen);
		if (b) return b;
	} catch {}

	try {
		if (global.opener) {
			const b = findBox(global.opener, seen);
			if (b) return b;
		}
	} catch {}

	for (let i = 0; i < global.length; i++) {
		try {
			const b = findBox(global[i], seen);
			if (b) return b;
		} catch {}
	}

	return null;
}

export class ScramjetClient {
	locationProxy: any;
	indirectEval: any;
	serviceWorker: ServiceWorkerContainer;
	bare: BareCompatibleClient;
	/** builds errors a page cannot tell from the browser's own */
	errors: NativeErrors;

	wrapfn: (i: any, ...args: any) => any;

	eventcallbacks: Map<
		any,
		[
			{
				event: string;
				originalCallback: AnyFunction;
				proxiedCallback: AnyFunction;
			},
		]
	> = new _Map();

	meta: URLMeta;

	box: SingletonBox;

	context: ScramjetContext;

	initHeaders: ScramjetHeaders;

	history: TrackedHistoryState[];

	private flagCache = new _Map<keyof ScramjetConfig["flags"], boolean>();

	hooks = {
		rewriter: {
			html: Tap.create<HtmlRewriterHooks>(),
		},
		lifecycle: Tap.create<LifecycleHooks>(),
	};

	native = new Proxy(
		{},
		{
			get: (_target: any, prototype: string) => {
				const descriptors = this.nativeStore.get(prototype);
				if (!descriptors) {
					throw new Error(`No native descriptors found for ${prototype}`);
				}
				return class {
					constructor(object: any) {
						return new Proxy(
							{},
							{
								get(_target, method: string) {
									const desc = descriptors[method];
									if (!desc) {
										throw new Error(
											`No native method|getter ${method.toString()} found for ${prototype}`
										);
									}
									if (typeof desc.value === "function") {
										const fn = desc.value;

										return new Proxy(fn, {
											apply: (_t, _thisArg, args) =>
												Reflect_apply(fn, object, args),
										});
									} else if (desc.get) {
										return desc.get.call(object);
									}
								},
								set(_target, method: string, value: any) {
									const desc = descriptors[method];
									if (!desc || !desc.set) {
										throw new Error(
											`No native setter ${method.toString()} found for ${prototype}`
										);
									}
									desc.set.call(object, value);
									return true;
								},
							}
						);
					}
				};
			},
		}
	);
	nativeStore: Map<string, Record<string, PropertyDescriptor>> = new _Map();
	saveNatives() {
		for (const key of Object_getOwnPropertyNames(this.global)) {
			const value = this.global[key];
			if (typeof value === "function" && "prototype" in value) {
				const natives = {};
				const walk = (proto: any) => {
					const prototype = Object_getPrototypeOf(proto);
					if (prototype) walk(prototype);
					Object_assign(natives, Object_getOwnPropertyDescriptors(proto));
				};
				walk(value.prototype);
				this.nativeStore.set(key, natives);
			}
		}

		// handle both globals bound to the scope's prototype, and globals bound to the scope itself (e.g. window)
		const globals = {};
		const walkGlobal = (object: any) => {
			const prototype = Object_getPrototypeOf(object);
			if (prototype) walkGlobal(prototype);
			Object_assign(globals, Object_getOwnPropertyDescriptors(object));
		};
		walkGlobal(this.global);
		this.nativeStore.set("window", globals);
	}

	constructor(
		public global: GlobalThis,
		public init: ScramjetClientInit
	) {
		if (SCRAMJETCLIENT in global) {
			dbg.error(
				"attempted to initialize a scramjet client, but one is already loaded - this is very bad"
			);
			throw new Error();
		}

		if (iswindow) {
			const b = findBox(global as unknown as Window, []);
			if (b) {
				this.box = b;
			}
		}

		if (!this.box) {
			this.box = new SingletonBox(this);
		}

		this.saveNatives();
		this.errors = new NativeErrors(global as Self);

		this.box.registerClient(this, global as Self);

		this.context = init.context;
		if (init.initHeaders)
			this.initHeaders = ScramjetHeaders.fromRawHeaders(init.initHeaders);
		this.history = init.history;
		this.context.hooks = {
			rewriter: this.hooks.rewriter,
		};

		this.bare = new BareCompatibleClient(init.transport);

		this.serviceWorker = this.global.navigator.serviceWorker;

		if (iswindow) {
			global.document[SCRAMJETCLIENT] = this;
		}

		this.indirectEval = createIndirectEval(this);
		this.wrapfn = createWrapFn(this, global);
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const client = this;
		this.meta = {
			get origin() {
				return client.url;
			},
			get base() {
				if (iswindow) {
					const base = new client.native.Document(
						client.global.document
					).querySelector("base");
					if (base) {
						let url = base.getAttribute("href");
						if (!url) return client.url;
						const frag = url.indexOf("#");
						url = url.substring(0, frag === -1 ? undefined : frag);
						if (!url) return client.url;

						return new _URL(url, client.url.origin);
					}
				}

				return client.url;
			},
			// TODO: very bad assumptions made here, window.parent never throws
			get topFrameName() {
				if (!iswindow)
					throw new Error("topFrameName was called from a worker?");

				let currentWin = client.global;

				try {
					if (currentWin.parent.window == currentWin.window) {
						// we're top level & we don't have a frame name
						return null;
					}
				} catch {
					// accessing parent was blocked by CORS, we're in a frame but the parent is cross origin
				}

				try {
					// find the topmost frame that's controlled by scramjet, stopping before the real top frame
					while (currentWin.parent.window !== currentWin.window) {
						if (!currentWin.parent.window[SCRAMJETCLIENT]) break;
						currentWin = currentWin.parent.window;
					}
				} catch {
					// doesn't matter if it throws here just means we found the topmost one
				}

				const curclient = currentWin[SCRAMJETCLIENT];
				const frame = new curclient.native.window(currentWin).frameElement;
				if (!frame) {
					// we're inside an iframe, but the top frame is scramjet-controlled and top level, so we can't get a top frame name
					// or we're cross-origin and frameElement doesn't exist. that's a TODO because this won't work
					return null;
				}
				if (!frame.name) {
					// the top frame is scramjet-controlled, but it has no name. this is user error
					dbg.error(
						"YOU NEED TO USE `new ScramjetFrame()`! DIRECT IFRAMES WILL NOT WORK"
					);

					return null;
				}

				return frame.name;
			},
			get parentFrameName() {
				if (!iswindow)
					throw new Error("parentFrameName was called from a worker?");

				try {
					try {
						if (client.global.parent.window == client.global.window) {
							// we're top level & we don't have a frame name
							return null;
						}
					} catch {
						// accessing parent was blocked by CORS, we're in a frame but the parent is cross origin
						return null;
					}

					const parentWin = client.global.parent.window;
					if (parentWin[SCRAMJETCLIENT]) {
						// we're inside an iframe, and the parent is scramjet-controlled
						const parentClient = parentWin[SCRAMJETCLIENT];
						const frame = new parentClient.native.window(parentWin)
							.frameElement;
						if (!frame) {
							// parent is scramjet controlled and top-level. there is no parent frame name
							return null;
						}

						if (!frame.name) {
							// the parent frame is scramjet-controlled, but it has no name. this is user error
							dbg.error(
								"YOU NEED TO USE `new ScramjetFrame()`! DIRECT IFRAMES WILL NOT WORK"
							);

							return null;
						}

						return frame.name;
					} else {
						// we're inside an iframe, and the parent is not scramjet-controlled
						// return our own frame name
						const frame = new client.native.window(client.global).frameElement;
						if (!frame.name) {
							// the parent frame is not scramjet-controlled, so we can't get a parent frame name
							dbg.error(
								"YOU NEED TO USE `new ScramjetFrame()`! DIRECT IFRAMES WILL NOT WORK"
							);

							return null;
						}

						return frame.name;
					}
				} catch {
					return null;
				}
			},
			get referrerPolicy(): string | undefined {
				if (client.initHeaders && client.initHeaders.has("referrer-policy")) {
					return client.initHeaders.get("referrer-policy");
				}
				if (!iswindow) return "";
				// TODO: need to nullify the actual meta tag so it still sends unsafe-url
				const nDoc = new client.native.Document(client.global.document);
				const meta = [
					...nDoc.querySelectorAll("meta[name='referrer']"),
					...nDoc.querySelectorAll("meta[name='referrer-policy']"),
					...nDoc.querySelectorAll("meta[http-equiv='referrer-policy']"),
				];
				const last = meta[meta.length - 1];
				if (last) {
					const nLast = new client.native.HTMLMetaElement(last);
					return nLast.getAttribute("content");
				}

				return "";
			},
		};
		this.locationProxy = createLocationProxy(this, global);

		global[SCRAMJETCLIENT] = this;
	}

	/** Apply document injection init when a client was already installed (e.g. early contentWindow). */
	syncDocumentInit(init: {
		initHeaders: RawHeaders;
		history: TrackedHistoryState[];
		cookies?: string;
	}) {
		this.initHeaders = ScramjetHeaders.fromRawHeaders(init.initHeaders);
		this.history = init.history;
		if (init.cookies !== undefined) {
			this.context.cookieJar.load(init.cookies);
		}
	}

	hook() {
		const context = import.meta.webpackContext(".", {
			recursive: true,
		});

		const modules: ScramjetModule[] = [];

		for (const key of context.keys()) {
			const module = context(key) as ScramjetModule;
			if (!key.endsWith(".ts")) continue;
			if (
				(key.startsWith("./dom/") && "window" in this.global) ||
				(key.startsWith("./worker/") && "WorkerGlobalScope" in this.global) ||
				key.startsWith("./shared/")
			) {
				modules.push(module);
			}
		}

		modules.sort((a, b) => {
			const aorder = a.order || 0;
			const border = b.order || 0;

			return aorder - border;
		});

		for (const module of modules) {
			// one module throwing used to abort the loop, so a single interface
			// missing from this realm silently left every module after it
			// uninstalled. a hooked-but-incomplete realm is bad; an unhooked one
			// is a hole, so keep going and be loud about it
			try {
				if (!module.enabled || module.enabled(this, this.global))
					module.default(this, this.global);
				else if (module.disabled) module.disabled(this, this.global);
			} catch (err) {
				dbg.error("failed to install scramjet module", err);
			}
		}
	}

	get url(): _URL {
		return new _URL(this.unrewriteUrl(this.global.location.href));
	}

	set url(url: _URL | string) {
		url = String(url);

		Tap.dispatch(
			this.hooks.lifecycle.navigate,
			{
				type: "location",
			},
			{
				url,
			}
		);

		this.global.location.href = this.rewriteUrl(url, {
			navigateType: "location",
		});
	}

	// below are the utilities for proxying and trapping dom APIs
	// you don't have to understand this it just makes the rest easier
	// i'll document it eventually
	Proxy<T extends string>(name: T, handler: Proxy<T>): void;
	Proxy<const T extends readonly string[]>(
		name: T,
		handler: Proxy<T[number]>
	): void;
	Proxy(name: string | string[], handler: Proxy<any>): void {
		if (Array_isArray(name)) {
			for (const n of name) {
				this.Proxy(n, handler);
			}

			return;
		}

		const split = name.split(".");
		const prop = split.pop();
		const target = split.reduce((a, b) => a?.[b], this.global);
		if (!target) return;
		if (!prop) return;

		this.RawProxy(target, prop, handler, name);
	}
	RawProxy(target: any, prop: string, handler: Proxy<any>, debugname?: string) {
		if (!target) return;
		if (!prop) return;
		if (!Reflect_has(target, prop)) return;

		const value = Reflect_get(target, prop);
		const originalDescriptor = Object_getOwnPropertyDescriptor(target, prop);
		delete target[prop];

		const h: ProxyHandler<any> = {};

		let applyFn: typeof Reflect_apply;
		let constructFn: typeof Reflect_construct;
		if (this.flagEnabled("debugTrampolines")) {
			let fnName: string;
			if (debugname) {
				fnName = debugname;
			} else if (typeof value === "function" && value.name) {
				fnName = `Function ${value.name} -> ${prop}`;
			} else if (typeof value === "object" && value.constructor) {
				fnName = `Object ${value.constructor.name} -> ${prop}`;
			} else {
				fnName = `${typeof value} -> ${prop}`;
			}
			let windowName = new this.native.window(this.global).name;
			if (!windowName) windowName = "<unnamed window>";
			let location = this.url.href;

			// sanitize newlines just in case somehow
			location = location.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
			windowName = windowName.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
			fnName = fnName.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
			const sourceURL = debugname ? `${debugname}.sj` : "rawproxy.sj";

			const { construct, apply } = new this.native.window(this.global).Function(
				`"use strict";

// SCRAMJET FUNCTION INTERCEPT
// target: ${fnName}
// frame: ${windowName}
// location: ${location}

function apply(fn, that, args) {
	return Reflect.apply(fn, that, args);
}

function construct(fn, args, newTarget) {
	return Reflect.construct(fn, args, newTarget);
}

return { apply, construct };

//# sourceURL=${sourceURL}`
			)();

			applyFn = apply;
			constructFn = construct;
		} else {
			applyFn = Reflect_apply;
			constructFn = Reflect_construct;
		}

		if (handler.construct) {
			h.construct = function (
				constructor: any,
				args: any[],
				newTarget: AnyFunction
			) {
				let returnValue: any = undefined;
				let earlyreturn = false;

				const ctx: ProxyCtx<any, "construct"> = {
					fn: constructor,
					this: null,
					args,
					newTarget: newTarget,
					return: (r: any) => {
						earlyreturn = true;
						returnValue = r;
					},
					call: () => {
						earlyreturn = true;
						returnValue = constructFn(ctx.fn, ctx.args, ctx.newTarget);

						return returnValue;
					},
				};

				handler.construct(ctx);

				if (earlyreturn) {
					return returnValue;
				}

				return constructFn(ctx.fn, ctx.args, ctx.newTarget);
			};
		}

		if (handler.apply) {
			h.apply = (fn: any, that: any, args: any[]) => {
				let returnValue: any = undefined;
				let earlyreturn = false;

				const ctx: ProxyCtx<any, "apply"> = {
					fn,
					this: that,
					args,
					newTarget: null,
					return: (r: any) => {
						earlyreturn = true;
						returnValue = r;
					},
					call: () => {
						earlyreturn = true;
						returnValue = applyFn(ctx.fn, ctx.this, ctx.args);

						return returnValue;
					},
				};
				if (
					!this.flagEnabled("debugTrampolines") &&
					this.flagEnabled("allowFailedIntercepts")
				) {
					// fast path, no error detection
					handler.apply(ctx);

					if (earlyreturn) {
						return returnValue;
					}
					return applyFn(ctx.fn, ctx.this, ctx.args);
				}

				const pst = Error.prepareStackTrace;

				// eslint-disable-next-line @typescript-eslint/no-this-alias
				const client = this;
				Error.prepareStackTrace = function (err, s) {
					if (
						s[0].getFileName() &&
						!s[0].getFileName().startsWith(client.context.prefix.href)
					) {
						return { stack: err.stack };
					}
				};

				try {
					handler.apply(ctx);
				} catch (err) {
					if (this.box.instanceof(err, "Error")) {
						if (this.box.instanceof(err.stack, "Object")) {
							//i'm not going to explain this
							err.stack = err.stack.stack;
							// eslint-disable-next-line scramjet-core/no-globals
							console.error("ERROR FROM SCRAMJET INTERNALS", err);
							if (!this.flagEnabled("allowFailedIntercepts")) {
								Error.prepareStackTrace = pst;
								throw err;
							}
						} else {
							Error.prepareStackTrace = pst;
							throw err;
						}
					} else {
						Error.prepareStackTrace = pst;
						throw err;
					}
				}

				Error.prepareStackTrace = pst;

				if (earlyreturn) {
					return returnValue;
				}

				return applyFn(ctx.fn, ctx.this, ctx.args);
			};
		}

		const proxy = new Proxy(value, h);
		this.box.unproxy.set(proxy, value);
		h.getOwnPropertyDescriptor = getOwnPropertyDescriptorHandler;
		// Preserve original property descriptor (enumerable, configurable, etc.)
		Object_defineProperty(target, prop, {
			value: proxy,
			writable: originalDescriptor?.writable ?? true,
			enumerable: originalDescriptor?.enumerable ?? false,
			configurable: originalDescriptor?.configurable ?? true,
		});
	}
	Trap<T extends string>(name: T, handler: Trap<T>): void;
	Trap<const T extends readonly string[]>(
		name: T,
		handler: Trap<T[number]>
	): void;
	Trap(name: string | string[], descriptor: Trap<any>): void {
		if (Array_isArray(name)) {
			for (const n of name) {
				this.Trap(n, descriptor);
			}

			return;
		}

		const split = name.split(".");
		const prop = split.pop();
		const target = split.reduce((a, b) => a?.[b], this.global);
		if (!target) return;
		if (!prop) return;

		this.RawTrap(target, prop, descriptor);
	}
	RawTrap(target: any, prop: string, descriptor: Trap<any>) {
		if (!target) return;
		if (!prop) return;
		if (!Reflect_has(target, prop)) return;
		const oldDescriptor = Object_getOwnPropertyDescriptor(target, prop);

		const ctx: TrapCtx<any> = {
			this: null,
			get: function () {
				return oldDescriptor && oldDescriptor.get.call(this.this);
			},
			set: function (v: any) {
				// eslint-disable-next-line @typescript-eslint/no-unused-expressions
				oldDescriptor && oldDescriptor.set.call(this.this, v);
			},
		};

		delete target[prop];

		const desc: PropertyDescriptor = {};

		if (descriptor.get) {
			desc.get = function () {
				ctx.this = this;

				return descriptor.get(ctx);
			};
		} else if (oldDescriptor?.get) {
			desc.get = oldDescriptor.get;
		}

		if (descriptor.set) {
			desc.set = function (v: any) {
				ctx.this = this;

				descriptor.set(ctx, v);
			};
		} else if (oldDescriptor?.set) {
			desc.set = oldDescriptor.set;
		}

		if (descriptor.enumerable) desc.enumerable = descriptor.enumerable;
		else if (oldDescriptor?.enumerable)
			desc.enumerable = oldDescriptor.enumerable;
		if (descriptor.configurable) desc.configurable = descriptor.configurable;
		else if (oldDescriptor?.configurable)
			desc.configurable = oldDescriptor.configurable;

		Object_defineProperty(target, prop, desc);
	}

	Intercept(handler: any): void {
		const foreignbaseclass = Object_getPrototypeOf(handler);
		const globalname = foreignbaseclass.name;
		let classname = globalname;
		// the global scope's interface is `Window` in a document and one of the
		// `*GlobalScope`s in a worker. all of them name the same thing as far as
		// interception goes - the global object itself, whose members Blink
		// installs as own properties on the instance rather than on a prototype
		if (classname === "Window" || String_endsWith(classname, "GlobalScope")) {
			classname = "window";
		}
		const baseclass =
			classname === "window" ? this.global : this.global[classname];
		if (!baseclass) return;

		// create a fake parent prototype for the handler, so that `super.method()` calls resolve to the native store versions
		const fakePrototype = {};
		Object_defineProperties(fakePrototype, this.nativeStore.get(classname));
		Object_setPrototypeOf(handler.prototype, fakePrototype);

		const attemptToCallHandler = (
			handler: (...args: any[]) => any,
			that: any,
			args: any[],
			fallback: (args: any[]) => any,
			validate: IDLValidator | undefined,
			isAsync: boolean
		) => {
			// coerce the arguments per the member's declared IDL before the
			// interceptor body can look at them, so a hostile toString/valueOf
			// runs exactly once. a rejection means the call is invalid, so skip
			// our body entirely and let the native throw the real TypeError
			if (validate && !validate(args)) {
				return fallback(args);
			}

			if (isAsync) {
				return this.relevantPromise(that, () =>
					Function_apply(handler, that, args)
				);
			}

			return Function_apply(handler, that, args);
		};

		// a getter-only native attribute the interceptor writes to, or the
		// reverse. never reached by anything we ship, but `new Proxy(undefined)`
		// throws, so the half has to exist
		const missingHalf = () => undefined;

		const createProxy = (
			handler: (...args: any[]) => any,
			old: ((...args: any[]) => any) | undefined,
			validate: IDLValidator | undefined
		) => {
			// settled once, at install time, rather than on every call
			const isAsync =
				Object_getPrototypeOf(handler) === AsyncFunction_prototype;
			const target = old || missingHalf;

			return new Proxy(target, {
				apply(_, thisArg, args) {
					return attemptToCallHandler(
						handler,
						thisArg,
						args,
						(a) => Function_apply(target, thisArg, a),
						validate,
						isAsync
					);
				},
			});
		};

		const writePrototypeField = (
			key: string | symbol,
			prototype: any,
			handlerDescriptor: PropertyDescriptor
		) => {
			// walked rather than read straight off `prototype`, because where an
			// engine puts an interface's members is not fixed. Blink installs the
			// global scope's own onto the window instance but a worker's onto
			// `WorkerGlobalScope.prototype`, and an own-property-only lookup finds
			// nothing there and silently installs nothing at all
			let owner = prototype;
			let oldDescriptor: PropertyDescriptor | undefined;
			while (owner) {
				oldDescriptor = Object_getOwnPropertyDescriptor(owner, key);
				if (oldDescriptor) break;
				owner = Object_getPrototypeOf(owner);
			}

			// a member this engine doesn't have. there is nothing to wrap, and
			// adding it would advertise the proxy rather than hide it
			if (!oldDescriptor) return;
			if (!oldDescriptor.configurable) {
				dbg.error(
					`cannot intercept non-configurable ${classname}.${String(key)}`
				);

				return;
			}

			// carried over wholesale rather than rebuilt, so that the half of an
			// accessor the interceptor did *not* declare keeps working. dropping a
			// native setter because only a getter was overridden turns every write
			// into a silent no-op
			const newDescriptor: PropertyDescriptor = {
				enumerable: oldDescriptor.enumerable,
				configurable: oldDescriptor.configurable,
			};

			if (oldDescriptor.get || oldDescriptor.set) {
				// a getter takes no arguments, so there is nothing to validate on one
				newDescriptor.get = handlerDescriptor.get
					? createProxy(handlerDescriptor.get, oldDescriptor.get, undefined)
					: oldDescriptor.get;
				newDescriptor.set = handlerDescriptor.set
					? createProxy(
							handlerDescriptor.set,
							oldDescriptor.set,
							memberValidator(this.box, handlerDescriptor.set, true)
						)
					: oldDescriptor.set;
			} else {
				newDescriptor.writable = oldDescriptor.writable;
				newDescriptor.value =
					"value" in handlerDescriptor
						? createProxy(
								handlerDescriptor.value,
								oldDescriptor.value,
								memberValidator(this.box, handlerDescriptor.value)
							)
						: oldDescriptor.value;
			}

			// defined over the top rather than deleted first: `delete` would move
			// the member to the end of the prototype's key order, which is a free
			// tell that it was touched. and onto whichever object actually holds
			// it, so the patch does not become a shadowing own property
			Object_defineProperty(owner, key, newDescriptor);
		};

		/**
		 * Whether `key` is a property the class syntax generated rather than a
		 * member the interceptor declared.
		 *
		 * `length` and `name` are also real IDL member names - `IDBDatabase.name`,
		 * `NodeList.length` - so they can only be skipped when they still carry
		 * the shape the class evaluation gave them. A declared static of either
		 * name is writable or an accessor; the generated one is a non-writable
		 * data property.
		 */
		const isClassMetadata = (
			key: string | symbol,
			desc: PropertyDescriptor,
			isStatic: boolean
		): boolean => {
			if (key === "prototype") return true;
			// the only own property class evaluation puts on `.prototype`
			if (!isStatic) return key === "constructor";
			if (key !== "length" && key !== "name") return false;

			return "value" in desc && desc.writable === false;
		};

		const prototypeDescs: Record<string | symbol, PropertyDescriptor> =
			Object_getOwnPropertyDescriptors(handler.prototype);
		for (const prop of Reflect_ownKeys(prototypeDescs)) {
			const classDesc = prototypeDescs[prop];
			if (isClassMetadata(prop, classDesc, false)) continue;
			if (isConstructorMember(classDesc.value)) continue;
			writePrototypeField(prop, baseclass.prototype, classDesc);
		}
		const staticDescs: Record<string | symbol, PropertyDescriptor> =
			Object_getOwnPropertyDescriptors(handler);
		for (const prop of Reflect_ownKeys(staticDescs)) {
			const handlerDesc = staticDescs[prop];
			if (isClassMetadata(prop, handlerDesc, true)) continue;
			const value = handlerDesc.value;
			if (value && isConstructorMember(value)) {
				const nativeCtor = this.nativeStore.get("window")[globalname].value;
				const validate = memberValidator(this.box, value);
				// constructor isn't a field, replace the entire class on the global with a proxy
				this.global[globalname] = new Proxy(baseclass, {
					construct: (_, args, newTarget) =>
						attemptToCallHandler(
							value,
							nativeCtor, // use the native constructor as `this` in order to make the `new this()` syntax work properly
							args,
							// a rejected argument list has to reach the native as a
							// *construction*, or the page sees "cannot be invoked
							// without 'new'" where it should see the arity TypeError
							(a) => Reflect_construct(nativeCtor, a, newTarget),
							validate,
							false
						),
				});
			} else {
				// normal static method
				writePrototypeField(prop, baseclass, handlerDesc);
			}
		}
	}

	rewriteUrl(url: string | URL, options?: RewriteUrlOptions): string {
		return rewriteUrl(url, this.context, this.meta, options);
	}

	unrewriteUrl(url: string | URL): string {
		return unrewriteUrl(url, this.context);
	}

	flagEnabled(flag: keyof ScramjetConfig["flags"]): boolean {
		const cached = this.flagCache.get(flag);
		if (cached !== undefined) return cached;

		const result = flagEnabled(flag, this.context, this.url);
		this.flagCache.set(flag, result);
		return result;
	}

	get config(): ScramjetConfig {
		return this.context.config;
	}

	// The client whose realm created `obj`.
	// note: this is based on a heuristic that can be fooled, i don't know of a 100% reliable way to do this
	relevantClient(obj: any): ScramjetClient {
		let current = obj;

		// bounded: a page can build an arbitrarily long prototype chain
		for (let i = 0; i < 64; i++) {
			if (current === null || current === undefined) break;

			const next = Object_getPrototypeOf(current);
			if (next === null) return this.box.realms.get(current) ?? this;

			current = next;
		}

		return this;
	}

	// generate a promise in the same realm as the relevant object
	relevantPromise<T>(
		relevantObject: any,
		callback: () => Promise<T>
	): Promise<T> {
		const RelevantPromise = this.relevantClient(relevantObject).nativeStore.get(
			"window"
		)!.Promise.value as PromiseConstructor;

		return new RelevantPromise<T>((resolve, reject) => {
			callback().then(resolve, reject);
		});
	}
}
