import { migration } from ".";
import type { SettingsServiceState } from "../services/SettingsService";
import { KVWrapper } from "../services/KVWrapper";

export default migration(1, async (kv: KVWrapper) => {
	const data = await kv.get<SettingsServiceState>("settings");
	if (!data?.settings) return;

	const { settings } = data;
	settings.tabLayout = "horizontal";
	settings.verticalTabJustify = "left";
	settings.sidebarWidth = null;

	await kv.set("settings", data);
});
