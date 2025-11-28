import { basePrefix, isIsolated } from ".";
import type {
	Controllerbound,
	SWbound,
	TransferResponse,
} from "../../../scramjet/packages/controller/src/types";
import { RpcHelper, type MethodsDefinition } from "@mercuryworkshop/rpc";
import * as tldts from "tldts";
import {
	createFetchHandler,
	handlefetch,
	renderErrorPage,
	virtualInjectPath,
} from "./scramjet";
import {
	ScramjetHeaders,
	type ScramjetFetchHandler,
	type ScramjetFetchRequest,
} from "@mercuryworkshop/scramjet";

export function makeId(): string {
	return Math.random().toString(36).substring(2, 10);
}

export const controllers: Controller[] = [];

export class Controller {
	private rpc: RpcHelper<Controllerbound, SWbound>;
	private ready: Promise<void>;
	private readyResolve!: () => void;

	private methods: MethodsDefinition<Controllerbound> = {
		ready: async () => {
			this.readyResolve();
		},
		request: async (data) => {
			try {
				let headers = new ScramjetHeaders();
				for (let [k, v] of Object.entries(data.initialHeaders)) {
					if (typeof v !== "string") v = v[0];
					if (v) headers.set(k, v);
				}
				const request: ScramjetFetchRequest = {
					rawUrl: new URL(data.rawUrl),
					rawClientUrl: data.rawClientUrl
						? new URL(data.rawClientUrl)
						: undefined,
					method: data.method,
					initialHeaders: headers,
					body: data.body,
					mode: data.mode,
					cache: data.cache,
					referrer: data.referrer,
					destination: data.destination,
				};

				const fetchresp = await handlefetch(request, this);

				const response: TransferResponse = {
					status: fetchresp.status,
					statusText: fetchresp.statusText,
					headers: fetchresp.headers,
					body: fetchresp.body,
				};

				let transfer: any[] | undefined = [];
				if (
					response.body instanceof ArrayBuffer ||
					response.body instanceof ReadableStream
				) {
					transfer = [response.body];
				}
				return [response, transfer];
			} catch (e: any) {
				return [
					{
						status: 500,
						statusText: "Internal Server Error",
						headers: {
							"Content-Type": "text/html",
						},
						body: renderErrorPage(this, e),
					},
				];
			}
		},
	};

	fetchHandler: ScramjetFetchHandler;

	constructor(
		public prefix: URL,
		id: string,
		channel: MessageChannel,
		public rootdomain?: string
	) {
		this.ready = new Promise<void>((res) => {
			this.readyResolve = res;
		});
		this.rpc = new RpcHelper<Controllerbound, SWbound>(
			this.methods,
			"tabchannel-" + id,
			(data, transfer) => {
				channel.port1.postMessage(data, transfer);
			}
		);
		channel.port1.addEventListener("message", (e) => {
			this.rpc.recieve(e.data);
		});

		this.fetchHandler = createFetchHandler(this);
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

		let channel = new MessageChannel();

		const controllerId = makeId();
		let prefix = new URL(baseurl.origin + basePrefix + controllerId + "/");

		controller = new Controller(prefix, controllerId, channel, rootdomain);
		controllers.push(controller);

		channel.port1.start();
		frame.contentWindow!.postMessage(
			{
				$controller$init: {
					prefix: prefix.pathname,
					id: controllerId,
				},
			},
			"*",
			[channel.port2]
		);
	} else {
		if (nonIsolatedController) {
			return nonIsolatedController;
		}

		const registration = await registerLocalControllerSW();

		let controllerId = makeId();
		let channel = new MessageChannel();
		let prefix = new URL(location.origin + basePrefix + controllerId + "/");
		controller = new Controller(prefix, controllerId, channel);

		channel.port1.start();
		registration.active!.postMessage(
			{
				$controller$init: {
					prefix: prefix.pathname,
					id: controllerId,
				},
			},
			[channel.port2]
		);

		nonIsolatedController = controller;
	}

	await controller.wait();
	return controller;
}
