/// <reference types="@rspack/core/module" />
import { Protocol } from "devtools-protocol";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";

import { ScramjetClient } from "@mercuryworkshop/scramjet/bundled";
import { ExecutionContextWrapper } from "../context";
// we are the managerlings please feed us
import { ObjectManager } from "./objectmanager";
import { NodeManager } from "./nodemanager";
import { StyleManager } from "./stylemanager";
// it's safe to alias box like this, there's only one ever
export let box: InstanceType<typeof ScramjetClient>["box"] = null!;

export function setupCDPServer({ self, rpc, client }: ExecutionContextWrapper) {
	box = client.box;
}

type CDPDomain = "Runtime" | "DOM" | "CSS" | "Page";

export class CDPSession {
	private enabledDomains: Set<CDPDomain> = new Set();
	objects = new ObjectManager(this);
	nodes = new NodeManager();
	styles = new StyleManager(this);
	constructor(public context: ExecutionContextWrapper) {}
	async request(method: string, params: any): Promise<any> {
		if (method in cdpBindings) {
			const binding = cdpBindings[method as CdpCommand] as CdpBinding<any>;
			return await binding.call(this, params);
		} else {
			console.warn(`ignoring ${method}`);
		}
	}

	enableDomain(domain: CDPDomain) {
		this.enabledDomains.add(domain);
	}

	disableDomain(domain: CDPDomain) {
		this.enabledDomains.delete(domain);
	}

	isDomainEnabled(domain: CDPDomain): boolean {
		return this.enabledDomains.has(domain);
	}

	emit<T extends CdpEvent>(method: T, params: CdpEventArgs<T>) {
		void this.context.rpc.call("cdpevent", { method, params });
	}
}

export type CdpCommand = keyof ProtocolMapping.Commands;
export type CdpCommandArgs<T extends CdpCommand> =
	ProtocolMapping.Commands[T]["paramsType"] extends []
		? undefined
		: ProtocolMapping.Commands[T]["paramsType"][number];
export type CdpCommandReturn<T extends CdpCommand> =
	ProtocolMapping.Commands[T]["returnType"];

export type CdpEvent = keyof ProtocolMapping.Events;
export type CdpEventArgs<T extends CdpEvent> =
	ProtocolMapping.Events[T] extends []
		? undefined
		: ProtocolMapping.Events[T][number];

type MaybePromise<T> = T | Promise<T>;
type CdpBinding<T extends CdpCommand> = (
	this: CDPSession,
	args: CdpCommandArgs<T>
) => MaybePromise<CdpCommandReturn<T>>;

const cdpBindings: Partial<{
	[T in CdpCommand]: CdpBinding<T>;
}> = {};

export function bindCDP<T extends CdpCommand>(
	method: T,
	binding: CdpBinding<T>
): void {
	(cdpBindings as Record<CdpCommand, unknown>)[method] = binding;
}

const domains = import.meta.webpackContext("./domains", {
	recursive: true,
	regExp: /\.ts$/,
});
for (const key of domains.keys()) domains(key);
