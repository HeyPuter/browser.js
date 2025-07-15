import {
	rewriteUrl,
	unrewriteUrl,
	rewriteBlob,
	unrewriteBlob,
} from "./rewriters/url";
import { rewriteCss, unrewriteCss } from "./rewriters/css";
import { rewriteHtml, rewriteSrcset } from "./rewriters/html";
import { rewriteJs } from "./rewriters/js";
import { rewriteHeaders } from "./rewriters/headers";
import { rewriteWorkers } from "./rewriters/worker";
import { BareClient, BareMuxConnection } from "@mercuryworkshop/bare-mux";
import { parseDomain } from "parse-domain";
import { ScramjetHeaders } from "./headers";
import { CookieStore } from "./cookie";
import { htmlRules, unrewriteHtml } from "./rewriters/html";
import { config } from "../shared";
import { ScramjetFlags } from "../types";

export let codecEncode: (input: string) => string;
export let codecDecode: (input: string) => string;

const nativeFunction = Function;
export function loadCodecs() {
	codecEncode = nativeFunction(`return ${config.codec.encode}`)() as any;
	codecDecode = nativeFunction(`return ${config.codec.decode}`)() as any;
}

export function flagEnabled(flag: keyof ScramjetFlags, url: URL): boolean {
	const value = config.flags[flag];
	for (const regex in config.siteFlags) {
		const partialflags = config.siteFlags[regex];
		if (new RegExp(regex).test(url.href) && flag in partialflags) {
			return partialflags[flag];
		}
	}

	return value;
}
