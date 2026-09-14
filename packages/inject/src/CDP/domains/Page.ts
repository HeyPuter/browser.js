import Protocol from "devtools-protocol";
import { bindCDP, CDPSession } from "..";
import { NodeManager } from "../nodemanager";

bindCDP("Page.enable", async function () {
	this.enableDomain("Page");
});

bindCDP("Page.disable", async function () {
	this.disableDomain("Page");
});
