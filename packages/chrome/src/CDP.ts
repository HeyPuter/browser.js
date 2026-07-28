import type Protocol from "devtools-protocol";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";
import type { Tab } from "./Tab/Tab";
import { contexts, ProxyFrameContext } from "./proxy/scramjet";
import type { TabSession } from "./Tab/TabSession";
import { uuid } from "./util";

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

class CDPSession {
	constructor(
		public target: TabSession,
		public id: string
	) {}
}

export class CDPServer {
	connections: CDPConnection[] = [];
	constructor() {}
	newConnection(cb: (message: string) => void, bound?: TabSession) {
		const connection = new CDPConnection(cb, bound);
		this.connections.push(connection);
		return connection;
	}

	newTarget(target: TabSession) {
		for (const connection of this.connections) {
			connection.newTarget(target);
		}
	}
}

export class CDPConnection {
	boundSession: CDPSession | null = null;
	sessions: Map<string, CDPSession> = new Map();

	discoverTargets: boolean = false;
	autoAttach: boolean = false;
	constructor(
		public cb: (message: string) => void,
		bound?: TabSession
	) {
		if (bound) {
			this.boundSession = this.createSession(bound);
		}

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

	newTarget(target: TabSession) {
		let attached = false;
		const createTargetInfo = () =>
			({
				targetId: target.id,
				type: "page",
				title: target.tab.title ?? "",
				url: target.tab.url.href,
				attached,
				// TODO
				canAccessOpener: true,
				openerId: undefined,
			}) as Protocol.Target.TargetInfo;

		if (this.autoAttach) {
			const session = this.createSession(target);
			attached = true;
			this.triggerEvent("Target.attachedToTarget", {
				sessionId: session.id,
				targetInfo: createTargetInfo(),
				waitingForDebugger: false,
			});
		}

		if (this.discoverTargets) {
			this.triggerEvent("Target.targetCreated", {
				targetInfo: createTargetInfo(),
			});
		}
	}

	// newExecutionContext(target: TabSession, context: ProxyFrameContext) {
	// 	for (const session of this.sessions.values()) {
	// 		if (session.target !== target) continue;
	// 		if (!session.autoAttach || !session.discoverTargets) continue;

	// 		this.triggerEvent("Runtime.executionContextCreated", {
	// 			context: {
	// 				id: context.cdpId,
	// 				// TODO: wrong for subframes
	// 				origin: context.tab!.url.origin!,
	// 				name: context.tab!.url.hostname!,
	// 				uniqueId: context.id,
	// 			},
	// 		});
	// 	}
	// }

	createSession(target: TabSession) {
		const sessionId = uuid("cdpsession-");
		const session = new CDPSession(target, sessionId);
		this.sessions.set(sessionId, session);
		return session;
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

		const session = sessionId
			? this.sessions.get(sessionId)
			: this.boundSession;
		if (session) {
			session.target.rootcontext?.rpc
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
