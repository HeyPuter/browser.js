import { migration } from ".";
import type { SettingsServiceState } from "../services/SettingsService";
import { KVWrapper } from "../services/KVWrapper";

export default migration(2, async (kv: KVWrapper) => {
	const data = await kv.get<SettingsServiceState>("settings");
	if (!data?.settings) return;

	const { settings } = data;
	settings.roundness = __DEFAULT_SETTINGS__.roundness;
	settings.tabStyle = __DEFAULT_SETTINGS__.tabStyle;
	settings.iconSet = __DEFAULT_SETTINGS__.iconSet;
	settings.animations = __DEFAULT_SETTINGS__.animations;

	await kv.set("settings", data);
});
