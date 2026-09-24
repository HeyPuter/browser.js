/** Content-Disposition parameters, including RFC 6266's preferred filename*. */
export function dispositionFilename(header: string | null): string | null {
	if (!header) return null;
	let fallback: string | null = null;
	let extended: string | null = null;
	const parameters =
		/(?:^|;)\s*(filename\*?)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))/gi;
	for (const match of header.matchAll(parameters)) {
		const value =
			match[2] !== undefined
				? match[2].replace(/\\(.)/g, "$1")
				: match[3].trim();
		if (match[1].toLowerCase() === "filename") fallback ??= value;
		else {
			const encoded = /^utf-8'[^']*'(.*)$/i.exec(value);
			if (encoded) {
				try {
					extended ??= decodeURIComponent(encoded[1]);
				} catch {
					/* Use filename when filename* is malformed. */
				}
			}
		}
	}
	return extended || fallback;
}

export function downloadFilename(
	filename: string | null,
	address: string
): string {
	if (!filename) {
		const url = new URL(address);
		filename = url.pathname.split("/").at(-1) || url.hostname || "download";
		try {
			filename = decodeURIComponent(filename);
		} catch {
			/* Preserve malformed escape sequences literally. */
		}
	}
	// RFC 6266 §4.3: discard path components and filesystem control characters.
	filename = filename
		.split(/[/\\]/)
		.at(-1)!
		// eslint-disable-next-line no-control-regex -- RFC 6266 excludes filesystem control characters.
		.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_")
		.trim()
		.replace(/[. ]+$/, "");
	if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename))
		filename = `_${filename}`;
	return !filename || filename === "~" ? "download" : filename;
}

export function isAttachment(header: string | null): boolean {
	const disposition = header?.split(";", 1)[0].trim().toLowerCase();
	return !!disposition && disposition !== "inline";
}
