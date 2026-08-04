import type { IconifyIcon } from "@iconify/types";
import { createState, type Pointer } from "dreamland/core";
import type { IconSet } from "./tweaks";

// Ionicons
import ionBack from "@ktibow/iconset-ion/arrow-back";
import ionForwards from "@ktibow/iconset-ion/arrow-forward";
import ionRefresh from "@ktibow/iconset-ion/refresh";
import ionRefreshOutline from "@ktibow/iconset-ion/refresh-outline";
import ionBookmark from "@ktibow/iconset-ion/bookmark-outline";
import ionCode from "@ktibow/iconset-ion/code-outline";
import ionLink from "@ktibow/iconset-ion/link-outline";
import ionAdd from "@ktibow/iconset-ion/add";
import ionNew from "@ktibow/iconset-ion/duplicate-outline";
import ionCopy from "@ktibow/iconset-ion/copy-outline";
import ionSave from "@ktibow/iconset-ion/save-outline";
import ionOpen from "@ktibow/iconset-ion/open-outline";
import ionBrush from "@ktibow/iconset-ion/brush-outline";
import ionTrash from "@ktibow/iconset-ion/trash-outline";
import ionClose from "@ktibow/iconset-ion/close";
import ionCloseOutline from "@ktibow/iconset-ion/close-outline";
import ionCloseCircle from "@ktibow/iconset-ion/close-circle-outline";
import ionFolder from "@ktibow/iconset-ion/folder-outline";
import ionPause from "@ktibow/iconset-ion/pause-outline";
import ionStar from "@ktibow/iconset-ion/star-outline";
import ionStarFilled from "@ktibow/iconset-ion/star";
import ionExtension from "@ktibow/iconset-ion/extension-puzzle-outline";
import ionDownload from "@ktibow/iconset-ion/download-outline";
import ionMore from "@ktibow/iconset-ion/more";
import ionExit from "@ktibow/iconset-ion/exit-outline";
import ionTime from "@ktibow/iconset-ion/time-outline";
import ionInfo from "@ktibow/iconset-ion/information-circle-outline";
import ionSettings from "@ktibow/iconset-ion/settings-outline";
import ionOptions from "@ktibow/iconset-ion/options-outline";
import ionSearch from "@ktibow/iconset-ion/search";
import ionSearchOutline from "@ktibow/iconset-ion/search-outline";
import ionTrendingUp from "@ktibow/iconset-ion/trending-up";
import ionShield from "@ktibow/iconset-ion/shield-checkmark-outline";
import ionError from "@ktibow/iconset-ion/alert-circle-outline";
import ionCheckmark from "@ktibow/iconset-ion/checkmark-circle-outline";
import ionGlobe from "@ktibow/iconset-ion/globe-outline";
import ionEarth from "@ktibow/iconset-ion/earth-outline";
import ionServer from "@ktibow/iconset-ion/server-outline";
import ionDesktop from "@ktibow/iconset-ion/desktop-outline";
import ionCloud from "@ktibow/iconset-ion/cloud-outline";

// Material Symbols
import msBack from "@ktibow/iconset-material-symbols/arrow-back-rounded";
import msForwards from "@ktibow/iconset-material-symbols/arrow-forward-rounded";
import msRefresh from "@ktibow/iconset-material-symbols/refresh-rounded";
import msBookmark from "@ktibow/iconset-material-symbols/bookmark-outline-rounded";
import msCode from "@ktibow/iconset-material-symbols/code-rounded";
import msLink from "@ktibow/iconset-material-symbols/link-rounded";
import msAdd from "@ktibow/iconset-material-symbols/add-rounded";
import msNew from "@ktibow/iconset-material-symbols/add-box-outline-rounded";
import msCopy from "@ktibow/iconset-material-symbols/content-copy-outline-rounded";
import msSave from "@ktibow/iconset-material-symbols/save-outline-rounded";
import msOpen from "@ktibow/iconset-material-symbols/open-in-new-rounded";
import msBrush from "@ktibow/iconset-material-symbols/brush-outline";
import msTrash from "@ktibow/iconset-material-symbols/delete-outline-rounded";
import msClose from "@ktibow/iconset-material-symbols/close-rounded";
import msCloseCircle from "@ktibow/iconset-material-symbols/cancel-outline-rounded";
import msFolder from "@ktibow/iconset-material-symbols/folder-outline-rounded";
import msPause from "@ktibow/iconset-material-symbols/pause-rounded";
import msStar from "@ktibow/iconset-material-symbols/star-outline-rounded";
import msStarFilled from "@ktibow/iconset-material-symbols/star-rounded";
import msExtension from "@ktibow/iconset-material-symbols/extension-outline-rounded";
import msDownload from "@ktibow/iconset-material-symbols/download-rounded";
import msMore from "@ktibow/iconset-material-symbols/more-vert";
import msExit from "@ktibow/iconset-material-symbols/logout-rounded";
import msTime from "@ktibow/iconset-material-symbols/history-rounded";
import msInfo from "@ktibow/iconset-material-symbols/info-outline-rounded";
import msSettings from "@ktibow/iconset-material-symbols/settings-outline-rounded";
import msOptions from "@ktibow/iconset-material-symbols/tune-rounded";
import msSearch from "@ktibow/iconset-material-symbols/search-rounded";
import msTrendingUp from "@ktibow/iconset-material-symbols/trending-up-rounded";
import msShield from "@ktibow/iconset-material-symbols/verified-user-outline-rounded";
import msError from "@ktibow/iconset-material-symbols/error-outline-rounded";
import msCheckmark from "@ktibow/iconset-material-symbols/check-circle-outline-rounded";
import msGlobe from "@ktibow/iconset-material-symbols/language";
import msEarth from "@ktibow/iconset-material-symbols/public";
import msServer from "@ktibow/iconset-material-symbols/dns-outline";
import msDesktop from "@ktibow/iconset-material-symbols/desktop-windows-outline-rounded";
import msCloud from "@ktibow/iconset-material-symbols/cloud-outline";

