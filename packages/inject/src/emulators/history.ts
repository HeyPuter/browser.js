import { ExecutionContextWrapper } from "../context";

export function setupHistoryEmulation({
	client,
	rpc,
}: ExecutionContextWrapper) {
	client.Proxy("History.prototype.pushState", {
		apply(ctx) {
			const relevantclient = client.box.histories.get(ctx.this)!;

			// TODO: should probably not send the pushstate if relevantclient ends up being not top level
			rpc.call("history_pushState", {
				state: ctx.args[0],
				title: ctx.args[1],
				url: new URL(ctx.args[2], relevantclient.url).href,
			});
		},
	});

	client.Proxy("History.prototype.replaceState", {
		apply(ctx) {
			const relevantclient = client.box.histories.get(ctx.this)!;
			rpc.call("history_replaceState", {
				state: ctx.args[0],
				title: ctx.args[1],
				url: new URL(ctx.args[2], relevantclient.url).href,
			});
		},
	});
	client.Proxy("History.prototype.back", {
		apply(ctx) {
			rpc.call("history_go", { delta: -1 });

			ctx.return(undefined);
		},
	});
	client.Proxy("History.prototype.forward", {
		apply(ctx) {
			rpc.call("history_go", { delta: 1 });

			ctx.return(undefined);
		},
	});
	client.Proxy("History.prototype.go", {
		apply(ctx) {
			rpc.call("history_go", { delta: ctx.args[0] });

			ctx.return(undefined);
		},
	});
}
