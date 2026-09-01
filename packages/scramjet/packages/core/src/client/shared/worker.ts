import { ScramjetClient } from "@client/index";
import { Arguments, Constructor, Returns, Type } from "@client/webidl";
import { readWorkerOptions } from "@client/helpers";
import { String_indexOf, String_substring } from "@/shared/snapshot";

export default function (client: ScramjetClient, self: Self) {
	// `scopeOrigin`, not `url.origin`: an about:blank frame's shared workers
	// are its creator's, and its own URL has no origin to key on
	const scoped = (name: string) => `${client.scopeOrigin}@${name}`;

	// The other half of that scoping, and it has to be installed before the
	// interceptors below - `SharedWorker` and `Worklet` are `[Exposed=Window]`
	// in practice, so naming them in a worker throws and takes the rest of the
	// module with it.
	//
	// A shared worker is the one scoped name the page can read back from the
	// inside: `SharedWorkerGlobalScope.name` is the string the constructor was
	// given, so without this a site reads `https://site.example@myworker`.
	if ("SharedWorkerGlobalScope" in self) {
		client.Intercept(class extends SharedWorkerGlobalScope {
			@Type("DOMString")
			get name(): string {
				const name = super.name;

				// the origin cannot contain an "@", so the first one is the
				// separator and a name the page put an "@" in survives intact
				return String_substring(name, String_indexOf(name, "@") + 1);
			}
		});
	}

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
	if ("SharedWorker" in self)
		client.Intercept(class extends SharedWorker {
			@Constructor("USVString", "optional (DOMString or WorkerOptions)")
			static konstructor(scriptURL: string, options?: string | WorkerOptions) {
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

	if ("Worklet" in self)
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
