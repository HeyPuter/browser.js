/**
 * What happened in a live run, read out of the harness log.
 *
 *   node --experimental-strip-types --no-warnings src/sbxdiff/livelog.ts \
 *       src/sbxdiff/.traces/serve-sandbox.log
 *
 * `rym.sh live` runs it automatically at the end of a run.
 *
 * A live run has no tracer and no second side: `serve` launches a browser and
 * Chromium's stderr is the only channel out. So everything a live run can tell
 * you is in one file, and reading it has been a matter of writing a fresh
 * `grep` at the call site each time.
 *
 * That went wrong in the way that kind of thing goes wrong (FINDINGS #254). A
 * run looped five times and ended in `VERDICT FAIL`; the greps I had written
 * into the launch command -- `cf-chl-out`, `cf_clearance`, `403`, `Rate Your
 * Music` -- printed an empty verdict section, and I reported that no verdict
 * had been reached and the grace had cut it off. The log had said
 * `sbxdiff-verdict: VERDICT FAIL` eight times. The person watching the window
 * had to say "the live run looped, it should be showing rejected".
 *
 * `sbxdiff-verdict.js` exists precisely so the answer comes from the widget's
 * own moment of decision instead of a proxy signal (#143), and an ad-hoc grep
 * at the call site throws that away and substitutes worse proxy signals. So the
 * reader lives here, next to the probe whose vocabulary it knows, and a live
 * run reports itself.
 *
 * Exits 1 unless the run reached `VERDICT PASS`, so `rym.sh live` is an
 * acceptance test rather than something to read by eye.
 */

import { readFileSync } from "node:fs";

/** One Chromium log record: the prefix, and everything until the next one. */
type Record_ = { at: string; body: string };

const PREFIX = /\[\d+:\d+:\d{4}\/(\d{6})\.\d+:[A-Z]+:[^\]]*\]/g;

function records(log: string): Record_[] {
	const out: Record_[] = [];
	const starts: { at: string; from: number; to: number }[] = [];
	for (const m of log.matchAll(PREFIX)) {
		starts.push({ at: m[1], from: m.index, to: m.index + m[0].length });
	}
	for (let i = 0; i < starts.length; i++) {
		const end = i + 1 < starts.length ? starts[i + 1].from : log.length;
		out.push({ at: starts[i].at, body: log.slice(starts[i].to, end).trim() });
	}

	return out;
}

const clock = (at: string) =>
	`${at.slice(0, 2)}:${at.slice(2, 4)}:${at.slice(4, 6)}`;

/** `HHMMSS` as seconds, so a gap across a minute boundary is not negative. */
const seconds = (at: string) =>
	Number(at.slice(0, 2)) * 3600 +
	Number(at.slice(2, 4)) * 60 +
	Number(at.slice(4, 6));

/** The page's own console text, which may run over several lines. */
function consoleText(body: string): string | null {
	const m = /^"([\s\S]*)",\s+source:/.exec(body);

	return m ? m[1] : null;
}

export type Request = {
	at: string;
	/** HTTP status, or `FAILED` when the transport never got one. */
	status: string;
	method: string;
	url: string;
};

export type Live = {
	requests: Request[];
	verdicts: { at: string; text: string }[];
	/** Console output the oracle does not have: scramjet complaining. */
	shimErrors: Map<string, number>;
	clearances: string[];
};

export function readLive(log: string): Live {
	const out: Live = {
		requests: [],
		verdicts: [],
		shimErrors: new Map(),
		clearances: [],
	};
	for (const r of records(log)) {
		const text = consoleText(r.body);
		if (text === null) continue;
		const req = /^sbxdiff-live: (\d{3}|FAILED) (\w+) (.+?)(?::\s|$)/.exec(text);
		if (req) {
			out.requests.push({
				at: r.at,
				status: req[1],
				method: req[2],
				url: req[3].trim(),
			});
			continue;
		}
		if (text.startsWith("sbxdiff-live: CF_CLEARANCE")) {
			out.clearances.push(text.slice("sbxdiff-live: ".length));
			continue;
		}
		if (text.startsWith("sbxdiff-verdict: ")) {
			out.verdicts.push({
				at: r.at,
				text: text.slice("sbxdiff-verdict: ".length),
			});
			continue;
		}
		// scramjet's own console output. The oracle has none of it, so every one
		// of these is a divergence on its own -- and two of them
		// (`DIRECT IFRAMES WILL NOT WORK`, `already intercepted`) are scramjet
		// saying it could not do its job.
		const shim =
			/(YOU NEED TO USE|already intercepted|module\.default is not a function|Service Worker error|Error in controller request handler)[^\n]*/.exec(
				text
			);
		if (shim) {
			const k = shim[0].slice(0, 90);
			out.shimErrors.set(k, (out.shimErrors.get(k) ?? 0) + 1);
		}
	}

	return out;
}

