import { STORAGE_VERSION } from "..";
import { KVWrapper } from "../services/KVWrapper";

let migrationsLoaded = false;

async function loadMigrations() {
	if (migrationsLoaded) return;
	migrationsLoaded = true;
}

export type MigrationAction = (kv: KVWrapper) => Promise<void>;
export type Migration = {
	version: number;
	action: MigrationAction;
};

export function migration(
	version: number,
	migrate: MigrationAction
): Migration {
	return {
		version,
		action: migrate,
	};
}

export async function migrate(version: number, kv: KVWrapper) {
	const modules = import.meta.glob("./[0-9]*.ts", { eager: true });
	const migrations = Object.values(modules).map(
		(m: any) => m.default
	) as Migration[];
	console.log(migrations);
	console.log(
		`attempting migration from ver. ${version} to ${STORAGE_VERSION}`
	);
	for (let i = version; i < STORAGE_VERSION; i++) {
		const migration = Object.values(migrations).find((m) => m.version === i)!;
		if (!migrate) {
			throw new Error(`Migration ${i} not found`);
		}
		console.log(`running migration ${i}`);
		// eslint-disable-next-line no-await-in-loop
		await migration.action(kv);
		console.log(`migration ${i} complete`);
		// eslint-disable-next-line no-await-in-loop
		await kv.set("version", (i + 1).toString());
	}
	console.log("migration complete");
}
