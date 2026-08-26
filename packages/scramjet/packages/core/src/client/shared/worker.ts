import { ScramjetClient } from "@client/index";
import {
	Arguments,
	Constructor,
	Returns,
	idlDOMString,
	idlDictionary,
	idlEnum,
} from "@client/webidl";

const WORKER_TYPES = ["classic", "module"] as const;
const CREDENTIALS = ["omit", "same-origin", "include"] as const;

export default function (client: ScramjetClient) {
	/**
	 * `WorkerOptions`, read and converted exactly once.
	 *
	 * Every member is a page-controlled getter. Peeking at `options.type` to
	 * decide `isModule` and then handing the *same object* to the native means
	 * each getter runs twice, and the second run can return something other than
	 * what the URL was rewritten for. Rebuilding a plain object from the values
	 * converted here is what the IDL layer does for arguments; a dictionary has
	 * to be done by hand.
	 *
	 * Members are read in WebIDL's order, which is lexicographic by name.
	 */
	const readWorkerOptions = (options: unknown): WorkerOptions => {
		const dict = idlDictionary(options, "WorkerOptions");

		const rawCredentials = dict.credentials;
		const credentials =
			rawCredentials === undefined
				? "same-origin"
				: idlEnum(rawCredentials, CREDENTIALS, "RequestCredentials");
		const rawName = dict.name;
		const name = rawName === undefined ? "" : idlDOMString(rawName);
		const rawType = dict.type;
		const type =
			rawType === undefined
				? "classic"
				: idlEnum(rawType, WORKER_TYPES, "WorkerType");

		return { credentials, name, type };
	};

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
			const scoped = (name: string) => `${client.url.origin}@${name}`;

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
