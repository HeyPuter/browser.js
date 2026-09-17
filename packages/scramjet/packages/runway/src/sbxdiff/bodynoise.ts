/**
 * Grading a request body against the oracle's own reproducibility.
 *
 * Every other comparison in this tool is scored against a noise floor
 * (RULES.md #127): a bucket key carries no magnitude, so the floor records how
 * far the oracle disagreed with ITSELF and a run has to stay inside it. The
 * request bodies were the one comparison with no floor at all -- they demanded
 * byte equality.
 *
 * They cannot have it. Two ORACLE runs of the rateyourmusic recipe, unmodified
 * browser against unmodified browser on the same store, still post different
 * bytes:
 *
 *     87746 vs 87767   (+21)
 *     90903 vs 90914   (+11)
 *      8716 vs  8727   (+11)
 *
 * Cloudflare's payload carries an array of pointer-interaction samples -- one
 * entry per mouse event, each with a `performance.now()` time -- so its LENGTH
 * follows how many events arrived in real time. No two runs agree.
 *
 * So the question a body can actually answer is not "are these identical" but
 * "is this run inside the spread the oracle showed itself". The sandbox's
 * excess is 1205 bytes against that spread of 21, which is the finding; demanding
 * 0 would have reported the same failure for a second oracle.
 */

/** The byte length recorded in an FNV-1a body hash, `<length>:<base36>`. */
export function bodyLength(hash: string | undefined): number | undefined {
	if (!hash) return undefined;
	const colon = hash.indexOf(":");
	if (colon <= 0) return undefined;
	const n = Number(hash.slice(0, colon));

	return Number.isFinite(n) ? n : undefined;
}

/** How far apart two bodies are in bytes, or undefined if either is missing. */
export function bodySpread(
	oracle: string | undefined,
	sandbox: string | undefined
): number | undefined {
	const o = bodyLength(oracle);
	const s = bodyLength(sandbox);
	if (o === undefined || s === undefined) return undefined;

	return Math.abs(o - s);
}

/**
 * Is this body divergence inside the oracle's own spread?
 *
 * Scaled with an absolute floor, the same shape as `withinNoiseSpread`: one
 * self-check samples the noise rather than bounding it, and a recorded spread
 * of 0 must not reject the next run over a single byte.
 *
 * A body the other side never sent is never noise -- that is a request one run
 * made and the other did not, which is the strongest thing this tool measures.
 */
export function withinBodyNoise(
	oracle: string | undefined,
	sandbox: string | undefined,
	recorded: number | undefined
): boolean {
	if (oracle === undefined || sandbox === undefined) return false;
	if (oracle === sandbox) return true;
	if (recorded === undefined) return false;
	const spread = bodySpread(oracle, sandbox);
	if (spread === undefined) return false;

	return spread <= Math.max(recorded * 4, 8);
}
