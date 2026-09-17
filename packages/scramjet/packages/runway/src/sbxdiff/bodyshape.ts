/**
 * Byte-level shape of a request-body divergence.
 *
 * Its own module because `index.ts` runs `main()` on import, so nothing there
 * can be unit tested.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { bodyFileStem } from "./store.ts";

const HERE = import.meta.dirname;

/**
 * Where two request bodies part company, in bytes.
 *
 * The hashes say a body diverged; they cannot say how, and "1067 bytes more
 * than the other side" on a Cloudflare payload is not a question a hash can
 * answer. Both sides dump their bytes (the oracle from C++ in the network
 * service, a real sandbox through the store's beacon), so the report can say
 * whether the two agree on a long prefix and part at one field, or disagree
 * from the very first byte.
 *
 * That distinction is the whole diagnosis. Cloudflare's payload is
 * `base64(rsa-wrapped key || xtea(lzw(json)))`: a shared prefix that ends
 * inside the ciphertext means the KEY reproduced and only the plaintext
 * differs, while parting at byte 0 means the key itself did not -- and those
 * two point at completely different causes.
 *
 * Diagnostics only: a missing dump is silence, never a failed run.
 */
export function bodyShape(
	nearLabel: string,
	farLabel: string,
	url: string,
	ordinal: number,
	root: string = path.join(HERE, ".traces", "bodydiff")
): string | undefined {
	const stem = bodyFileStem(url, ordinal);
	const at = (label: string, ext: string) =>
		path.join(root, label, `${stem}.${ext}`);
	const read = (p: string) => {
		try {
			return readFileSync(p);
		} catch {
			return undefined;
		}
	};
	const a = read(at(nearLabel, "oracle"));
	// A real sandbox posts its bytes to the store, which writes them flat under
	// .traces/bodydiff; a second oracle dumps from C++ into its own directory.
	const b =
		read(at(farLabel, "oracle")) ?? read(path.join(root, `${stem}.sandbox`));
	if (!a || !b) return undefined;

	let pre = 0;
	while (pre < Math.min(a.length, b.length) && a[pre] === b[pre]) pre++;
	let suf = 0;
	while (
		suf < Math.min(a.length, b.length) - pre &&
		a[a.length - 1 - suf] === b[b.length - 1 - suf]
	)
		suf++;
	const delta = b.length - a.length;
	return (
		`bytes: ${a.length} vs ${b.length} (${delta >= 0 ? "+" : ""}${delta}), ` +
		`agree on the first ${pre} and the last ${suf}`
	);
}
