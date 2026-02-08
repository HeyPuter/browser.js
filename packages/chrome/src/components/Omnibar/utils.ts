import { INTERNAL_URL_PROTOCOL } from "../../consts";

export function trimUrl(v: URL) {
	let isDirectSchema = v.hostname === "";
	return (
		(isDirectSchema || v.protocol === INTERNAL_URL_PROTOCOL ? v.protocol : "") +
		v.host +
		(v.search ? v.pathname : v.pathname.replace(/\/$/, "")) +
		v.search
	);
}
