import { ScramjetInterface } from "@mercuryworkshop/scramjet";
import type { ThemeDefinition } from "../../chrome/src/themes";
export type FrameSequence = number[];

export type Chromebound = {
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
	setCookie: [
		{
			cookie: string;
			url: string;
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
};
