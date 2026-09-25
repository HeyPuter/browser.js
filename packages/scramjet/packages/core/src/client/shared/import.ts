import { ScramjetClient } from "@client/index";
import { isOwnScript } from "@client/nativeerror";
import { rawCallSites } from "@/shared/incumbency";
import { resolveWithImportMaps, urlLike } from "@rewriters/importmap";
import { type URLMeta, unrewriteUrl } from "@rewriters/url";
import {
	Object_defineProperty,
	Promise_reject,
	Promise_then,
	String_indexOf,
	String_startsWith,
	String_substring,
	_URL,
} from "@/shared/snapshot";

/**
 * `message` with every proxy URL in it - whole, or the path a rewritten
 * specifier leaves in a link error - put back to the URL the page asked for.
 */
function unrewriteMessage(client: ScramjetClient, message: string): string {
	const { origin, pathname } = client.context.prefix;
	let out = "";
	let from = 0;
	for (;;) {
		const at = String_indexOf(message, pathname, from);
		if (at === -1) break;

		const start =
			at >= origin.length &&
			String_substring(message, at - origin.length, at) === origin
				? at - origin.length
				: at;
		let end = at;
		while (end < message.length) {
			const c = message[end];
			if (c === " " || c === "'" || c === '"' || c === "`" || c === "\n") {
				break;
			}
			end++;
		}

		out +=
			String_substring(message, from, start) +
			unrewriteUrl(origin + String_substring(message, at, end), client.context);
		from = end;
	}

	return out + String_substring(message, from);
}

/**
 * The meta to rewrite `js` with, when it is handed to `eval` or `Function`:
 * the client's, with the base URL of the script that called. Code compiled
 * that way inherits the calling script's, so an `import("./x.js")` in it
 * resolves against that script - not against the document.
 *
 * Read off the stack, which is not free, so only for code that could have an
 * `import()` in it at all. The first frame that is neither scramjet's nor
 * eval code (which has no file, and inherits from the frame below it) is the
 * caller. An inline script's frame is the document's URL, and its base is
 * the document's base.
 */
export function callerMeta(client: ScramjetClient, js: string): URLMeta {
	if (String_indexOf(js, "import") === -1) return client.meta;

	const frames = rawCallSites(32);
	if (!frames) return client.meta;

	for (let i = 0; i < frames.length; i++) {
		let file: string | undefined;
		try {
			file = frames[i].getFileName?.();
		} catch {
			continue;
		}
		if (!file) continue;
		if (isOwnScript(file, client.config.maskedfiles)) continue;
		if (!String_startsWith(file, client.context.prefix.href)) break;

		let url: _URL;
		try {
			url = new _URL(unrewriteUrl(file, client.context));
		} catch {
			break;
		}
		url.hash = "";
		const document = new _URL(client.url.href);
		document.hash = "";
		if (url.href === document.href) break;

		const meta = client.meta;

		return {
			get origin() {
				return meta.origin;
			},
			get topUrl() {
				return meta.topUrl;
			},
			get topFrameName() {
				return meta.topFrameName;
			},
			get parentFrameName() {
				return meta.parentFrameName;
			},
			get referrerPolicy() {
				return meta.referrerPolicy;
			},
			base: url,
		};
	}

	return client.meta;
}

export default function (client: ScramjetClient, self: Self) {
	// the options are passed along for the browser to check and act on: a
	// `with: { type: "json" }` is what makes it a JSON module at all
	const boundimport = new client.native.window(self).Function(
		"url",
		"options",
		"return import(url, options)"
	);

	/**
	 * `import(specifier, options)`, called from code whose URL is `base`.
	 *
	 * Import maps are resolved here rather than left to the browser, because
	 * the browser resolves an `import()` against the *calling script's* URL -
	 * and every dynamic import is called from `boundimport`, a function of
	 * scramjet's own, whose URL no scope the page wrote will ever match.
	 *
	 * https://tc39.es/ecma262/#sec-import-call-runtime-semantics-evaluation
	 */
	const dynamicImport = (
		base: string,
		specifier: unknown,
		options: unknown
	) => {
		// every failure, from the ToString on, is a rejection - never a throw.
		// a template rather than `String()`, which would turn a Symbol into its
		// description where ToString throws
		const url = `${specifier}`;

		// null in a worker, which has no import maps, and in a document with none
		const document = client.global.document as Document | undefined;
		const maps = document ? client.text.importMapState(document) : null;

		let resolved: _URL | null = null;
		if (maps) {
			const match = resolveWithImportMaps(maps, url, base);
			// a null entry, or one that backtracks out of its prefix: the
			// browser refuses those outright
			if (match === "blocked") {
				return Promise_reject(
					client.errors.typeError({
						detail: `Failed to resolve module specifier '${url}'`,
					})
				);
			}
			resolved = match;
		}

		if (!resolved) resolved = urlLike(url, base);

		if (!resolved) {
			// a bare specifier no map knows: the native's to refuse. a relative
			// one against a base that cannot have one is refused here, since
			// the native would resolve it against scramjet's URL instead
			if (
				!String_startsWith(url, "/") &&
				!String_startsWith(url, "./") &&
				!String_startsWith(url, "../")
			) {
				return boundimport(url, options);
			}

			return Promise_reject(
				client.errors.typeError({
					detail: `Failed to resolve module specifier '${url}'`,
				})
			);
		}

		// the map's `integrity` is not enforced - see `rewriters/importmap`
		return Promise_then(
			boundimport(
				client.rewriteUrl(resolved.href, { isModule: true }),
				options
			),
			undefined,
			(err: unknown) => {
				// the module the browser failed to fetch, link or evaluate is
				// named by the URL it loaded, which is scramjet's
				try {
					const message = (err as Error).message;
					if (typeof message === "string") {
						(err as Error).message = unrewriteMessage(client, message);
					}
				} catch {
					// not an error the page could read a message off either
				}
				throw err;
			}
		);
	};

	Object_defineProperty(self, client.config.globals.importfn, {
		value: function (base: string, specifier: unknown, options?: unknown) {
			try {
				return dynamicImport(base, specifier, options);
			} catch (err) {
				return Promise_reject(err);
			}
		},
		writable: false,
		configurable: false,
		enumerable: false,
	});
	Object_defineProperty(self, client.config.globals.metafn, {
		value: function (metaobj: any, base: string) {
			metaobj.url = base;
			metaobj.resolve = function (url: string) {
				return new _URL(url, base).href;
			};

			return metaobj;
		},
		writable: false,
		configurable: false,
		enumerable: false,
	});
}
