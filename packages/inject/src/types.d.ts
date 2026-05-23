import {
	ScramjetInterface,
	TrackedHistoryState,
} from "@mercuryworkshop/scramjet/bundled";
import type { RawHeaders } from "@mercuryworkshop/proxy-transports";
import type { ThemeDefinition } from "../../chrome/src/themes";
export type FrameSequence = number[];

export type Chromebound = {
	wsconnect: [
		{
			url: string;
			protocols: string[];
			requestHeaders: RawHeaders;
			port: MessagePort;
		},
		(
			| {
					result: "success";
					protocol: string;
					extensions: string;
			  }
			| {
					result: "failure";
					error: string;
			  }
		),
	];
	contextmenu: [
		{
			x: number;
			y: number;
			selection?: string;
			image?: {
				src: string;
				width: number;
				height: number;
			};
			anchor?: {
				href: string;
			};
			video?: {
				src: string;
				width: number;
				height: number;
			};
		},
	];
	titlechange: [
		{
			title?: string;
			icon?: string;
		},
	];
	load: [
		{
			url: string;
			sequence: FrameSequence;
		},
	];
	registerFrameContext: [{ id: string }];
	newtab: [
		{
			url: string;
		},
		{
			sequence: FrameSequence;
		},
	];
	history_pushState: [
		{
			state: any;
			title: string;
			url: string;
		},
	];
	history_replaceState: [
		{
			state: any;
			title: string;
			url: string;
		},
	];
	history_go: [{ delta: number }];
	/**
	 * Inject → chrome: a write to `document.cookie` (or equivalent) just landed
	 * in this frame. Chrome updates its shared cookieJar and fans the batch out
	 * to every other live frame context so their local jars stay in sync.
	 */
	setCookies: [
		{
			cookies: { cookie: string; url: string }[];
		},
	];
};

export type Framebound = {
	navigate: [
		{
			url: string;
		},
	];
	popstate: [
		{
			state: any;
			url: string;
			title: string;
		},
	];
	fetchBlob: [
		string,
		{
			body: ArrayBuffer;
			contentType: string;
		},
	];
	setCookies: [
		{
			cookies: { cookie: string; url: string }[];
		},
	];
	updateTheme: [ThemeDefinition];
};

export type InjectScramjetInit = {
	sequence: FrameSequence;
	id: string;
	config: any;
	cookies: string;
	getInjectScripts: ScramjetInterface["getInjectScripts"];
	wisp: string;
	prefix: string;
	codecEncode: ScramjetInterface["codecEncode"];
	codecDecode: ScramjetInterface["codecDecode"];
	initHeaders: RawHeaders;
	history: TrackedHistoryState[];
};
