import assert from "node:assert/strict";
import { test } from "node:test";
import { History } from "../src/Tab/History.ts";
import type { Tab } from "../src/Tab/Tab.tsx";

function fixture(data?: ReturnType<History["serialize"]>) {
	const navigations: string[] = [];
	const tab = {
		url: new URL("https://example.com/"),
		canGoBack: false,
		canGoForward: false,
		_directnavigate(url: URL) {
			this.url = url;
			navigations.push(url.href);
		},
	};
	return { tab, navigations, history: new History(tab as Tab, data) };
}

test("document history traverses backward and forward without adding entries", () => {
	const { history, tab, navigations } = fixture();
	const first = new URL("https://example.com/first");
	const second = new URL("https://example.com/second");
	history.push(first);
	history.push(second);
	assert.equal(tab.canGoBack, true);
	assert.equal(tab.canGoForward, false);
	history.go(-1);
	assert.equal(tab.url.href, first.href);
	assert.equal(tab.canGoBack, false);
	assert.equal(tab.canGoForward, true);
	history.go(1);
	assert.equal(tab.url.href, second.href);
	assert.equal(history.states.length, 2);
	assert.deepEqual(navigations, [
		first.href,
		second.href,
		first.href,
		second.href,
	]);
});

test("serialized history restores URLs, titles and state at the selected entry", () => {
	const { history } = fixture();
	history.push(new URL("https://example.com/first"), "First", { step: 1 });
	history.push(new URL("https://example.com/second"), "Second", { step: 2 });
	history.go(-1);
	const restored = fixture(JSON.parse(JSON.stringify(history.serialize())));
	assert.equal(restored.history.index, 0);
	assert.equal(restored.history.states.length, 2);
	assert.equal(
		restored.history.current().url.href,
		"https://example.com/first"
	);
	assert.equal(restored.history.current().title, "First");
	assert.deepEqual(restored.history.current().state, { step: 1 });
});
