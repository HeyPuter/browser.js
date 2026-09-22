export function trimUrl(url: URL) {
	if (url.protocol !== "https:") return url.href;
	const display = url.href.slice("https://".length);
	return url.pathname === "/" && !url.search && !url.hash
		? display.slice(0, -1)
		: display;
}
