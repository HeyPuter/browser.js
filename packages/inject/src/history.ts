import { rpc } from ".";
import { client } from "./scramjet";

export function setupHistoryEmulation() {
	client.Proxy("History.prototype.pushState", {
		apply(ctx) {
			rpc.call("history_pushState", {
				state: ctx.args[0],
				title: ctx.args[1],
				url: new URL(ctx.args[2], client.url).href,
			});

			ctx.return(undefined);
		},
	});

	client.Proxy("History.prototype.replaceState", {
		apply(ctx) {
			rpc.call("history_replaceState", {
				state: ctx.args[0],
				title: ctx.args[1],
				url: new URL(ctx.args[2], client.url).href,
			});

			ctx.return(undefined);
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
