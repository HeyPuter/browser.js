import { ScramjetClient } from "@client/index";
import { Arguments, Constructor, Returns } from "@client/webidl";
import { readWorkerOptions } from "@client/helpers";

export default function (client: ScramjetClient) {
	client.Intercept(class extends Worker {
		@Constructor("USVString", "optional WorkerOptions")
		static konstructor(scriptURL: string, options?: WorkerOptions) {
			const init = readWorkerOptions(options);

			return new this(
				client.rewriteUrl(scriptURL, {
					destination: "worker",
					isModule: init.type === "module",
				}),
				init
			);
		}
	});

	// sharedworkers can only be constructed from window
	client.Intercept(class extends SharedWorker {
		@Constructor("USVString", "optional (DOMString or WorkerOptions)")
		static konstructor(scriptURL: string, options?: string | WorkerOptions) {
			// `siteOrigin`, not `url.origin`: an about:blank frame's shared workers
			// are its creator's, and its own URL has no origin to key on
			const scoped = (name: string) => `${client.scopeOrigin}@${name}`;

			if (typeof options === "string") {
				return new this(
					client.rewriteUrl(scriptURL, { destination: "sharedworker" }),
					scoped(options)
				);
			}

			const init = readWorkerOptions(options);

			return new this(
				client.rewriteUrl(scriptURL, {
					destination: "sharedworker",
					isModule: init.type === "module",
				}),
				{ ...init, name: scoped(init.name!) }
			);
		}
	});

	client.Intercept(class extends Worklet {
		@Arguments("USVString", "optional WorkletOptions")
		@Returns("Promise<undefined>")
		async addModule(
			moduleURL: string,
			options?: WorkletOptions
		): Promise<void> {
			return super.addModule(client.rewriteUrl(moduleURL), options);
		}
	});
}
