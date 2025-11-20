var $scramjetController;
(() => {
	// webpackBootstrap
	var __webpack_modules__ = {
		"./packages/scramjet/packages/rpc/index.ts":
			/*!*************************************************!*\
  !*** ./packages/scramjet/packages/rpc/index.ts ***!
  \*************************************************/
			function (
				__unused_webpack_module,
				__webpack_exports__,
				__webpack_require__
			) {
				__webpack_require__.r(__webpack_exports__);
				__webpack_require__.d(__webpack_exports__, {
					RpcHelper: () => RpcHelper,
				});
				class RpcHelper {
					methods;
					id;
					sendRaw;
					counter = 0;
					promiseCallbacks = new Map();
					constructor(methods, id, sendRaw) {
						this.methods = methods;
						this.id = id;
						this.sendRaw = sendRaw;
					}
					recieve(data) {
						if (data === undefined || data === null || typeof data !== "object")
							return;
						const dt = data[this.id];
						if (dt === undefined || dt === null || typeof dt !== "object")
							return;
						const type = dt.$type;
						if (type === "response") {
							const token = dt.$token;
							const data = dt.$data;
							const error = dt.$error;
							const cb = this.promiseCallbacks.get(token);
							if (!cb) return;
							this.promiseCallbacks.delete(token);
							if (error !== undefined) {
								cb.reject(new Error(error));
							} else {
								cb.resolve(data);
							}
						} else if (type === "request") {
							const method = dt.$method;
							const args = dt.$args;
							this.methods[method](args)
								.then((r) => {
									this.sendRaw(
										{
											[this.id]: {
												$type: "response",
												$token: dt.$token,
												$data: r?.[0],
											},
										},
										r?.[1]
									);
								})
								.catch((err) => {
									this.sendRaw(
										{
											[this.id]: {
												$type: "response",
												$token: dt.$token,
												$error: err?.toString() || "Unknown error",
											},
										},
										[]
									);
								});
						}
					}
					call(method, args, transfer = []) {
						let token = this.counter++;
						return new Promise((resolve, reject) => {
							this.promiseCallbacks.set(token, {
								resolve,
								reject,
							});
							this.sendRaw(
								{
									[this.id]: {
										$type: "request",
										$method: method,
										$args: args,
										$token: token,
									},
								},
								transfer
							);
						});
					}
				}
			},
	};
	/************************************************************************/
	// The module cache
	var __webpack_module_cache__ = {};

	// The require function
	function __webpack_require__(moduleId) {
		// Check if module is in cache
		var cachedModule = __webpack_module_cache__[moduleId];
		if (cachedModule !== undefined) {
			return cachedModule.exports;
		}
		// Create a new module (and put it into the cache)
		var module = (__webpack_module_cache__[moduleId] = {
			exports: {},
		});
		// Execute the module function
		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);

		// Return the exports of the module
		return module.exports;
	}

	/************************************************************************/
	// webpack/runtime/define_property_getters
	(() => {
		__webpack_require__.d = (exports, definition) => {
			for (var key in definition) {
				if (
					__webpack_require__.o(definition, key) &&
					!__webpack_require__.o(exports, key)
				) {
					Object.defineProperty(exports, key, {
						enumerable: true,
						get: definition[key],
					});
				}
			}
		};
	})();
	// webpack/runtime/has_own_property
	(() => {
		__webpack_require__.o = (obj, prop) =>
			Object.prototype.hasOwnProperty.call(obj, prop);
	})();
	// webpack/runtime/make_namespace_object
	(() => {
		// define __esModule on exports
		__webpack_require__.r = (exports) => {
			if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
				Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
			}
			Object.defineProperty(exports, "__esModule", { value: true });
		};
	})();
	/************************************************************************/
	var __webpack_exports__ = {};
	// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
	(() => {
		/*!*********************************************************!*\
  !*** ./packages/scramjet/packages/controller/src/sw.ts ***!
  \*********************************************************/
		__webpack_require__.r(__webpack_exports__);
		__webpack_require__.d(__webpack_exports__, {
			route: () => route,
			shouldRoute: () => shouldRoute,
		});
		/* ESM import */ var _mercuryworkshop_rpc__WEBPACK_IMPORTED_MODULE_0__ =
			__webpack_require__(
				/*! @mercuryworkshop/rpc */ "./packages/scramjet/packages/rpc/index.ts"
			);

		class Tab {
			prefix;
			id;
			rpc;
			constructor(prefix, id, port) {
				this.prefix = prefix;
				this.id = id;
				this.rpc =
					new _mercuryworkshop_rpc__WEBPACK_IMPORTED_MODULE_0__.RpcHelper(
						{},
						"tabchannel-" + id,
						(data, transfer) => {
							port.postMessage(data, transfer);
						}
					);
				port.addEventListener("message", (e) => {
					this.rpc.recieve(e.data);
				});
				port.onmessageerror = console.error;
				this.rpc.call("ready", null);
			}
		}
		const tabs = [];
		addEventListener("message", (e) => {
			if (!e.data) return;
			if (typeof e.data != "object") return;
			if (!e.data.$controller$init) return;
			if (typeof e.data.$controller$init != "object") return;
			const init = e.data.$controller$init;
			tabs.push(new Tab(init.prefix, init.id, e.ports[0]));
		});
		function shouldRoute(event) {
			const url = new URL(event.request.url);
			const tab = tabs.find((tab) => url.pathname.startsWith(tab.prefix));
			return tab !== undefined;
		}
		async function route(event) {
			try {
				const url = new URL(event.request.url);
				const tab = tabs.find((tab) => url.pathname.startsWith(tab.prefix));
				const client = await clients.get(event.clientId);
				const bareheaders = {};
				// @ts-expect-error for some reason it thinks headers.entries doesn't exist?
				for (const [key, value] of event.request.headers.entries()) {
					bareheaders[key] = [value];
				}
				const response = await tab.rpc.call(
					"request",
					{
						rawUrl: event.request.url,
						destination: event.request.destination,
						mode: event.request.mode,
						referrer: event.request.referrer,
						method: event.request.method,
						body: event.request.body,
						cache: event.request.cache,
						forceCrossOriginIsolated: false,
						initialHeaders: bareheaders,
						rawClientUrl: client ? client.url : undefined,
					},
					event.request.body instanceof ReadableStream || // @ts-expect-error the types for fetchevent are messed up
						event.request.body instanceof ArrayBuffer
						? [event.request.body]
						: undefined
				);
				const realHeaders = new Headers();
				for (const [key, values] of Object.entries(response.headers)) {
					let val =
						typeof values === "string" ? values : (values?.[0] ?? undefined);
					if (val !== undefined) {
						realHeaders.set(key, val);
					}
				}
				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: realHeaders,
				});
			} catch (e) {
				return new Response("Internal Service Worker Error: " + e.message, {
					status: 500,
				});
			}
		}
	})();

	$scramjetController = __webpack_exports__;
})();
//# sourceMappingURL=controller.sw.js.map
