import type { Chromebound } from "../../../inject/src/types";
import { browser } from "../Browser";
import {
	iconAdd,
	iconBack,
	iconBookmark,
	iconCode,
	iconCopy,
	iconForwards,
	iconLink,
	iconRefresh,
	iconSave,
	iconSearch,
} from "../icons";
import type { Tab } from "../Tab";

export function pageContextItems(
	tab: Tab,
	{ selection, image, anchor }: Chromebound["contextmenu"][0]
) {
	if (selection && selection.toString().length > 0) {
		return [
			{
				label: "Search",
				icon: iconSearch,
				action: () => {
					const query = selection.toString();
					if (query) {
						tab.pushNavigate(
							new URL(
								`https://www.google.com/search?q=${encodeURIComponent(query)}`
							)
						);
					}
				},
			},
			{
				label: "Copy",
				icon: iconCopy,
				action: () => {
					navigator.clipboard.writeText(selection.toString());
				},
			},
		];
	}

	if (image) {
		return [
			{
				label: "Open Image in New Tab",
				action: () => {
					// TODO: this is broken lol
					if (image.src) {
						let newTab = browser.newTab();
						newTab.pushNavigate(new URL(image.src));
					}
				},
			},
			{
				label: "Copy Image URL",
				action: () => {
					navigator.clipboard.writeText(image.src);
				},
			},
			{
				label: "Copy Image",
				action: () => {
					// copyImageToClipboard(target);
				},
			},
			{
				label: "Save Image As...",
				action: () => {
					// TODO
				},
			},
		];
	} else if (anchor) {
		return [
			{
				label: "Open Link",
				action: () => {
					if (anchor.href) {
						browser.activetab.pushNavigate(new URL(anchor.href));
					}
				},
				icon: iconLink,
			},
			{
				label: "Open Link in New Tab",
				action: () => {
					if (anchor.href) {
						browser.newTab(new URL(anchor.href));
					}
				},
				icon: iconAdd,
			},
			{
				label: "Copy Link Address",
				action: () => {
					navigator.clipboard.writeText(anchor.href);
				},
				icon: iconCopy,
			},
			{
				label: "Save Link As...",
				action: () => {
					// TODO
				},
				icon: iconSave,
			},
		];
	}

	return [
		{
			label: "Back",
			action: () => {
				tab.back();
			},
			icon: iconBack,
		},
		{
			label: "Forward",
			action: () => {
				tab.forward();
			},
			icon: iconForwards,
		},
		{
			label: "Reload",
			action: () => {
				tab.reload();
			},
			icon: iconRefresh,
		},
		{
			label: "Bookmark",
			action: () => {
				// TODO:
				console.log("Bookmarking", tab.title, tab.url);
			},
			icon: iconBookmark,
		},
		{
			label: "Inspect",
			action: () => {
				tab.devtoolsOpen = true;
				// if (e.target) requestInspectElement([e.target as HTMLElement, tab]);
			},
			icon: iconCode,
		},
	];
}
