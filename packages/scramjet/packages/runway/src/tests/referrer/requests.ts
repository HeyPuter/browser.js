import { fetchMatrix, POLICIES, referrerTest } from "./fixture.ts";

// Per-request referrers and referrer policies, and the requests whose
// referrer is something other than the document: stylesheets, modules and
// workers.

export default [
	referrerTest({
		name: "referrer-subresources-default",
		js: `
		const ids = {};
		for (const [tag, ext] of [["img", ".png"], ["script", ".js"], ["link", ".css"]]) {
			for (const [where, origin] of [["same", MAIN], ["alt", ALT], ["xsite", XSITE]]) {
				const id = uid(tag + where);
				ids[tag + where] = id;
				const attrs = tag === "link" ? { rel: "stylesheet", href: rurl(origin, id, {}, ext) } : { src: rurl(origin, id, {}, ext) };
				await loadEl(tag, attrs);
			}
			await expectRef(ids[tag + "same"], PAGE, tag + " same-origin");
			await expectRef(ids[tag + "alt"], MAIN + "/", tag + " cross-origin");
			await expectRef(ids[tag + "xsite"], MAIN + "/", tag + " cross-site");
		}
		`,
	}),
	referrerTest({
		name: "referrer-xhr",
		js: `
		const same = uid("same"), alt = uid("alt");
		await xhr(rurl(MAIN, same));
		await xhr(rurl(ALT, alt));
		await expectRef(same, PAGE, "same-origin xhr");
		await expectRef(alt, MAIN + "/", "cross-origin xhr");
		`,
	}),
	referrerTest({
		name: "referrer-xhr-follows-document-policy",
		pageHeaders: { "Referrer-Policy": "origin" },
		js: `
		const same = uid("same");
		await xhr(rurl(MAIN, same));
		await expectRef(same, MAIN + "/", "xhr under origin");
		`,
	}),
	referrerTest({
		name: "referrer-send-beacon",
		js: `
		const same = uid("same"), alt = uid("alt");
		navigator.sendBeacon(rurl(MAIN, same), "x");
		navigator.sendBeacon(rurl(ALT, alt), "x");
		await expectRef(same, PAGE, "same-origin beacon");
		await expectRef(alt, MAIN + "/", "cross-origin beacon");
		`,
	}),
	referrerTest({
		name: "referrer-strips-fragment",
		js: `
		location.hash = "fragment-part";
		const same = uid("same");
		await fetch(rurl(MAIN, same));
		await expectRef(same, PAGE, "fragment is never sent");
		`,
	}),
	referrerTest({
		name: "referrer-follows-history-url-changes",
		js: `
		history.pushState(null, "", "/elsewhere/pushed.html?p=2#h");
		const pushed = uid("pushed");
		await fetch(rurl(MAIN, pushed));
		await expectRef(pushed, MAIN + "/elsewhere/pushed.html?p=2", "after pushState");
		history.replaceState(null, "", "/replaced?r=3");
		const replaced = uid("replaced"), alt = uid("alt");
		await fetch(rurl(MAIN, replaced));
		await fetch(rurl(ALT, alt));
		await expectRef(replaced, MAIN + "/replaced?r=3", "after replaceState");
		await expectRef(alt, MAIN + "/", "cross-origin after replaceState");
		`,
	}),
	referrerTest({
		name: "referrer-long-url-falls-back-to-origin",
		js: `
		history.replaceState(null, "", "/long?" + "a".repeat(4200));
		const long = uid("long");
		await fetch(rurl(MAIN, long));
		await expectRef(long, MAIN + "/", "a referrer over 4096 bytes is cut to its origin");
		const fits = "/fits?" + "b".repeat(3900);
		history.replaceState(null, "", fits);
		const short = uid("short");
		await fetch(rurl(MAIN, short));
		await expectRef(short, MAIN + fits, "a referrer under 4096 bytes is sent whole");
		`,
	}),

	// fetch()'s referrerPolicy
	...POLICIES.map((policy) =>
		referrerTest({
			name: `referrer-fetch-init-policy-${policy}`,
			js: fetchMatrix(policy, JSON.stringify({ referrerPolicy: policy })),
		})
	),
	referrerTest({
		name: "referrer-fetch-init-policy-overrides-document",
		pageHeaders: { "Referrer-Policy": "no-referrer" },
		js: `
		${fetchMatrix("unsafe-url", '{ referrerPolicy: "unsafe-url" }')}
		${fetchMatrix("origin", '{ referrerPolicy: "origin" }')}
		${fetchMatrix("no-referrer")}
		`,
	}),
	referrerTest({
		name: "referrer-fetch-init-unsafe-url-under-strict-document",
		pageHeaders: { "Referrer-Policy": "same-origin" },
		js: `
		${fetchMatrix("unsafe-url", '{ referrerPolicy: "unsafe-url" }')}
		${fetchMatrix("same-origin")}
		`,
	}),
	referrerTest({
		name: "referrer-fetch-init-empty-policy-uses-document",
		pageHeaders: { "Referrer-Policy": "origin" },
		js: fetchMatrix("origin", '{ referrerPolicy: "" }'),
	}),

	// fetch()'s referrer
	referrerTest({
		name: "referrer-fetch-init-referrer",
		js: `
		const custom = uid("custom"), customAlt = uid("customalt"), empty = uid("empty"), client = uid("client"), cred = uid("cred"), abs = uid("abs");
		await fetch(rurl(MAIN, custom), { referrer: "/custom/path?x=1#frag" });
		await fetch(rurl(ALT, customAlt), { referrer: "/custom/path?x=1" });
		await fetch(rurl(MAIN, empty), { referrer: "" });
		await fetch(rurl(MAIN, client), { referrer: "about:client" });
		await fetch(rurl(MAIN, abs), { referrer: MAIN + "/absolute?y=2" });
		await fetch(rurl(MAIN, cred), { referrer: MAIN.replace("//", "//user:pass@") + "/cred?c=1#f" });
		await expectRef(custom, MAIN + "/custom/path?x=1", "relative referrer");
		await expectRef(customAlt, MAIN + "/", "relative referrer, cross-origin target");
		await expectRef(empty, null, "empty referrer");
		await expectRef(client, PAGE, "about:client");
		await expectRef(abs, MAIN + "/absolute?y=2", "absolute same-origin referrer");
		await expectRef(cred, MAIN + "/cred?c=1", "credentials are stripped");
		`,
	}),
	referrerTest({
		name: "referrer-fetch-init-referrer-with-policy",
		js: `
		const a = uid("a"), b = uid("b");
		await fetch(rurl(ALT, a), { referrer: "/custom?z", referrerPolicy: "unsafe-url" });
		await fetch(rurl(MAIN, b), { referrer: "/custom?z", referrerPolicy: "origin" });
		await expectRef(a, MAIN + "/custom?z", "custom referrer under unsafe-url");
		await expectRef(b, MAIN + "/", "custom referrer under origin");
		`,
	}),
	referrerTest({
		name: "referrer-fetch-init-cross-origin-referrer",
		js: `
		const id = uid("x");
		const result = await attempt(async () => {
			await fetch(rurl(MAIN, id), { referrer: ALT + "/foreign" });
			return await seen(id);
		});
		assertConsistent("cross-origin referrer", result);
		const bad = await attempt(() => new Request("/x", { referrer: "http://[" }));
		assertEqual(bad, "threw TypeError", "an unparseable referrer throws");
		`,
	}),

	// Request objects
	referrerTest({
		name: "referrer-request-object",
		js: `
		assertEqual(new Request("/x").referrer, "about:client", "default referrer");
		assertEqual(new Request("/x", { referrer: "" }).referrer, "", "empty referrer");
		assertEqual(new Request("/x", { referrer: "about:client" }).referrer, "about:client");
		assertEqual(new Request("/x", { referrer: "/y?z" }).referrer, MAIN + "/y?z", "relative referrer");
		assertEqual(new Request("/x", { referrer: MAIN + "/abs" }).referrer, MAIN + "/abs", "absolute referrer");
		assertConsistent("referrer with fragment", new Request("/x", { referrer: "/y#frag" }).referrer);
		assertEqual(new Request(new Request("/x", { referrer: "/copy" })).referrer, MAIN + "/copy", "copied from another Request");
		assertEqual(new Request(new Request("/x", { referrer: "/copy" }), { referrer: "" }).referrer, "", "overridden when copied");
		assertEqual(new Request("/x", { referrerPolicy: "origin" }).referrerPolicy, "origin");
		assertEqual(new Request(new Request("/x", { referrerPolicy: "origin" })).referrerPolicy, "origin");
		assertEqual(new Request("/x", { referrer: "/y" }).clone().referrer, MAIN + "/y", "clone keeps the referrer");

		const withRef = uid("withref"), noRef = uid("noref"), pol = uid("pol"), cloned = uid("cloned");
		await fetch(new Request(rurl(MAIN, withRef), { referrer: "/from-request" }));
		await fetch(new Request(rurl(MAIN, noRef), { referrer: "" }));
		await fetch(new Request(rurl(MAIN, pol), { referrerPolicy: "no-referrer" }));
		await fetch(new Request(rurl(MAIN, cloned), { referrer: "/cloned" }).clone());
		await expectRef(withRef, MAIN + "/from-request", "Request with a referrer");
		await expectRef(noRef, null, "Request with no referrer");
		await expectRef(pol, null, "Request with no-referrer");
		await expectRef(cloned, MAIN + "/cloned", "cloned Request");
		`,
	}),
	referrerTest({
		name: "referrer-request-object-in-fetch-init-override",
		js: `
		const a = uid("a"), b = uid("b");
		await fetch(new Request(rurl(MAIN, a), { referrer: "/first" }), { referrer: "/second" });
		await fetch(new Request(rurl(ALT, b), { referrerPolicy: "no-referrer" }), { referrerPolicy: "unsafe-url" });
		await expectRef(a, MAIN + "/second", "init referrer overrides the Request's");
		await expectRef(b, PAGE, "init policy overrides the Request's");
		`,
	}),
	referrerTest({
		name: "referrer-response-and-request-urls-unaffected",
		js: `
		const r = new Request("/x", { referrer: "/y" });
		assertEqual(r.url, MAIN + "/x");
		assertEqual(new Request(rurl(MAIN, "q")).referrer, "about:client");
		`,
	}),

	// element referrerpolicy attributes
	referrerTest({
		name: "referrer-element-referrerpolicy-attribute",
		js: `
		const cases = [
			["img", ".png", MAIN, "no-referrer", null],
			["img", ".png", ALT, "unsafe-url", PAGE],
			["img", ".png", MAIN, "origin", MAIN + "/"],
			["img", ".png", ALT, "same-origin", null],
			["script", ".js", MAIN, "origin", MAIN + "/"],
			["script", ".js", ALT, "unsafe-url", PAGE],
			["link", ".css", MAIN, "no-referrer", null],
			["link", ".css", ALT, "unsafe-url", PAGE],
		];
		for (const [tag, ext, origin, policy, expected] of cases) {
			const id = uid(tag);
			const url = rurl(origin, id, {}, ext);
			await loadEl(tag, tag === "link" ? { rel: "stylesheet", referrerpolicy: policy, href: url } : { referrerpolicy: policy, src: url });
			await expectRef(id, expected, tag + " referrerpolicy=" + policy);
		}
		`,
	}),
	referrerTest({
		name: "referrer-element-referrerpolicy-overrides-document",
		pageHeaders: { "Referrer-Policy": "no-referrer" },
		js: `
		const a = uid("a"), b = uid("b");
		await loadEl("img", { referrerpolicy: "unsafe-url", src: rurl(ALT, a, {}, ".png") });
		await loadEl("img", { src: rurl(ALT, b, {}, ".png") });
		await expectRef(a, PAGE, "img referrerpolicy=unsafe-url under a no-referrer document");
		await expectRef(b, null, "img without the attribute");
		`,
	}),
	referrerTest({
		name: "referrer-element-referrerpolicy-property",
		js: `
		const id = uid("prop");
		await new Promise((resolve) => {
			const img = new Image();
			img.referrerPolicy = "origin";
			img.onload = img.onerror = resolve;
			img.src = rurl(MAIN, id, {}, ".png");
		});
		await expectRef(id, MAIN + "/", "img.referrerPolicy = origin");
		const img = document.createElement("img");
		img.referrerPolicy = "no-referrer";
		assertEqual(img.getAttribute("referrerpolicy"), "no-referrer", "the property reflects the attribute");
		img.setAttribute("referrerpolicy", "bogus");
		assertEqual(img.referrerPolicy, "", "an invalid value reflects as empty");
		`,
	}),
	referrerTest({
		name: "referrer-element-referrerpolicy-invalid-uses-document",
		pageHeaders: { "Referrer-Policy": "origin" },
		js: `
		const id = uid("bogus");
		await loadEl("img", { referrerpolicy: "bogus", src: rurl(MAIN, id, {}, ".png") });
		await expectRef(id, MAIN + "/", "invalid referrerpolicy falls back to the document's");
		`,
	}),

	// stylesheets are the referrer of what they load
	referrerTest({
		name: "referrer-css-external-sheet-is-referrer",
		js: `
		const img = uid("img"), sheet = uid("sheet");
		const sheetUrl = rurl(MAIN, sheet, { body: "body { background-image: url(" + rurl(MAIN, img, {}, ".png") + ") }" }, ".css");
		await loadEl("link", { rel: "stylesheet", href: sheetUrl });
		await expectRef(sheet, PAGE, "the stylesheet itself");
		await expectRef(img, sheetUrl, "an image the stylesheet loads");
		`,
	}),
	referrerTest({
		name: "referrer-css-cross-origin-sheet",
		js: `
		const img = uid("img"), sheet = uid("sheet");
		const sheetUrl = rurl(ALT, sheet, { body: "body { background-image: url(" + rurl(MAIN, img, {}, ".png") + ") }" }, ".css");
		await loadEl("link", { rel: "stylesheet", href: sheetUrl });
		await expectRef(sheet, MAIN + "/", "the cross-origin stylesheet");
		await expectRef(img, ALT + "/", "an image the cross-origin stylesheet loads from the page's origin");
		`,
	}),
	referrerTest({
		name: "referrer-css-sheet-policy-header",
		js: `
		const none = uid("none"), unsafe = uid("unsafe");
		const noneSheet = rurl(MAIN, uid("s"), { rp: "no-referrer", body: "html { background-image: url(" + rurl(MAIN, none, {}, ".png") + ") }" }, ".css");
		const unsafeSheet = rurl(MAIN, uid("s"), { rp: "unsafe-url", body: "body { background-image: url(" + rurl(ALT, unsafe, {}, ".png") + ") }" }, ".css");
		await loadEl("link", { rel: "stylesheet", href: noneSheet });
		await loadEl("link", { rel: "stylesheet", href: unsafeSheet });
		await expectRef(none, null, "sheet served with no-referrer");
		await expectRef(unsafe, unsafeSheet, "sheet served with unsafe-url");
		`,
	}),
	referrerTest({
		name: "referrer-css-import",
		js: `
		const inner = uid("inner"), img = uid("img");
		const innerUrl = rurl(MAIN, inner, { body: "body { background-image: url(" + rurl(MAIN, img, {}, ".png") + ") }" }, ".css");
		const outerUrl = rurl(MAIN, uid("outer"), { body: "@import url(" + JSON.stringify(innerUrl) + ");" }, ".css");
		await loadEl("link", { rel: "stylesheet", href: outerUrl });
		await expectRef(inner, outerUrl, "an @import's referrer is the importing sheet");
		await expectRef(img, innerUrl, "the imported sheet's image");
		`,
	}),
	referrerTest({
		name: "referrer-css-inline-uses-document",
		js: `
		const a = uid("style"), b = uid("attr");
		const style = document.createElement("style");
		style.textContent = "html { background-image: url(" + rurl(MAIN, a, {}, ".png") + ") }";
		document.head.append(style);
		const div = document.createElement("div");
		div.style.cssText = "width:10px;height:10px;background-image:url(" + rurl(MAIN, b, {}, ".png") + ")";
		document.body.append(div);
		await expectRef(a, PAGE, "<style>");
		await expectRef(b, PAGE, "style attribute");
		`,
	}),

	// module scripts are the referrer of what they import
	referrerTest({
		name: "referrer-module-imports",
		js: `
		const dep = uid("dep"), mod = uid("mod"), dyn = uid("dyn");
		const depUrl = rurl(MAIN, dep, { body: "export default 1;" }, ".js");
		const modUrl = rurl(MAIN, mod, { body: "import " + JSON.stringify(depUrl) + "; window.__modLoaded = true;" }, ".js");
		await loadEl("script", { type: "module", src: modUrl });
		await expectRef(mod, PAGE, "the module itself");
		await expectRef(dep, modUrl, "a static import");
		await import(rurl(MAIN, dyn, { body: "export default 2;" }, ".js"));
		await expectRef(dyn, PAGE, "a dynamic import from an inline script");
		`,
	}),
	referrerTest({
		name: "referrer-module-referrerpolicy-propagates",
		js: `
		const dep = uid("dep");
		const depUrl = rurl(MAIN, dep, { body: "export default 1;" }, ".js");
		const modUrl = rurl(MAIN, uid("mod"), { body: "import " + JSON.stringify(depUrl) + ";" }, ".js");
		await loadEl("script", { type: "module", referrerpolicy: "no-referrer", src: modUrl });
		await expectRef(dep, null, "the import inherits the script element's policy");
		`,
	}),

	// workers are the referrer of what they fetch
	referrerTest({
		name: "referrer-worker",
		js: `
		const worker = uid("worker"), inner = uid("inner"), innerAlt = uid("inneralt"), imported = uid("imported");
		const body = "importScripts(" + JSON.stringify(rurl(MAIN, imported, {}, ".js")) + ");" +
			"Promise.all([fetch(" + JSON.stringify(rurl(MAIN, inner)) + "), fetch(" + JSON.stringify(rurl(ALT, innerAlt)) + ")]).then(() => postMessage('done'));";
		const workerUrl = rurl(MAIN, worker, { body }, ".js");
		const w = new Worker(workerUrl);
		await workerDone(w);
		w.terminate();
		await expectRef(worker, PAGE, "the worker script");
		await expectRef(imported, workerUrl, "importScripts in the worker");
		await expectRef(inner, workerUrl, "a same-origin fetch in the worker");
		await expectRef(innerAlt, MAIN + "/", "a cross-origin fetch in the worker");
		`,
	}),
	referrerTest({
		name: "referrer-worker-policy-header",
		js: `
		const inner = uid("inner");
		const body = "fetch(" + JSON.stringify(rurl(MAIN, inner)) + ").then(() => postMessage('done'));";
		const w = new Worker(rurl(MAIN, uid("worker"), { body, rp: "no-referrer" }, ".js"));
		await workerDone(w);
		w.terminate();
		await expectRef(inner, null, "the worker's own Referrer-Policy header");
		`,
	}),
	referrerTest({
		name: "referrer-worker-policy-without-header",
		pageHeaders: { "Referrer-Policy": "no-referrer" },
		js: `
		const inner = uid("inner");
		const body = "fetch(" + JSON.stringify(rurl(MAIN, inner)) + ").then(() => postMessage('done'));";
		const workerUrl = rurl(MAIN, uid("worker"), { body }, ".js");
		const w = new Worker(workerUrl);
		await workerDone(w);
		w.terminate();
		await expectRef(inner, workerUrl, "a worker served without a policy uses the default, not its creator's");
		`,
	}),
	referrerTest({
		name: "referrer-module-worker",
		js: `
		const worker = uid("worker"), dep = uid("dep");
		const depUrl = rurl(MAIN, dep, { body: "export default 1;" }, ".js");
		const body = "import " + JSON.stringify(depUrl) + "; postMessage('done');";
		const workerUrl = rurl(MAIN, worker, { body }, ".js");
		const w = new Worker(workerUrl, { type: "module" });
		await workerDone(w);
		w.terminate();
		await expectRef(worker, PAGE, "the module worker script");
		await expectRef(dep, workerUrl, "a static import in the module worker");
		`,
	}),
];