const set = createState<{ current: IconSet }>({ current: "ionicons" });
export function setIconSet(next: IconSet) {
	set.current = next;
}

export type IconDescription = [ion: IconifyIcon, material: IconifyIcon];
// get an icondescription given two icons (one for each set)
function icon(ion: IconifyIcon, material: IconifyIcon): IconDescription {
	return [ion, material];
}
// resolve an IconDescription to the correct icon based on the current icon set
export function resolveIcon(
	desc: Pointer<IconDescription>
): Pointer<IconifyIcon> {
	return desc
		.zip(use(set.current))
		.map(([[ion, material], s]) => (s === "material" ? material : ion));
}

export const iconBack = icon(ionBack, msBack);
export const iconForwards = icon(ionForwards, msForwards);

export const iconRefresh = icon(ionRefresh, msRefresh);
export const iconRefreshOutline = icon(ionRefreshOutline, msRefresh);

export const iconBookmark = icon(ionBookmark, msBookmark);
export const iconCode = icon(ionCode, msCode);

export const iconLink = icon(ionLink, msLink);

export const iconAdd = icon(ionAdd, msAdd);
export const iconNew = icon(ionNew, msNew);
export const iconDuplicate = icon(ionCopy, msCopy);

export const iconSave = icon(ionSave, msSave);

export const iconOpen = icon(ionOpen, msOpen);
export const iconBrush = icon(ionBrush, msBrush);
export const iconTrash = icon(ionTrash, msTrash);

export const iconClose = icon(ionClose, msClose);
export const iconCloseOutline = icon(ionCloseOutline, msClose);
export const iconCloseCircle = icon(ionCloseCircle, msCloseCircle);

export const iconFolder = icon(ionFolder, msFolder);
export const iconPause = icon(ionPause, msPause);

export const iconStar = icon(ionStar, msStar);
export const iconStarFilled = icon(ionStarFilled, msStarFilled);

export const iconExtension = icon(ionExtension, msExtension);
export const iconDownload = icon(ionDownload, msDownload);

export const iconMore = icon(ionMore, msMore);
export const iconExit = icon(ionExit, msExit);

export const iconTime = icon(ionTime, msTime);
export const iconInfo = icon(ionInfo, msInfo);

export const iconSettings = icon(ionSettings, msSettings);
export const iconOptions = icon(ionOptions, msOptions);

export const iconSearch = icon(ionSearch, msSearch);
export const iconSearchOutline = icon(ionSearchOutline, msSearch);
export const iconTrendingUp = icon(ionTrendingUp, msTrendingUp);

export const iconShield = icon(ionShield, msShield);

export const iconError = icon(ionError, msError);
export const iconCheckmark = icon(ionCheckmark, msCheckmark);

export const iconGlobe = icon(ionGlobe, msGlobe);
export const iconEarth = icon(ionEarth, msEarth);
export const iconServer = icon(ionServer, msServer);
export const iconDesktop = icon(ionDesktop, msDesktop);
export const iconCloud = icon(ionCloud, msCloud);

// Aliases used elsewhere in the codebase. These deliberately share identity
// with the icon they alias.
export const iconAddFromDuplicate = iconNew;
export const iconCopy = iconDuplicate;
export const iconAbout = iconInfo;
export const iconPrivacy = iconShield;
