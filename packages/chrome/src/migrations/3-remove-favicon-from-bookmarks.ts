import { migration } from ".";
import type { ProfileMetadata } from "..";
import type { ProfileServiceState } from "../services/ProfileService";
import { KVWrapper } from "../services/KVWrapper";

export default migration(3, async (kv: KVWrapper) => {
	const profiles = await kv.get<ProfileMetadata[]>("profiles");
	if (!profiles) return;

	profiles.forEach(async (profileData) => {
		const profile = await kv.get<ProfileServiceState>(profileData.storageKey);
		if (!profile) return;
		if (!profile.bookmarks) return;

		delete (profile.bookmarks as any).favicon;
		await kv.set(profileData.storageKey, profile);
	});
});
