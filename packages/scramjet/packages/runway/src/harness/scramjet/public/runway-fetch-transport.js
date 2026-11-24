/**
 * Bench only (`/?transport=fetch`): a transport that is a plain `fetch` to the
 * local replay server, with the logical host in `x-bench-host` - so a bench
 * can tell the proxy's own cost from libcurl's and wisp's.
 */
class RunwayFetchTransport {
	ready = true;
	async init() {}
	async request(remote, method, body, headers, signal) {
		const site = window.__runwayCleartextSite;
		const url = new URL(remote.href);
		const wire = `http://127.0.0.1:${site.httpPort}${url.pathname}${url.search}`;
		const h = new Headers();
		for (const [k, v] of headers ?? []) {
			try {
				h.append(k, v);
			} catch {}
		}
		h.set("x-bench-host", url.host);
		const res = await fetch(wire, {
			method,
			body,
			headers: h,
			signal,
			redirect: "manual",
			credentials: "omit",
		});
		return {
			body: res.body,
			headers: [...res.headers],
			status: res.status,
			statusText: res.statusText,
		};
	}
	connect() {
		throw new Error("no websockets in the fetch transport");
	}
}
window.RunwayFetchTransport = RunwayFetchTransport;
