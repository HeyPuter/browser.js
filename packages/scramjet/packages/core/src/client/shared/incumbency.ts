import { ScramjetClient } from "@client/index";
import { Object_defineProperty, _URL } from "@/shared/snapshot";
import { CallSite, incumbencyMode, rawCallSites } from "@/shared/incumbency";
import { isOwnScript } from "@client/nativeerror";
import { QP } from "@/fetch/parse";

/**
 * What one rewritten script has to be made to look like, and how a frame is
 * traced back to it.
 */
export type ScriptRealm = {
	/**
	 * The realm the script was evaluated in, and the whole point of the
	 * exercise - `SingletonBox` is shared across the client tree, so a record
	 * in it says nothing about which realm without the client that put it there.
	 *
	 * Sound because `registerrealmfn` is installed per realm, on each realm's
	 * own global: a script resolving that identifier necessarily reaches its
	 * own realm's copy, so the client this closure captured is the script's.
	 */
	client: ScramjetClient;
	/** the scramtag the rewriter stamped into this script's functions */
	tag: string;
	/**
	 * The `//# sourceURL` the original source carried, verbatim and unresolved
	 * - V8 does not resolve a relative one, so neither may we. Only `nonce`
	 * mode needs it: it overwrites the sourceURL and has to hand this back in
	 * its place. Null when the source had none.
	 */
	pageSourceUrl: string | null;
};

/**
 * Only the modes that actually register anything. `stamp` and `lazystamp` are
 * inert for now, and a global nothing calls is a surface for nothing - widen
 * this when they land.
 */
export const enabled = (client: ScramjetClient) => {
	const mode = incumbencyMode(client.context, client.url);

	return mode === "pst" || mode === "nonce";
};

export default function (client: ScramjetClient, self: Self) {
	const mode = incumbencyMode(client.context, client.url);

	// every rewritten script registers itself before it runs
	Object_defineProperty(self, client.config.globals.registerrealmfn, {
		value: (nonce: string, tag: string, pageSourceUrl: string | null) => {
			const realm: ScriptRealm = { client, tag, pageSourceUrl };
			client.box.scriptrealms[nonce] = realm;

			if (mode !== "pst") return;

			// this runs at the top of the script being registered, so the first
			// frame that is not scramjet's own is that script. not a fixed
			// index: eval'd code and `new Function` leave the calling script on
			// the stack below it, which is what an index from either end grabs
			const frames = rawCallSites();
			const self = frames && firstPageFrame(client, frames);
			const hash = self && self.getScriptHash?.();

			// its hash is the key a later stack walk looks it up by, and nothing
			// had to be written into the source - or shown to the page - to get
			// it there
			if (hash) client.box.scripthashes[hash] = nonce;
		},
		enumerable: false,
		writable: false,
		configurable: false,
	});
}

/** the topmost frame that is not scramjet's own, i.e. whoever called in */
export function firstPageFrame(
	client: ScramjetClient,
	frames: CallSite[]
): CallSite | null {
	for (let i = 0; i < frames.length; i++) {
		let file: string | undefined;
		try {
			file = frames[i].getFileName?.();
		} catch {
			// a frame that will not name a file is not one of ours
		}

		// eval'd code has no filename at all, so it can never be the client
		// bundle and is always a real caller
		if (!file || !isOwnScript(file, client.config.maskedfiles))
			return frames[i];
	}

	return null;
}

/**
 * The realm a stack frame belongs to, whichever mode put it there. This is the
 * lookup an incumbent-settings-object walk wants: hand it a frame, get back
 * the script and the client it ran in.
 */
export function realmForFrame(
	client: ScramjetClient,
	frame: CallSite
): ScriptRealm | null {
	const byNonce = (nonce: string | null | undefined) =>
		nonce ? (client.box.scriptrealms[nonce] ?? null) : null;

	// `pst`: the script's own hash indexes the registration, and is on every
	// frame including eval'd ones
	try {
		const hash = frame.getScriptHash?.();
		if (hash) {
			const found = byNonce(client.box.scripthashes[hash]);
			if (found) return found;
		}
	} catch {
		// not a V8 CallSite; fall through to the sourceURL
	}

	// `nonce`: the identity is in the sourceURL the rewriter appended
	try {
		const shown = frame.getScriptNameOrSourceURL?.();

		return shown ? byNonce(new _URL(shown).searchParams.get(QP.nonce)) : null;
	} catch {
		// a bare sourceURL that is not a URL at all, or no accessor
		return null;
	}
}
