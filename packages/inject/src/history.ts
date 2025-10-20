import { sendChrome } from "./ipc";
import { client } from "./scramjet";

export function setupHistoryEmulation() {
	client.Proxy("History.prototype.pushState", {
		apply(ctx) {
			sendChrome("history_pushState", {
				state: ctx.args[0],
				title: ctx.args[1],
				url: new URL(ctx.args[2], client.url).href,
			});

			ctx.return(undefined);
		},
	});

	client.Proxy("History.prototype.replaceState", {
		apply(ctx) {
			sendChrome("history_replaceState", {
				state: ctx.args[0],
				title: ctx.args[1],
				url: new URL(ctx.args[2], client.url).href,
			});

			ctx.return(undefined);
		},
	});
	client.Proxy("History.prototype.back", {
		apply(ctx) {
			sendChrome("history_go", { delta: -1 });

			ctx.return(undefined);
		},
	});
	client.Proxy("History.prototype.forward", {
		apply(ctx) {
			sendChrome("history_go", { delta: 1 });

			ctx.return(undefined);
		},
	});
	client.Proxy("History.prototype.go", {
		apply(ctx) {
			sendChrome("history_go", { delta: ctx.args[0] });

			ctx.return(undefined);
		},
	});
}
