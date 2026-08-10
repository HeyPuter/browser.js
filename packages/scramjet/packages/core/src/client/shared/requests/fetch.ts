import { ScramjetClient } from "@client/index";
import { unrewriteLinkHeader } from "./XMLHttpRequest";
import { String } from "@/shared/snapshot";
import { Arguments, Constructor, Returns, Type } from "@client/webidl";

/**
 * Capture the page's intended `init.mode` / `init.credentials` and forward
 * them to `rewriteUrl` so they get stamped onto the proxy URL as `sj$mode` /
 * `sj$cred`. The service-side handler reads those back when computing
 * Sec-Fetch-Mode / Sec-Fetch-Storage-Access, since `event.request.mode` and
 * `event.request.credentials` from the SW are derived against the rewritten
 * same-origin URL and don't reflect the page's actual intent.
 */
function rewriteUrlOptionsForFetch(init: RequestInit | undefined) {
	return {
		// `fetch()` and `new Request()` both default mode to "cors" per spec.
		mode: init?.mode ?? "cors",
		credentials: init?.credentials === "include" ? "include" : undefined,
	};
}

export default function (client: ScramjetClient, self: Self) {
	client.Intercept(
		class extends Window {
			@Arguments("RequestInfo", "optional RequestInit")
			@Returns("Promise<Response>")
			static fetch(input: RequestInfo, requestInit: RequestInit = {}) {
				if (typeof input === "string") {
					input = client.rewriteUrl(
						input,
						rewriteUrlOptionsForFetch(requestInit)
					);
				}

				return this.fetch(input, requestInit);
			}
		}
	);

	client.Intercept(
		class extends Request {
			@Constructor("RequestInfo", "optional RequestInit")
			static konstructor(input: RequestInfo, requestInit: RequestInit = {}) {
				if (typeof input === "string") {
					input = client.rewriteUrl(
						input,
						rewriteUrlOptionsForFetch(requestInit)
					);
				}
				return new this(input, requestInit);
			}

			@Type("USVString")
			get url() {
				return client.unrewriteUrl(super.url);
			}
		}
	);

	client.Trap(["Request.prototype.url", "Response.prototype.url"], {
		get(ctx) {
			return client.unrewriteUrl(ctx.get() as string);
		},
	});

	// TODO: this needs to be only for response objects created from a fetch
	client.Trap("Response.prototype.headers", {
		get(ctx) {
			const headers = ctx.get() as Headers;
			const newHeaders = new Headers();

			for (const [key, value] of headers.entries()) {
				if (key.toLowerCase() === "link") {
					newHeaders.append(key, unrewriteLinkHeader(value, client.context));
				} else {
					newHeaders.append(key, value);
				}
			}

			return newHeaders;
		},
	});
}
