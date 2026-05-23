import { basePrefix, isIsolated } from ".";
import type {
	Controllerbound,
	SWbound,
	TransferResponse,
} from "../../../scramjet/packages/controller/src/types";
import { RpcHelper, type MethodsDefinition } from "@mercuryworkshop/rpc";
import * as tldts from "tldts";
import { createFetchHandler, handlefetch, renderErrorPage } from "./scramjet";
import {
	ScramjetHeaders,
	type ScramjetFetchHandler,
	type ScramjetFetchRequest,
} from "@mercuryworkshop/scramjet/bundled";
import { HttpCachePlugin } from "./cache";

export function makeId(): string {
	return Math.random().toString(36).substring(2, 10);
}

export const controllers: Controller[] = [];

export const httpCache = new HttpCachePlugin();

export class Controller {
	private rpc: RpcHelper<Controllerbound, SWbound>;
	private ready: Promise<void>;
	private readyResolve!: () => void;

	private port: MessagePort | null = null;
	private onTabChannelMessage: (e: MessageEvent) => void = (e) => {
		this.rpc.recieve(e.data);
	};

	/**
	 * The SW sends `$controller$swrevive` whenever it activates, even on the very
	 * first init when the message port is already healthy. We use this flag to
	 * ignore the first revive after construction so we don't tear down the
	 * working channel for no reason.
	 */
	guardServiceWorkerRevive = true;

	private methods: MethodsDefinition<Controllerbound> = {
		ready: async () => {
			this.readyResolve();
			setTimeout(() => {
				this.guardServiceWorkerRevive = false;
			}, 5000);
		},
		request: async (data) => {
			try {
				const headers = ScramjetHeaders.fromRawHeaders(data.initialHeaders);
				const request: ScramjetFetchRequest = {
					rawUrl: new URL(data.rawUrl),
					rawClientUrl: data.rawClientUrl
						? new URL(data.rawClientUrl)
						: undefined,
					rawReferrer: data.rawReferrer,
					method: data.method,
					initialHeaders: headers,
					body: data.body,
					mode: data.mode,
					cache: data.cache,
					referrer: data.referrer,
					rawDestination: data.destination,
					clientId: data.clientId ?? "",
				};

				const fetchresp = await handlefetch(request, this);

				const response: TransferResponse = {
					status: fetchresp.status,
					statusText: fetchresp.statusText,
					headers: fetchresp.headers.toRawHeaders(),
					body: fetchresp.body,
				};

				let transfer: Transferable[] = [];
				if (
					response.body instanceof ArrayBuffer ||
					response.body instanceof ReadableStream
				) {
					transfer = [response.body];
				}
				return [response, transfer];
			} catch (e: any) {
				console.error("Error in controller fetch:", e);
				return [
					{
						status: 500,
						statusText: "Internal Server Error",
						headers: [["Content-Type", "text/html"]],
						body: renderErrorPage(this, e),
					},
					[],
				];
			}
		},
		// TODO
		initRemoteTransport: async () => {},
	};

	fetchHandler: ScramjetFetchHandler;

	/**
	 * In non-isolated mode this is the chrome-origin ServiceWorker. In isolated
	 * mode it's the sandbox iframe's window, which forwards `$controller$init`
	 * to its own (cross-origin) SW. Use `isIsolated` to disambiguate.
	 */
	initTarget: ServiceWorker | Window;

	constructor(
		public prefix: URL,
		public id: string,
		initTarget: ServiceWorker | Window,
		public rootdomain?: string
	) {
		this.initTarget = initTarget;
		this.ready = new Promise<void>((res) => {
			this.readyResolve = res;
		});
		this.rpc = new RpcHelper<Controllerbound, SWbound>(
			this.methods,
			"tabchannel-" + id,
			(data, transfer) => {
				if (!this.port) {
					throw new Error("Port not found");
				}
				this.port.postMessage(data, transfer);
			}
		);

		this.fetchHandler = createFetchHandler(this);
		httpCache.install(this);

		this.setupMessagePort();
		this.installSwReviveListener();
	}

	private setupMessagePort() {
		if (this.port) {
			this.port.removeEventListener("message", this.onTabChannelMessage);
			try {
				this.port.close();
			} catch {
				// ignore
			}
			this.port = null;
		}

		const channel = new MessageChannel();
		this.port = channel.port1;
		this.port.addEventListener("message", this.onTabChannelMessage);
		this.port.start();

		const initMsg = {
			$controller$init: {
				prefix: this.prefix.pathname,
				id: this.id,
			},
		};

		if (isIsolated) {
			(this.initTarget as Window).postMessage(initMsg, "*", [channel.port2]);
		} else {
			(this.initTarget as ServiceWorker).postMessage(initMsg, [channel.port2]);
		}
	}

