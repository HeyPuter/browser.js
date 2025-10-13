export function trimUrl(v: URL) {
	return (
		(v.protocol === "puter:" ? v.protocol : "") +
		v.host +
		(v.search ? v.pathname : v.pathname.replace(/\/$/, "")) +
		v.search
	);
}
