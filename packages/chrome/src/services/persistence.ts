import type { Service } from "./Service";
import type { KVWrapper } from "./KVWrapper";

export function createServiceFlusher(
	service: Service,
	kv: Pick<KVWrapper, "set">,
	key: string
) {
	let saving = false;
	return async () => {
		if (!service.dirty || saving) return;
		saving = true;
		// Clear before taking the snapshot. Changes during an asynchronous write
		// must remain dirty for the next flush, not be overwritten by an old save.
		service.dirty = false;
		try {
			await kv.set(key, service.save());
		} catch {
			service.dirty = true;
		} finally {
			saving = false;
		}
	};
}

export function registerSave(service: Service, kv: KVWrapper, key: string) {
	service.markDirty();
	const flush = createServiceFlusher(service, kv, key);
	setInterval(() => void flush(), 1000);
	window.addEventListener("pagehide", () => void flush());
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") void flush();
	});
}
