import { IncrementalHtmlRewriter, rewriteHtml } from "@rewriters/html";
import { ScramjetClient } from "@client/index";
import { createReferrerString } from "@/fetch/headers";

export default function (client: ScramjetClient, _self: Self) {
	const tostring = String;

	function resetDocumentWriter(document: Document) {
		client.box.writeRewriters.delete(document);
	}

	function getDocumentWriter(document: Document) {
		if (document.readyState !== "loading") {
			resetDocumentWriter(document);
		}

		let writer = client.box.writeRewriters.get(document);
		if (!writer) {
			writer = new IncrementalHtmlRewriter(client.context, client.meta, {
				loadScripts: false,
				inline: true,
				source: client.url.href,
				apisource: "Document.prototype.write",
			});
			client.box.writeRewriters.set(document, writer);
		}

		return writer;
	}

	client.Proxy(
		["Document.prototype.querySelector", "Document.prototype.querySelectorAll"],
		{
			apply(ctx) {
				ctx.args[0] = tostring(ctx.args[0]).replace(
					/((?:^|\s)\b\w+\[(?:src|href|data-href))[\^]?(=['"]?(?:https?[:])?\/\/)/,
					"$1*$2"
				);
			},
		}
	);

	client.Proxy("Document.prototype.write", {
		apply(ctx) {
			const writer = getDocumentWriter(ctx.this);
			ctx.args = [writer.write(ctx.args.join(""))];
		},
	});

	client.Proxy("Document.prototype.open", {
		apply(ctx) {
			resetDocumentWriter(ctx.this);
		},
	});

	client.Trap("Document.prototype.referrer", {
		get() {
			if (!client.history) return "";
			if (client.history.length < 2) return "";
			let lastState = client.history[client.history.length - 2];
			let referrerURL = new URL(lastState.url);
			return createReferrerString(
				referrerURL,
				client.url,
				lastState.refererPolicy
			);
		},
	});

	client.Proxy("Document.prototype.writeln", {
		apply(ctx) {
			const writer = getDocumentWriter(ctx.this);
			ctx.args = [writer.write(ctx.args.join("") + "\n")];
		},
	});

	client.Proxy("Document.prototype.close", {
		apply(ctx) {
			const writer = client.box.writeRewriters.get(ctx.this);
			if (!writer) {
				return;
			}

			try {
				const remaining = writer.end();
				if (remaining) {
					client.natives.call("Document.prototype.write", ctx.this, remaining);
				}
			} finally {
				resetDocumentWriter(ctx.this as Document);
			}
		},
	});

	client.Proxy("Document.prototype.parseHTMLUnsafe", {
		apply(ctx) {
			ctx.args[0] = rewriteHtml(ctx.args[0], client.context, client.meta, {
				loadScripts: false,
				inline: true,
				source: client.url.href,
				apisource: "Document.prototype.parseHTMLUnsafe",
			});
		},
	});
}