	private installSwReviveListener() {
		// sw will kill itself randomly, if it restarts we get sent this message, rebuild the message ports
		if (isIsolated) {
			const sandboxWindow = this.initTarget as Window;
			window.addEventListener("message", (e) => {
				if (e.source !== sandboxWindow) return;
				if (e.data?.$controller$swrevive) {
					if (this.guardServiceWorkerRevive) {
						return;
					}
					console.log(
						"controller: detected sandbox SW revive, re-establishing port"
					);
					this.setupMessagePort();
				}
			});
		} else {
			navigator.serviceWorker.addEventListener("message", (e) => {
				if (e.data?.$controller$swrevive) {
					if (this.guardServiceWorkerRevive) {
						return;
					}
					console.log("controller: detected SW revive, re-establishing port");
					this.setupMessagePort();
				}
			});
		}
	}

	wait(): Promise<void> {
		return this.ready;
	}
}

function getRootDomain(url: URL): string {
	return tldts.getDomain(url.href) || url.hostname;
}

function hashDomain(domain: string): string {
	// dbj2
	// TODO investigate possibility of collisions at some point
	let hash = 0;
	for (let i = 0; i < domain.length; i++) {
		const char = domain.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return Math.abs(hash).toString(36).substring(0, 8);
}

let nonIsolatedController: Controller | null;

const ISOLATION_ORIGIN = import.meta.env.VITE_ISOLATION_ORIGIN;

let controllerWaitPromises: Map<Window, (v: unknown) => void> = new Map();
addEventListener("message", (e) => {
	if (typeof e.data !== "object" || e.data === null) return;
	if (e.data.$sandboxsw$type === "ready") {
		const resolve = controllerWaitPromises.get(e.source as Window);
		if (resolve) {
			controllerWaitPromises.delete(e.source as Window);
			resolve(null);
		} else {
			console.error("???");
		}
	}
});

let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;

async function registerLocalControllerSW(): Promise<ServiceWorkerRegistration> {
	if (swRegistrationPromise) {
		return swRegistrationPromise;
	}

	swRegistrationPromise = (async () => {
		const registration = await navigator.serviceWorker.register(
			"/localcontrollersw.js",
			{
				scope: basePrefix,
			}
		);

		if (registration.active) {
			return registration;
		}

		const sw = registration.installing || registration.waiting;
		if (sw) {
			await new Promise<void>((resolve) => {
				sw.addEventListener("statechange", () => {
					if (sw.state === "activated") {
						resolve();
					}
				});
			});
		}

		return registration;
	})();

	return swRegistrationPromise;
}

export async function controllerForURL(url: URL): Promise<Controller> {
	let controller;
	if (isIsolated) {
		let existing = controllers.find((c) => {
			return c.rootdomain === getRootDomain(url);
		});
		if (existing) return existing;

		let originurl = new URL(ISOLATION_ORIGIN);
		let baseurl = new URL(
			`${originurl.protocol}//${hashDomain(getRootDomain(url))}.${originurl.host}`
		);
		let frame = document.createElement("iframe");
		const rootdomain = getRootDomain(url);
		frame.src = baseurl.href + "controller.html";
		frame.style.display = "none";
		document.body.appendChild(frame);
		console.log("waiting for activation for " + rootdomain + " controller");

		let controllerWaitResolve!: (v: unknown) => void;
		let controllerWaitPromise = new Promise((res) => {
			controllerWaitResolve = res;
		});

		controllerWaitPromises.set(frame.contentWindow!, controllerWaitResolve);
		await controllerWaitPromise;
		console.log("controller for " + rootdomain + " ready");

		const controllerId = makeId();
		let prefix = new URL(baseurl.origin + basePrefix + controllerId + "/");

		controller = new Controller(
			prefix,
			controllerId,
			frame.contentWindow!,
			rootdomain
		);
		controllers.push(controller);
	} else {
		if (nonIsolatedController) {
			return nonIsolatedController;
		}

		const registration = await registerLocalControllerSW();

		let controllerId = makeId();
		let prefix = new URL(location.origin + basePrefix + controllerId + "/");
		controller = new Controller(prefix, controllerId, registration.active!);

		nonIsolatedController = controller;
	}

	await controller.wait();
	return controller;
}
