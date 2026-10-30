// Private-cache policy, per RFC 9111 §§3–4 and Fetch's request cache modes.
export const DEFAULT_CACHEABLE_STATUSES = new Set([
	200, 203, 204, 300, 301, 308, 404, 405, 410, 414, 501,
]);

export type CacheControl = Map<string, string | true>;

export function parseCacheControl(value: string | null): CacheControl {
	const directives: CacheControl = new Map();
	// A quoted field-name list can contain commas (e.g. no-cache="ETag, Date").
	for (const token of value?.match(/(?:[^,"]|"(?:\\.|[^"\\])*")+/g) ?? []) {
		const eq = token.indexOf("=");
		const name = (eq < 0 ? token : token.slice(0, eq)).trim().toLowerCase();
		if (!name) continue;
		let argument: string | true = eq < 0 ? true : token.slice(eq + 1).trim();
		if (
			typeof argument === "string" &&
			argument.startsWith('"') &&
			argument.endsWith('"')
		)
			argument = argument.slice(1, -1).replace(/\\(.)/g, "$1");
		// Conflicting or malformed freshness directives are treated as stale.
		if (directives.has(name)) {
			if (name === "max-age") directives.set(name, "0");
			continue;
		}
		directives.set(name, argument);
	}
	return directives;
}

function seconds(value: string | true | null | undefined): number {
	return typeof value === "string" && /^\d+$/.test(value)
		? Math.min(Number(value), Number.MAX_SAFE_INTEGER)
		: 0;
}

export function freshnessLifetime(
	headers: Headers,
	responseTime: number
): number {
	const cc = parseCacheControl(headers.get("cache-control"));
	// RFC 9111 §4.2.1: s-maxage applies only to shared caches.
	if (cc.has("max-age")) return seconds(cc.get("max-age"));
	const date = Date.parse(headers.get("date") ?? "");
	const generatedAt = Number.isFinite(date) ? date : responseTime;
	if (headers.has("expires")) {
		const expires = Date.parse(headers.get("expires")!);
		return Number.isFinite(expires)
			? Math.max(0, (expires - generatedAt) / 1000)
			: 0;
	}
	const modified = Date.parse(headers.get("last-modified") ?? "");
	return Number.isFinite(modified)
		? Math.max(0, (generatedAt - modified) / 10000)
		: 0;
}

export function initialAge(
	headers: Headers,
	requestTime: number,
	responseTime: number
): number {
	// https://httpwg.org/specs/rfc9111.html#age.calculations
	const date = Date.parse(headers.get("date") ?? "");
	const apparentAge = Number.isFinite(date)
		? Math.max(0, (responseTime - date) / 1000)
		: 0;
	const correctedAge =
		seconds(headers.get("age")) +
		Math.max(0, (responseTime - requestTime) / 1000);
	return Math.max(apparentAge, correctedAge);
}

export function responseIsStorable(status: number, headers: Headers): boolean {
	// Partial responses require range combination, which this cache does not implement.
	if (
		status < 200 ||
		status === 206 ||
		status === 304 ||
		headers.has("content-range")
	)
		return false;
	const cc = parseCacheControl(headers.get("cache-control"));
	if (
		cc.has("no-store") ||
		headers
			.get("vary")
			?.split(",")
			.some((name) => name.trim() === "*")
	)
		return false;
	return (
		DEFAULT_CACHEABLE_STATUSES.has(status) ||
		cc.has("max-age") ||
		cc.has("public") ||
		cc.has("private") ||
		headers.has("expires")
	);
}

export function canReuse(
	headers: Headers,
	requestHeaders: Headers,
	mode: RequestCache,
	age: number,
	responseTime: number
): boolean {
	const response = parseCacheControl(headers.get("cache-control"));
	const request = parseCacheControl(requestHeaders.get("cache-control"));
	if (response.has("no-store")) return false;
	// Fetch's explicit cache modes bypass validation, including no-cache and
	// must-revalidate responses. https://fetch.spec.whatwg.org/#http-network-or-cache-fetch
	if (mode === "force-cache" || mode === "only-if-cached") return true;
	if (
		response.has("no-cache") ||
		request.has("no-cache") ||
		mode === "no-cache" ||
		mode === "reload" ||
		mode === "no-store"
	)
		return false;
	if (
		(headers.get("pragma") ?? "")
			.toLowerCase()
			.split(",")
			.some((part) => part.trim() === "no-cache")
	)
		return false;
	if (
		!requestHeaders.has("cache-control") &&
		(requestHeaders.get("pragma") ?? "").toLowerCase().includes("no-cache")
	)
		return false;
	if (request.has("max-age") && age >= seconds(request.get("max-age")))
		return false;
	const fresh =
		age + seconds(request.get("min-fresh")) <
		freshnessLifetime(headers, responseTime);
	// RFC 8246 §2: immutable never extends the response's freshness lifetime.
	return fresh;
}
