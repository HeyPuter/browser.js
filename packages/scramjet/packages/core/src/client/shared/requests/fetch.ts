import { ScramjetClient } from "@client/index";
import { unrewriteLinkHeader } from "./XMLHttpRequest";
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
	const nativeWindow = new client.native.window(self);

	client.Intercept(
		class extends Window {
			// RequestInfo is the Fetch typedef `(Request or USVString)`.
			// https://fetch.spec.whatwg.org/#requestinfo
			@Arguments("(Request or USVString)", "optional RequestInit")
			@Returns("Promise<Response>")
			static fetch(input: RequestInfo, requestInit: RequestInit = {}) {
				if (typeof input === "string") {
					input = client.rewriteUrl(
						input,
						rewriteUrlOptionsForFetch(requestInit)
					);
				}

				// TODO: how do i handle promised realms?
				return (async () => {
					const response = await nativeWindow.fetch(input, requestInit);
					client.box.taggedResponses.add(response);
					return response;
				})();
			}
		}
	);

	client.Intercept(
		class extends Request {
			@Constructor("(Request or USVString)", "optional RequestInit")
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
	client.Intercept(
		class extends Response {
			@Type("USVString")
			get url(): string {
				if (client.box.taggedResponses.has(this)) {
					return client.unrewriteUrl(super.url);
				}
				return super.url;
			}
			@Type("Headers")
			get headers(): Headers {
				const headers = super.headers;
				if (client.box.taggedResponses.has(this)) {
					// this is a response object that came from a network request. tag it so that the headers can be replaced later
					client.box.taggedHeaders.add(headers);
				}
				return headers;
			}
		}
	);

	client.Intercept(
		class extends Headers {
			@Arguments("ByteString")
			@Returns("ByteString?")
			get(name: string): string | null {
				const value = super.get(name);
				if (client.box.taggedHeaders.has(this)) {
					const orig = super.get(`X-Scramjet-${name}`);
					if (orig) return orig;
				}
				return value;
			}
		}
	);
}
