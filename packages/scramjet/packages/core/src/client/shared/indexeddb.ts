import { ScramjetClient } from "@client/index";
import { Arguments, Returns, Type } from "@client/webidl";
import { String_indexOf, String_substring } from "@/shared/snapshot";

export default function (client: ScramjetClient) {
	client.Intercept(class extends IDBFactory {
		@Returns("IDBOpenDBRequest")
		@Arguments("DOMString", "optional [EnforceRange] unsigned long long")
		open(name: string, version?: number): IDBOpenDBRequest {
			name = `${client.url.origin}@${name}`;

			return super.open(name, version);
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