/**
 * Round boundaries: each fresh load of the target's own page.
 *
 * The interstitial reloads itself when the challenge does not complete, so a
 * looping run is a sequence of near-identical rounds and the interesting thing
 * is their shape and their spacing. Detected on a request for the bare host,
 * which is the navigation, rather than on anything the challenge does.
 */
export function rounds(reqs: Request[], host: string): Request[][] {
	const out: Request[][] = [];
	for (const r of reqs) {
		const isNav =
			r.method === "GET" && (r.url === host || r.url === `${host}/`);
		// A navigation only opens a round if the previous one got past its own
		// navigation. A load that redirects, or that the browser retries,
		// produces two of these back to back and they are one round, not two --
		// otherwise the report invents an empty round and a 0s gap.
		const openIsBare = out.length > 0 && out[out.length - 1].length <= 1;
		if ((isNav && !openIsBare) || !out.length) out.push([]);
		out[out.length - 1].push(r);
	}

	return out;
}

/** The host the run was pointed at: the one whose bare page was fetched. */
function targetHost(reqs: Request[]): string {
	for (const r of reqs) {
		const m = /^([^/]+)\/$/.exec(r.url);
		if (m) return m[1];
	}

	return reqs[0]?.url.split("/")[0] ?? "";
}

/** `challenges.cloudflare.com/.../fo/...` -> `challenges.cloudflare.com/fo` */
function shortUrl(u: string): string {
	const m = /^([^/]+)\/.*\/(fo|jsd|pat|ci|i|cv|orchestrate)\//.exec(u);
	if (m) return `${m[1]}/${m[2]}`;

	return u.length <= 64 ? u : `${u.slice(0, 64)}...`;
}

export function format(live: Live): { lines: string[]; passed: boolean } {
	const lines: string[] = [];
	const passed = live.verdicts.some((v) => v.text.startsWith("VERDICT PASS"));
	const failed = live.verdicts.filter((v) => v.text.startsWith("VERDICT FAIL"));

	lines.push("");
	if (passed) {
		lines.push("  VERDICT PASS");
	} else if (failed.length) {
		lines.push(
			`  VERDICT FAIL x${failed.length} -- ${failed[0].text.slice(0, 100)}`
		);
	} else if (live.verdicts.length) {
		lines.push(
			"  no verdict: the widget never flipped its pass or fail div." +
				" It got as far as:"
		);
		lines.push(`      ${live.verdicts[live.verdicts.length - 1].text}`);
	} else {
		lines.push(
			"  no verdict probe output at all -- was SBXDIFF_PROBE set?" +
				" `rym.sh live` sets it; `serve` on its own does not."
		);
	}

	const host = targetHost(live.requests);
	const rs = rounds(live.requests, host);
	if (rs.length > 1) {
		const at = rs.map((r) => r[0]?.at).filter(Boolean) as string[];
		const gaps: number[] = [];
		for (let i = 1; i < at.length; i++) {
			gaps.push(seconds(at[i]) - seconds(at[i - 1]));
		}
		lines.push(
			`  ${rs.length} round(s) -- the page reloaded, so the challenge did` +
				` not complete. Started ${at.map(clock).join(", ")}`
		);
		if (gaps.length) {
			lines.push(`      gaps: ${gaps.map((g) => `${g}s`).join(", ")}`);
		}
	}

	// One round in full. They are near-identical when a run loops, and the
	// shape is what says where it stops.
	const sample = rs[rs.length - 1];
	if (sample?.length) {
		lines.push(`  last round, in full:`);
		for (const r of sample) {
			lines.push(
				`      ${clock(r.at)}  ${r.status.padStart(6)} ${r.method.padEnd(4)} ${shortUrl(r.url)}`
			);
		}
	}

	const failures = live.requests.filter((r) => r.status === "FAILED");
	if (failures.length) {
		const by = new Map<string, number>();
		for (const f of failures) {
			const h = f.url.split("/")[0];
			by.set(h, (by.get(h) ?? 0) + 1);
		}
		lines.push(`  ${failures.length} request(s) the transport could not make:`);
		for (const [h, n] of by) lines.push(`      ${n}x  ${h}`);
	}

	lines.push(
		live.clearances.length
			? `  clearance issued: ${live.clearances.length}x`
			: `  no clearance was ever issued`
	);

	if (live.shimErrors.size) {
		lines.push(`  scramjet console output (the oracle has none):`);
		for (const [k, n] of [...live.shimErrors].sort((a, b) => b[1] - a[1])) {
			lines.push(`      ${String(n).padStart(4)}x  ${k}`);
		}
	}

	return { lines, passed };
}

if (import.meta.filename === process.argv[1]) {
	const file = process.argv[2];
	if (!file) {
		console.error("usage: livelog.ts <serve-*.log>");
		process.exit(2);
	}
	const { lines, passed } = format(readLive(readFileSync(file, "utf8")));
	for (const l of lines) console.log(l);
	process.exit(passed ? 0 : 1);
}
