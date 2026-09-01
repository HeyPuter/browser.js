import { ScramjetClient } from "@client/index";
import { Arguments, Returns, Type } from "@client/webidl";
import { String_indexOf, String_substring } from "@/shared/snapshot";

export default function (client: ScramjetClient) {
	// `scopeOrigin`, not `url.origin`: an about:blank frame's databases are its
	// creator's, and its own URL has no origin to key on
	const scoped = (name: string) => `${client.scopeOrigin}@${name}`;

	client.Intercept(class extends IDBFactory {
		@Returns("IDBOpenDBRequest")
		@Arguments("DOMString", "optional [EnforceRange] unsigned long long")
		open(name: string, version?: number): IDBOpenDBRequest {
			return super.open(scoped(name), version);
		}

		// scoped alongside `open`, or a site cannot delete the database it just
		// created: the unscoped name names nothing and the deletion "succeeds"
		// against a database that never existed
		@Returns("IDBOpenDBRequest")
		@Arguments("DOMString")
		deleteDatabase(name: string): IDBOpenDBRequest {
			return super.deleteDatabase(scoped(name));
		}
	});

	client.Intercept(class extends IDBDatabase {
		@Type("DOMString")
		get name(): string {
			const name = super.name;

			return String_substring(name, String_indexOf(name, "@") + 1);
		}
	});
}
