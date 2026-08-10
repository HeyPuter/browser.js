/// <reference types="@rspack/core/module" />

declare global {
	interface Window {
		WASM: string;
		REAL_WASM: Uint8Array;

		/**
		 * The scramjet client belonging to a window.
		 */
		[import("./symbols").SCRAMJETCLIENT]: import("./client").ScramjetClient;
	}

	interface Document {
		/**
		 * Should be the same as window.
		 */
		[import("./symbols").SCRAMJETCLIENT]: import("./client").ScramjetClient;
	}
}

/**
 * WebSocketStream. Chrome-only, behind a flag, and absent from lib.dom — it
 * lives in a WHATWG pull request rather than a merged spec, so nothing
 * generated from webref carries it and there is no @types package to pull in.
 * Declared here rather than locally because SingletonBox keys a map by it too.
 *
 * These are hand-written and will drift if the proposal moves. Delete them the
 * day lib.dom ships its own.
 *
 * This file is a script, not a module, so these are already global — putting
 * them inside the `declare global` block above would do nothing.
 *
 * The `var` makes TypeScript believe the global always exists, so anything
 * extending it has to be guarded. Guard with `typeof WebSocketStream !==
 * "undefined"`, NOT `self.WebSocketStream`: `typeof globalThis` carries an
 * index signature, so the property spelling silently types as `any` instead of
 * erroring, and a bare identifier reference throws a ReferenceError where the
 * global is absent.
 *
 * https://whatpr.org/websockets/48.html#websocketstream
 */
interface WebSocketCloseInfo {
	/** no default in the IDL — absent is distinct from 1000, and closes with 1005 */
	closeCode?: number;
	reason?: string;
}
interface WebSocketOpenInfo {
	extensions: string;
	protocol: string;
	readable: ReadableStream;
	writable: WritableStream;
}
interface WebSocketStreamOptions {
	protocols?: string[];
	signal?: AbortSignal;
}
interface WebSocketStream {
	readonly url: string;
	readonly opened: Promise<WebSocketOpenInfo>;
	readonly closed: Promise<WebSocketCloseInfo>;
	close(closeInfo?: WebSocketCloseInfo): void;
}
// `var`, not `let`/`const` — an interface object has to be a `var` to be
// reachable as a global value and through `keyof typeof globalThis`
// eslint-disable-next-line no-var
declare var WebSocketStream: {
	prototype: WebSocketStream;
	new (url: string, options?: WebSocketStreamOptions): WebSocketStream;
};

declare const dbg: {
	log: (message: string, ...args: any[]) => void;
	warn: (message: string, ...args: any[]) => void;
	error: (message: string, ...args: any[]) => void;
	debug: (message: string, ...args: any[]) => void;
	time: (meta: URLMeta, before: number, type: string) => void;
};

// eslint-disable-next-line scramjet-core/no-globals
declare type GlobalThis = typeof globalThis;
declare type Self = Window & GlobalThis;
