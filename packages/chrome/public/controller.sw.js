var $scramjetController;
(() => {
	var e = {
			223: function (e, t, r) {
				r.d(t, { C: () => o });
				class o {
					methods;
					id;
					sendRaw;
					counter = 0;
					promiseCallbacks = new Map();
					constructor(e, t, r) {
						((this.methods = e), (this.id = t), (this.sendRaw = r));
					}
					recieve(e) {
						if (null == e || "object" != typeof e) return;
						let t = e[this.id];
						if (null == t || "object" != typeof t) return;
						let r = t.$type;
						if ("response" === r) {
							let e = t.$token,
								r = t.$data,
								o = t.$error,
								s = this.promiseCallbacks.get(e);
							if (!s) return;
							(this.promiseCallbacks.delete(e),
								void 0 !== o ? s.reject(Error(o)) : s.resolve(r));
						} else if ("request" === r) {
							let e = t.$method,
								r = t.$args;
							this.methods[e](r)
								.then((e) => {
									this.sendRaw(
										{
											[this.id]: {
												$type: "response",
												$token: t.$token,
												$data: e?.[0],
											},
										},
										e?.[1]
									);
								})
								.catch((e) => {
									(console.error(e),
										this.sendRaw(
											{
												[this.id]: {
													$type: "response",
													$token: t.$token,
													$error: e?.toString() || "Unknown error",
												},
											},
											[]
										));
								});
						}
					}
					call(e, t, r = []) {
						let o = this.counter++;
						return new Promise((s, i) => {
							(this.promiseCallbacks.set(o, { resolve: s, reject: i }),
								this.sendRaw(
									{
										[this.id]: {
											$type: "request",
											$method: e,
											$args: t,
											$token: o,
										},
									},
									r
								));
						});
					}
				}
			},
		},
		t = {};
	function r(o) {
		var s = t[o];
		if (void 0 !== s) return s.exports;
		var i = (t[o] = { exports: {} });
		return (e[o](i, i.exports, r), i.exports);
	}
	((r.d = (e, t) => {
		for (var o in t)
			r.o(t, o) &&
				!r.o(e, o) &&
				Object.defineProperty(e, o, { enumerable: !0, get: t[o] });
	}),
		(r.o = (e, t) => Object.prototype.hasOwnProperty.call(e, t)),
		(r.r = (e) => {
			("undefined" != typeof Symbol &&
				Symbol.toStringTag &&
				Object.defineProperty(e, Symbol.toStringTag, { value: "Module" }),
				Object.defineProperty(e, "__esModule", { value: !0 }));
		}));
	var o = {};
	((() => {
		(r.r(o), r.d(o, { config: () => i, route: () => p, shouldRoute: () => u }));
		var e = r(223);
		let t = {};
		addEventListener("message", (e) => {
			if (e.data && "object" == typeof e.data) {
				if (
					e.data.$sw$setCookieDone &&
					"object" == typeof e.data.$sw$setCookieDone
				) {
					let r = e.data.$sw$setCookieDone,
						o = t[r.id];
					o && (o(), delete t[r.id]);
				}
				if (
					e.data.$sw$initRemoteTransport &&
					"object" == typeof e.data.$sw$initRemoteTransport
				) {
					let { port: t, prefix: r } = e.data.$sw$initRemoteTransport,
						o = d(new URL(r).pathname).then((e) => {
							e
								? e.rpc.call("initRemoteTransport", t, [t])
								: console.error(
										"No relevant controller found for transport init"
									);
						});
					e.waitUntil(o);
				}
			}
		});
		class s {
			prefix;
			id;
			rpc;
			constructor(r, o, s) {
				((this.prefix = r),
					(this.id = o),
					(this.rpc = new e.C(
						{
							sendSetCookie: async ({ cookies: e, options: r }) => {
								let o = await self.clients.matchAll(),
									s = [],
									i = [],
									n =
										r?.destination === "document" ||
										r?.destination === "iframe";
								for (let a of o) {
									let o = Math.random().toString(36).substring(2, 10);
									(s.push(o),
										a.postMessage({
											$controller$setCookie: { cookies: e, options: r, id: o },
										}),
										n ||
											i.push(
												new Promise((e) => {
													t[o] = () => e(o);
												})
											));
								}
								if (i.length > 0) {
									let r,
										n = !1,
										a = new Promise((i) => {
											r = setTimeout(() => {
												if (!n) {
													let r = s.filter((e) => void 0 !== t[e]);
													console.error(
														`timed out waiting for set cookie response (deadlock?): cookies=${e.length} clients=${o.length} pending=${r.length}/${s.length} clientUrls=${o.map((e) => e.url).join(",")}`
													);
												}
												i();
											}, 1e3);
										});
									try {
										await Promise.race([
											a,
											Promise.any(i)
												.then(() => {
													n = !0;
												})
												.catch(() => {}),
										]);
									} finally {
										for (let e of (void 0 !== r && clearTimeout(r), s))
											delete t[e];
									}
								}
							},
						},
						"tabchannel-" + o,
						(e, t) => {
							s.postMessage(e, t);
						}
					)),
					(s.onmessage = (e) => {
						this.rpc.recieve(e.data);
					}),
					(s.onmessageerror = console.error),
					this.rpc.call("ready", void 0));
			}
		}
		let i = { prefix: "/~/sj/", reviveTimeout: 1e4 },
			n = [],
			a = new Map();
		function l(e) {
			return (
				(e.startsWith(i.prefix) && e.slice(i.prefix.length).split("/")[0]) ||
				null
			);
		}
		function d(e) {
			let t = n.find((t) => e.startsWith(t.prefix));
			if (t) return Promise.resolve(t);
			let r = l(e);
			return r
				? new Promise((e) => {
						let t = a.get(r),
							o = !t;
						t || ((t = []), a.set(r, t));
						let s = setTimeout(() => {
								let t = a.get(r);
								if (t) {
									let e = t.indexOf(n);
									(-1 !== e && t.splice(e, 1), 0 === t.length && a.delete(r));
								}
								e(void 0);
							}, i.reviveTimeout),
							n = (t) => {
								(clearTimeout(s), e(t));
							};
						(t.push(n), o && c(r));
					})
				: Promise.resolve(void 0);
		}
		async function c(e) {
			for (let t of await self.clients.matchAll({ includeUncontrolled: !0 }))
				t.postMessage({ $controller$swrevive: { id: e } });
		}
		function u(e) {
			let t = new URL(e.request.url);
			return !!l(t.pathname) || n.some((e) => t.pathname.startsWith(e.prefix));
		}
		async function p(e) {
			try {
				let t = new URL(e.request.url),
					r = await d(t.pathname);
				if (!r)
					return new Response(
						"Proxy controller for this page is gone; reload the proxy page.",
						{ status: 503, headers: { "content-type": "text/plain" } }
					);
				let o = await clients.get(e.clientId),
					s = [...e.request.headers],
					i = await r.rpc.call(
						"request",
						{
							rawUrl: e.request.url,
							rawReferrer: e.request.referrer,
							rawReferrerPolicy: e.request.referrerPolicy,
							destination: e.request.destination,
							mode: e.request.mode,
							referrer: e.request.referrer,
							method: e.request.method,
							body: e.request.body,
							cache: e.request.cache,
							forceCrossOriginIsolated: !1,
							initialHeaders: s,
							rawClientUrl: o ? o.url : void 0,
							clientId: e.clientId || e.resultingClientId,
						},
						e.request.body instanceof ReadableStream ||
							e.request.body instanceof ArrayBuffer
							? [e.request.body]
							: void 0
					);
				return new Response(i.body, {
					status: i.status,
					statusText: i.statusText,
					headers: i.headers,
				});
			} catch (e) {
				return (
					console.error("Service Worker error:", e),
					new Response("Internal Service Worker Error: " + e.message, {
						status: 500,
					})
				);
			}
		}
		(addEventListener("message", (e) => {
			if (
				!e.data ||
				"object" != typeof e.data ||
				!e.data.$controller$init ||
				"object" != typeof e.data.$controller$init
			)
				return;
			let t = e.data.$controller$init,
				r = n.findIndex((e) => e.id === t.id);
			-1 !== r && n.splice(r, 1);
			let o = new s(t.prefix, t.id, e.ports[0]);
			n.push(o);
			let i = a.get(t.id);
			if (i) for (let e of (a.delete(t.id), i)) e(o);
		}),
			addEventListener("install", () => {
				self.skipWaiting();
			}),
			addEventListener("activate", (e) => {
				e.waitUntil(clients.claim());
			}));
	})(),
		($scramjetController = o));
})();
//# sourceMappingURL=controller.sw.js.map
