import { bindCDP } from "..";

// MARK: enable/disable
bindCDP("Page.enable", async function () {
	this.enableDomain("Page");
});

bindCDP("Page.disable", async function () {
	this.disableDomain("Page");
});
