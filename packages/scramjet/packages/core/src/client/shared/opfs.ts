import { ScramjetClient } from "@client/index";
import { encodeURIComponent } from "@/shared/snapshot";
import { Arguments, Returns, Type } from "@client/webidl";

export const enabled = (client: ScramjetClient, self: Self) =>
	"StorageManager" in self && "FileSystemHandle" in self;

export default function (client: ScramjetClient) {
	const scopeName = () => encodeURIComponent(client.url.origin);

	client.Intercept(class extends StorageManager {
		@Arguments()
		@Returns("Promise<FileSystemDirectoryHandle>")
		async getDirectory(): Promise<FileSystemDirectoryHandle> {
			const root = await super.getDirectory();
			const directory = await root.getDirectoryHandle(scopeName(), {
				create: true,
			});
			client.box.scopedOpfsRoots.add(directory);

			return directory;
		}
	});

	client.Intercept(class extends FileSystemHandle {
		@Type("USVString")
		// eslint-disable-next-line scramjet-core/intercept-brand-check -- membership is itself the brand check: impossible to forge
		get name(): string {
			// the scoped directory stands in for the origin's root, and a root's
			// name is the empty string.
			if (client.box.scopedOpfsRoots.has(this)) return "";

			return super.name;
		}
	});
}
