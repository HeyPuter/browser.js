import { ExecutionContextWrapper } from "../context";

export function setupHistoryEmulation({
	client,
	rpc,
}: ExecutionContextWrapper) {
	// The page's own history goes first. It throws for a URL it refuses - and
	// then the chrome must not hear about it - and it resolves the rest,
	// including the url-less form that keeps the current URL, so the chrome is
	// told where the page actually ended up.
	client.Proxy("History.prototype.pushState", {
		apply(ctx) {
			ctx.call();
			const relevantclient = client.box.histories.get(ctx.this)!;

			// TODO: should probably not send the pushstate if relevantclient ends up being not top level
			rpc.call("history_pushState", {
				state: ctx.args[0],
				title: ctx.args[1],
				url: relevantclient.url.href,
			});
		},
	});

	client.Proxy("History.prototype.replaceState", {
		apply(ctx) {
			ctx.call();
			const relevantclient = client.box.histories.get(ctx.this)!;

			rpc.call("history_replaceState", {
				state: ctx.args[0],
				title: ctx.args[1],
				url: relevantclient.url.href,
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
