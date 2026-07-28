import type Protocol from "devtools-protocol";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";
import type { Tab } from "./Tab/Tab";
import { contexts } from "./proxy/scramjet";

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
	this: CDPConnection,
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

export class CDPConnection {
	boundTargetId: string | null = null;
	constructor(
		public cb: (message: string) => void,
		targetId: string
	) {
		this.boundTargetId = targetId;
		setTimeout(() => {
			this.triggerEvent("Runtime.executionContextCreated", {
				context: {
					id: 1,
					origin: "https://hawktuah.com",
					name: "hawk tuah",
					uniqueId: "123",
				},
			});
		}, 1000);
	}

	triggerEvent<T extends CdpEvent>(
		event: T,
		...args: CdpEventArgs<T> extends undefined ? [] : [params: CdpEventArgs<T>]
	) {
		this.cb(
			JSON.stringify({
				method: event,
				params: args[0],
			})
		);
	}

	sendMessage(message: string) {
		const { id, method, params, sessionId } = JSON.parse(message);

		const domain = method.split(".")[0];
		if (["Page", "Runtime", "DOM"].includes(domain)) {
			const context = contexts.find((c) => c.id === this.boundTargetId!);

			context?.rpc
				.call("cdprequest", {
					method,
					params,
				})
				.then((result) => {
					this.cb(
						JSON.stringify({
							id,
							result: result.result,
						})
					);
				});
			return;
		}

		const binding = cdpBindings[method];
		if (binding) {
			const result = binding(params);
			this.cb(
				JSON.stringify({
					id,
					result,
				})
			);
		} else {
			console.error("ignoring-", method);
		}
	}
}
