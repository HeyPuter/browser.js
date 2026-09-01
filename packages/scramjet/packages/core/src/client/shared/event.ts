import { iswindow } from "@client/entry";
import { Arguments, Returns } from "@client/webidl";
import { ScramjetClient } from "@client/index";
import {
	readAddEventListenerOptions,
	readEventListenerOptions,
} from "@client/helpers";
import {
	Object_defineProperty,
	Object_getOwnPropertyDescriptor,
	Object_getOwnPropertyNames,
	Object_hasOwn,
	Object_keys,
	Reflect_apply,
	Reflect_get,
	String_indexOf,
	String_startsWith,
	String_substring,
	_Map,
	_WeakMap,
} from "@/shared/snapshot";

export default function (client: ScramjetClient, self: Self) {
	const handlers = {
		message: {
			init(this: MessageEvent) {
				if (client.init.shouldBlockMessageEvent?.(this)) {
					return false;
				}

				return true;
			},
			props: {
				source(this: MessageEvent) {
					if (this.source === null) return null;

					const data = this.data;
					if (
						typeof data === "object" &&
						data !== null &&
						Object_hasOwn(data, "$scramjet$messagetype")
					) {
						console.log(data.$scramjet$nonce, data);
						const realm = client.box.scriptrealms[data.$scramjet$nonce];
						console.log("nonce recovered", realm);
						return realm.client.global;
					}

					// const scram: ScramjetClient = this.source[SCRAMJETCLIENT];

					// if (scram) return scram.globalProxy;

					return this.source;
				},
				/**
				 * The *sender's* origin, fixed when the message was posted.
				 *
				 * `postmessage.ts` stamps every message it sends with a
				 * `$scramjet$messagetype` saying which shape it is, so that is
				 * what gets read here rather than guessing from whether an
				 * origin happens to be present.
				 */
				origin(this: MessageEvent) {
					const data = this.data;

					if (
						typeof data === "object" &&
						data !== null &&
						Object_hasOwn(data, "$scramjet$messagetype")
					) {
						// ports, workers and a worker's own `postMessage` carry no
						// origin, and neither does the event a browser fires for
						// them - it is the empty string
						if (data.$scramjet$messagetype === "worker") return "";

						if (Object_hasOwn(data, "$scramjet$origin"))
							return data.$scramjet$origin;
					}

					// not one of ours: a control message from the service worker or
					// the embedder. its native origin is the *proxy's*, so that is
					// the one answer we must not give; the site's own leaks nothing
					return client.url.origin;
				},
				data(this: MessageEvent) {
					const data = this.data;

					if (
						typeof data === "object" &&
						data !== null &&
						Object_hasOwn(data, "$scramjet$data")
					)
						return data.$scramjet$data;

					return data;
				},
			},
		},
		hashchange: {
			props: {
				oldURL(this: HashChangeEvent) {
					return client.unrewriteUrl(this.oldURL);
				},
				newURL(this: HashChangeEvent) {
					return client.unrewriteUrl(this.newURL);
				},
			},
		},
		storage: {
			init(this: StorageEvent) {
				// `clear()` fires one event with a null key. scramjet's own clear
				// removes keys one at a time, so a null key is another origin's
				// doing and cannot be attributed to this site
				if (this.key === null) return false;

				// scoped to match how `dom/storage.ts` namespaces its *writes* -
				// on `scopeUrl`, which for an about:blank or srcdoc document is
				// its creator's origin rather than its own empty one
				return String_startsWith(this.key, client.scopeUrl.host + "@");
			},
			props: {
				key(this: StorageEvent) {
					return String_substring(this.key, String_indexOf(this.key, "@") + 1);
				},
				url(this: StorageEvent) {
					return client.unrewriteUrl(this.url);
				},
			},
		},
	};

	/**
	 * The stand-in handed to listeners for one dispatched event.
	 *
	 * One per event, not one per listener - see `box.wrappedEvents`.
	 */
	const wrapEvent = (realEvent: Event, props: object): Event => {
		const existing = client.box.wrappedEvents.get(realEvent);
		if (existing) return existing;

		// one wrapper per underlying function, so `e.stopPropagation` is the same
		// object on every read as it is natively
		const methods = new _WeakMap<object, any>();

		const wrapped = new Proxy(realEvent, {
			get(target, prop, reciever) {
				// own only: `props` is an object literal, so an `in` test also
				// answers to `constructor`, `toString` and every other
				// `Object.prototype` member, and would call them as rewriters
				if (Object_hasOwn(props, prop)) return props[prop].call(target);

				const value = Reflect_get(target, prop);

				// a bare proxy fails the brand check on every method and getter
				// ("Illegal invocation"), so anything callable has to be handed
				// over with the receiver corrected back to the real event.
				// `constructor` is the exception: it is the one function-valued
				// interface member nobody invokes against a receiver, and a page
				// comparing `e.constructor === MessageEvent` would otherwise be
				// comparing against the wrapper
				if (typeof value === "function" && prop !== "constructor") {
					const cached = methods.get(value);
					if (cached) return cached;

					const wrappedfn = new Proxy(value, {
						apply(target, that, args) {
							if (that === reciever) {
								return Reflect_apply(target, realEvent, args);
							}

							return Reflect_apply(target, that, args);
						},
					});
					methods.set(value, wrappedfn);

					return wrappedfn;
				}

				return value;
			},
		});

		client.box.wrappedEvents.set(realEvent, wrapped);

		return wrapped;
	};

	function wraplistener(listener: (...args: any) => any) {
		return new Proxy(listener, {
			apply(target, that, args) {
				const realEvent: Event = args[0];

				// we only need to handle events dispatched from the browser
				if (realEvent && realEvent.isTrusted) {
					const type = realEvent.type;

					if (Object_hasOwn(handlers, type)) {
						const handler = handlers[type];

						// if init returns false, we skip the event, and it never
						// dispatches to listeners
						if (handler.init && handler.init.call(realEvent) === false) return;

						args[0] = wrapEvent(realEvent, handler.props);
					}
				}

				// a worker global has no `event` at all
				if (iswindow && !self.event) {
					Object_defineProperty(self, "event", {
						get() {
							return args[0];
						},
						configurable: true,
					});
				}

				const rv = Reflect_apply(target, that, args);

				return rv;
			},
		});
	}

	/**
	 * The wrapper already registered for this exact listener, or a new one.
	 *
	 * The DOM dedupes listeners on (type, callback, capture), so adding the same
	 * one twice is a no-op. Minting a fresh wrapper per call defeated that
	 * entirely - the native saw two different function objects and fired both,
	 * so every double-registration ran twice. That is the usual shape of
	 * idempotent init code, which would double-count on every re-run.
	 */
	const listenerFor = (
		target: EventTarget,
		event: string,
		callback: (...args: any) => any,
		capture: boolean
	) => {
		let arr = client.box.eventcallbacks.get(target);
		if (!arr) {
			arr = [];
			client.box.eventcallbacks.set(target, arr);
		}

		for (let i = 0; i < arr.length; i++) {
			const e = arr[i];
			if (
				e.event === event &&
				e.originalCallback === callback &&
				e.capture === capture
			) {
				return e.proxiedCallback;
			}
		}

		const proxiedCallback = wraplistener(callback);
		arr[arr.length] = {
			event,
			originalCallback: callback,
			proxiedCallback,
			capture,
		};

		return proxiedCallback;
	};

	client.Intercept(class extends EventTarget {
		@Arguments(
			"DOMString",
			"EventListener?",
			"optional (AddEventListenerOptions or boolean)"
		)
		@Returns("undefined")
		addEventListener(
			type: string,
			callback: EventListenerOrEventListenerObject | null,
			options?: AddEventListenerOptions | boolean
		): void {
			// an EventListener *object* is passed through unwrapped, as before.
			// the cast is because narrowing `EventListenerOrEventListenerObject`
			// on `typeof` leaves the bare `Function` type, which has no call
			// signature
			if (typeof callback !== "function") {
				return super.addEventListener(type, callback, options);
			}
			const fn = callback as (...args: any) => any;

			// `(AddEventListenerOptions or boolean)`, where the boolean is just
			// `capture`. The dictionary form is read once, by the shared reader
			// in helpers.ts, because `capture` decides the listener's identity
			// here and the same object then goes to the native
			const init =
				typeof options === "boolean"
					? { capture: options }
					: readAddEventListenerOptions(options);

			return super.addEventListener(
				type,
				listenerFor(this, type, fn, init.capture),
				init
			);
		}

		@Arguments(
			"DOMString",
			"EventListener?",
			"optional (EventListenerOptions or boolean)"
		)
		@Returns("undefined")
		removeEventListener(
			type: string,
			callback: EventListenerOrEventListenerObject | null,
			options?: EventListenerOptions | boolean
		): void {
			if (typeof callback !== "function") {
				return super.removeEventListener(type, callback, options);
			}
			const fn = callback as (...args: any) => any;

			const capture =
				typeof options === "boolean"
					? options
					: readEventListenerOptions(options).capture;
			const arr = client.box.eventcallbacks.get(this);

			if (arr) {
				for (let i = 0; i < arr.length; i++) {
					const e = arr[i];
					if (
						e.event === type &&
						e.originalCallback === fn &&
						e.capture === capture
					) {
						arr.splice(i, 1);

						return super.removeEventListener(type, e.proxiedCallback, {
							capture,
						});
					}
				}
			}

			return super.removeEventListener(type, callback, { capture });
		}
	});

	// every object carrying an `on<type>` for a type we rewrite.
	const ontargets = (): object[] => {
		const found: object[] = [self.self];

		for (const name of Object_getOwnPropertyNames(self)) {
			const descriptor = Object_getOwnPropertyDescriptor(self, name);
			if (!descriptor || typeof descriptor.value !== "function") continue;

			const proto = descriptor.value.prototype;
			if (proto) found[found.length] = proto;
		}

		return found;
	};

	const handlertypes = Object_keys(handlers);

	for (const target of ontargets()) {
		for (let i = 0; i < handlertypes.length; i++) {
			const key = "on" + handlertypes[i];

			const descriptor = Object_getOwnPropertyDescriptor(target, key);
			if (!descriptor || !descriptor.get || !descriptor.set) continue;
			if (!descriptor.configurable) continue;

			// these are the `onmessage`, `onhashchange`, etc. properties
			client.RawTrap(target, key, {
				get(ctx) {
					// keyed on the receiver: these traps live on *prototypes*, so
					// anything remembered per-property is shared by every instance
					// eslint-disable-next-line scramjet-core/no-poisoned-ctx-value
					const stored = client.box.eventhandlers.get(ctx.this);
					const original = stored && stored.get(key);
					if (original) return original;

					return ctx.get();
				},
				set(ctx, value: any) {
					// eslint-disable-next-line scramjet-core/no-poisoned-ctx-value
					let stored = client.box.eventhandlers.get(ctx.this);
					if (!stored) {
						stored = new _Map();
						// eslint-disable-next-line scramjet-core/no-poisoned-ctx-value
						client.box.eventhandlers.set(ctx.this, stored);
					}
					stored.set(key, value);

					if (typeof value !== "function") return ctx.set(value);

					ctx.set(wraplistener(value));
				},
			});
		}
	}
}
