import { basicTest } from "../../testcommon.ts";

/* eslint-disable quotes -- browser snippets are clearer as template literals */

// MutationObserver fidelity (client/dom/mutations.ts).
//
// Scramjet keeps state in the document the page must never see: the
// `scramjet-attr-*` mirror of every rewritten attribute, the script source
// attribute, the rewritten program in the first Text child of a script or a
// style, and the probe node that re-prepares a connected script. Every one of
// those is a DOM mutation, and a MutationObserver sees DOM mutations - so
// without a proxy it gets records under internal names, old values carrying
// proxy URLs and rewritten code, and records for changes the page never made
// (which is how an observer that re-applies a style ends up in a loop).
//
// Almost everything here is differential: the same snippet runs in bare
// Chromium and through scramjet, and the JSON of what the page can observe
// has to match. Values are written relative or against a fixed foreign
// origin, so the two runs write the same strings.

const HELPERS = `
	const cleanup = [];
	const XLINK = "http://www.w3.org/1999/xlink";
	const SVG = "http://www.w3.org/2000/svg";
	const conn = (n, parent) => { (parent || document.body).append(n); cleanup.push(n); return n; };
	const mk = (tag, attrs) => {
		const e = document.createElement(tag);
		if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
		return e;
	};
	const svgEl = (tag) => document.createElementNS(SVG, tag);
	const probe = (f) => { try { return f(); } catch (e) { return "!" + (e && e.name); } };
	const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
	const nm = (n) => n === null || n === undefined ? n : n.nodeName + (n.id ? "#" + n.id : "");
	const nodes = (list) => [...list].map((n) =>
		n.nodeType === 3 || n.nodeType === 4 ? n.nodeName + ":" + n.data : nm(n)
	);
	const rec = (r) => ({
		type: r.type,
		target: nm(r.target),
		name: r.attributeName,
		ns: r.attributeNamespace,
		old: r.oldValue,
		added: nodes(r.addedNodes),
		removed: nodes(r.removedNodes),
		prev: nm(r.previousSibling),
		next: nm(r.nextSibling),
	});
	const recs = (list) => list.map(rec);
	const ALL = { attributes: true, attributeOldValue: true, childList: true, characterData: true, characterDataOldValue: true, subtree: true };
	const ATTRS = { attributes: true, attributeOldValue: true, subtree: true };
	const TEXT = { childList: true, characterData: true, characterDataOldValue: true, subtree: true };
	// what the records of one synchronous block of work are, through takeRecords
	const watch = (target, options, fn) => {
		const mo = new MutationObserver(() => {});
		mo.observe(target, options);
		fn();
		const out = recs(mo.takeRecords());
		mo.disconnect();
		return out;
	};
	// the same, as the callback receives them: one entry per invocation
	const deliver = async (target, options, fn, settle) => {
		const calls = [];
		const mo = new MutationObserver((list) => { calls.push(recs(list)); });
		mo.observe(target, options);
		await fn();
		await tick(settle || 0);
		mo.disconnect();
		return calls;
	};
	// every record's attribute name next to what the target reports for it now
	const readBack = (list) => list.map((r) => r.type === "attributes"
		? [r.attributeName, r.target.getAttribute(r.attributeName), r.target.hasAttribute(r.attributeName)]
		: [r.type]);
`;

/** Bare Chromium and scramjet have to observe the same thing. `body` returns it. */
const differential = (name: string, body: string) =>
	basicTest({
		name: `mutobs-${name}`,
		js: `
			${HELPERS}
			const snapshot = async () => {
				try {
					return { value: await (async () => { ${body} })() };
				} catch (error) {
					return { error: error && error.name, message: error && error.message };
				} finally {
					for (const n of cleanup) { try { n.remove(); } catch {} }
				}
			};
			assertConsistent(${JSON.stringify(name)}, await snapshot());
		`,
	});

/**
 * Nothing a record carries may name scramjet: no internal attribute, no proxy
 * URL, no rewritten code. Runs in both harnesses (it trivially holds in bare
 * Chromium) and compares the records too.
 */
const leakSweep = (name: string, body: string, scramjetOnly = false) =>
	basicTest({
		name: `mutobs-leak-${name}`,
		scramjetOnly,
		js: `
			${HELPERS}
			const LEAK = /scramjet|\\/~\\/sj\\/|%3A%2F%2F|\\$sj|registerrealm/i;
			const bad = [];
			const scan = (list) => {
				for (const r of list) {
					const flat = JSON.stringify(rec(r));
					if (LEAK.test(flat)) bad.push(flat);
				}
			};
			let value;
			try {
				value = await (async () => { ${body} })();
			} finally {
				for (const n of cleanup) { try { n.remove(); } catch {} }
			}
			assert(bad.length === 0, "records leak scramjet internals: " + bad.slice(0, 5).join(" | "));
			assertConsistent(${JSON.stringify(name)}, value);
		`,
	});

export default [
	// --- attributes: URL rules ----------------------------------------------

	differential(
		"attr-img-src-setattribute",
		`const img = mk("img");
		return watch(img, ATTRS, () => {
			img.setAttribute("src", "/a.png");
			img.setAttribute("src", "https://example.com/b.png");
			img.setAttribute("src", "/a.png");
		});`
	),
	differential(
		"attr-img-src-idl",
		`const img = mk("img");
		return watch(img, ATTRS, () => {
			img.src = "/a.png";
			img.src = "https://example.com/b.png";
			img.src = "";
		});`
	),
	differential(
		"attr-img-src-no-oldvalue",
		`const img = mk("img", { src: "/first.png" });
		return watch(img, { attributes: true }, () => {
			img.setAttribute("src", "/a.png");
			img.removeAttribute("src");
		});`
	),
	differential(
		"attr-remove",
		`const img = mk("img");
		return watch(img, ATTRS, () => {
			img.removeAttribute("src");
			img.setAttribute("src", "/a.png");
			img.removeAttribute("src");
			img.removeAttribute("src");
		});`
	),
	differential(
		"attr-parsed-then-set",
		`const d = mk("div");
		d.innerHTML = '<a id="x" href="/parsed">x</a><img id="y" src="/parsed.png" srcset="/p1.png 1x, /p2.png 2x">';
		const a = d.querySelector("a"), img = d.querySelector("img");
		return watch(d, ATTRS, () => {
			a.setAttribute("href", "/y");
			a.href = "https://example.com/z";
			img.srcset = "/q.png 1x";
			img.removeAttribute("src");
			a.removeAttribute("href");
		});`
	),
	differential(
		"attr-url-rules",
		`const els = {
			a: mk("a"), area: mk("area"), form: mk("form"), button: mk("button"),
			video: mk("video"), audio: mk("audio"), source: mk("source"), object: mk("object"),
			embed: mk("embed"), input: mk("input"), track: mk("track"), link: mk("link"),
			script: mk("script"), iframe: mk("iframe"), frame: mk("frame"),
		};
		const root = mk("div");
		for (const k in els) { els[k].id = k; root.append(els[k]); }
		return watch(root, ATTRS, () => {
			els.a.setAttribute("href", "/a");
			els.area.setAttribute("href", "/area");
			els.form.setAttribute("action", "/form");
			els.button.setAttribute("formaction", "/button");
			els.video.setAttribute("poster", "/poster.png");
			els.video.setAttribute("src", "/v.mp4");
			els.audio.setAttribute("src", "/a.mp3");
			els.source.setAttribute("src", "/s.mp4");
			els.source.setAttribute("srcset", "/s1.png 1x");
			els.object.setAttribute("data", "/o.bin");
			els.embed.setAttribute("src", "/e.bin");
			els.input.setAttribute("src", "/i.png");
			els.input.setAttribute("formaction", "/i");
			els.track.setAttribute("src", "/t.vtt");
			els.link.setAttribute("imagesrcset", "/l.png 1x");
			els.script.setAttribute("src", "/s.js");
			els.frame.setAttribute("src", "/f.html");
			els.a.setAttribute("href", "/a2");
			els.form.action = "/form2";
		});`
	),
	differential(
		"attr-filter-src",
		`const img = mk("img");
		return watch(img, { attributeFilter: ["src"], attributeOldValue: true }, () => {
			img.setAttribute("title", "t");
			img.setAttribute("src", "/a.png");
			img.setAttribute("src", "/b.png");
			img.removeAttribute("src");
		});`
	),
	differential(
		"attr-filter-several",
		`const img = mk("img"), a = mk("a"), d = mk("div");
		d.append(img, a);
		return watch(d, { attributeFilter: ["href", "alt"], attributeOldValue: true, subtree: true }, () => {
			img.setAttribute("src", "/a.png");
			img.setAttribute("alt", "x");
			a.setAttribute("href", "/h");
			a.setAttribute("href", "/i");
		});`
	),
	differential(
		"attr-filter-internal-names",
		`const img = mk("img"), s = mk("script");
		return watch(img, { attributeFilter: ["scramjet-attr-src", "scramjet-attr_script-source", "SCRAMJET-ATTR-SRC"], attributeOldValue: true }, () => {
			img.setAttribute("src", "/a.png");
			img.src = "/b.png";
			s.text = "x = 1;";
		});`
	),
	differential(
		"attr-filter-case",
		`const img = mk("img");
		return watch(img, { attributeFilter: ["SRC"], attributeOldValue: true }, () => {
			img.setAttribute("SRC", "/a.png");
			img.src = "/b.png";
		});`
	),
	differential(
		"attr-filter-empty",
		`const img = mk("img");
		return watch(img, { attributeFilter: [], attributeOldValue: true }, () => {
			img.setAttribute("src", "/a.png");
			img.setAttribute("id", "x");
		});`
	),
	// a name under scramjet's prefix is one the page cannot write at all (a
	// separate difference from Chromium, where it is an attribute like any
	// other) - so all that is checked here is that the attempts queue nothing
	leakSweep(
		"internal-name-writes",
		`const mo = new MutationObserver(() => {});
		const img = mk("img", { src: "/a.png" });
		mo.observe(img, ATTRS);
		probe(() => img.setAttribute("scramjet-attr-src", "evil"));
		probe(() => img.removeAttribute("scramjet-attr-src"));
		probe(() => img.setAttribute("SCRAMJET-ATTR-SRC", "evil"));
		img.setAttribute("data-scramjet", "fine");
		const list = mo.takeRecords();
		mo.disconnect();
		scan(list.filter((r) => r.attributeName !== "data-scramjet"));
		return recs(list);`,
		true
	),

	// --- attributes: stripped by their rule ---------------------------------

	differential(
		"attr-nonce",
		`const s = mk("script"), d = mk("div");
		d.append(s);
		return watch(d, ATTRS, () => {
			s.setAttribute("nonce", "abc");
			s.setAttribute("nonce", "def");
			s.nonce = "slot-only";
			s.removeAttribute("nonce");
			s.removeAttribute("nonce");
			s.toggleAttribute("nonce");
			s.toggleAttribute("nonce");
		});`
	),
	differential(
		"attr-integrity",
		`const l = mk("link"), s = mk("script");
		const d = mk("div"); d.append(l, s);
		return watch(d, ATTRS, () => {
			l.setAttribute("integrity", "sha256-AAAA");
			l.integrity = "sha384-BBBB";
			s.setAttribute("integrity", "sha256-CCCC");
			l.removeAttribute("integrity");
		});`
	),
	differential(
		"attr-iframe-sandbox",
		`const f = mk("iframe");
		return watch(f, ATTRS, () => {
			f.setAttribute("sandbox", "allow-scripts");
			f.sandbox.add("allow-forms");
			f.sandbox.remove("allow-scripts");
			f.sandbox.value = "allow-popups";
			f.removeAttribute("sandbox");
		});`
	),
	differential(
		"attr-iframe-csp-credentialless",
		`const f = mk("iframe");
		return watch(f, ATTRS, () => {
			f.setAttribute("csp", "script-src 'none'");
			f.setAttribute("credentialless", "");
			f.removeAttribute("csp");
			f.removeAttribute("credentialless");
		});`
	),
	differential(
		"attr-target",
		`const a = mk("a"), base = mk("base");
		const d = mk("div"); d.append(a, base);
		return watch(d, ATTRS, () => {
			a.setAttribute("target", "_top");
			a.setAttribute("target", "_parent");
			a.setAttribute("target", "_blank");
			a.target = "_top";
			base.setAttribute("target", "_parent");
			a.removeAttribute("target");
		});`
	),

	// --- attributes: event handlers -----------------------------------------

	differential(
		"attr-onclick",
		`const b = mk("button");
		return watch(b, ATTRS, () => {
			b.setAttribute("onclick", "location.href");
			b.setAttribute("onclick", "top.x = 1");
			b.onclick = () => {};
			b.setAttribute("onmouseover", "window.parent");
			b.removeAttribute("onclick");
		});`
	),
	differential(
		"attr-onclick-parsed",
		`const d = mk("div");
		d.innerHTML = '<button onclick="location.reload()">x</button>';
		const b = d.firstChild;
		return watch(d, ATTRS, () => { b.setAttribute("onclick", "top.y"); });`
	),

	// --- attributes: style ----------------------------------------------------

	differential(
		"attr-style-setattribute",
		`const d = mk("div");
		return watch(d, ATTRS, () => {
			d.setAttribute("style", "color: red");
			d.setAttribute("style", "background: url(/a.png)");
			d.setAttribute("style", "background: url(https://example.com/b.png)");
			d.removeAttribute("style");
		});`
	),
	differential(
		"attr-style-cssom",
		`const d = mk("div");
		return watch(d, ATTRS, () => {
			d.style.color = "red";
			d.style.backgroundImage = "url(https://example.com/a.png)";
			d.style.setProperty("width", "1px");
			d.style.setProperty("height", "2px", "important");
			d.style.removeProperty("color");
			d.style.cssText = "top: 0px; background: url(https://example.com/x.png)";
			d.style.cssText = "";
		});`
	),
	differential(
		"attr-style-cssom-after-parse",
		`const d = mk("div");
		d.innerHTML = '<p style="color: blue; background: url(https://example.com/p.png)">x</p>';
		const p = d.firstChild;
		return watch(d, ATTRS, () => {
			p.style.color = "green";
			p.style.removeProperty("background");
		});`
	),
	differential(
		"attr-style-cssom-noop",
		`const d = mk("div");
		d.style.color = "red";
		d.style.backgroundImage = "url(/a.png)";
		return watch(d, ATTRS, () => {
			d.style.color = "red";
			d.style.setProperty("color", "red");
			d.style.backgroundImage = "url(/a.png)";
			d.style.removeProperty("width");
		});`
	),
	differential(
		"attr-style-cssom-noop-fresh",
		`const d = mk("div");
		return watch(d, ATTRS, () => {
			d.style.removeProperty("color");
			d.style.color = "";
		});`
	),
	differential(
		"attr-style-filter",
		`const d = mk("div");
		return watch(d, { attributeFilter: ["style"], attributeOldValue: true }, () => {
			d.style.color = "red";
			d.style.color = "blue";
			d.setAttribute("title", "x");
		});`
	),
	differential(
		"attr-style-svg",
		`const svg = svgEl("svg"), rect = svgEl("rect");
		svg.append(rect);
		return watch(svg, ATTRS, () => {
			rect.style.fill = "red";
			rect.style.fill = "blue";
			rect.setAttribute("style", "stroke: blue");
		});`
	),
	differential(
		"attr-style-attributestylemap",
		`const d = mk("div");
		if (!d.attributeStyleMap) return "no typed om";
		return watch(d, ATTRS, () => {
			d.attributeStyleMap.set("width", CSS.px(3));
			d.attributeStyleMap.set("width", CSS.px(3));
			d.attributeStyleMap.delete("width");
		});`
	),
	// an observer that re-applies an unchanged inline style on every record.
	// natively that queues nothing, so it settles after one call
	differential(
		"attr-style-feedback-loop",
		`const results = {};
		for (const mode of ["prop-same", "setprop-same", "csstext-same", "filter-style", "oldvalue"]) {
			const d = conn(mk("div"));
			d.style.color = "red";
			let n = 0;
			const mo = new MutationObserver(() => {
				n++;
				if (n > 200) { mo.disconnect(); return; }
				if (mode === "setprop-same") d.style.setProperty("color", "red");
				else if (mode === "csstext-same") d.style.cssText = d.style.cssText;
				else d.style.color = "red";
			});
			mo.observe(d, mode === "filter-style"
				? { attributeFilter: ["style"] }
				: mode === "oldvalue" ? { attributes: true, attributeOldValue: true } : { attributes: true });
			d.style.width = "10px";
			await tick(30);
			mo.disconnect();
			results[mode] = n;
		}
		return results;`
	),

	// --- attributes: other layer paths ---------------------------------------

	differential(
		"attr-svg-xlink-href",
		`const svg = svgEl("svg"), use = svgEl("use"), a = svgEl("a"), image = svgEl("image");
		svg.append(use, a, image);
		return watch(svg, ATTRS, () => {
			use.setAttributeNS(XLINK, "xlink:href", "#frag");
			use.setAttributeNS(XLINK, "xlink:href", "/sprite.svg#icon");
			a.setAttributeNS(XLINK, "xlink:href", "/link");
			image.setAttribute("href", "/i.png");
			image.href.baseVal = "/j.png";
			use.removeAttributeNS(XLINK, "href");
		});`
	),
	differential(
		"attr-svg-href-fragment",
		`const svg = svgEl("svg"), use = svgEl("use");
		svg.append(use);
		return watch(svg, ATTRS, () => {
			use.setAttribute("href", "#g");
			use.setAttribute("href", "/s.svg#g");
		});`
	),
	differential(
		"attr-setattributenode",
		`const img = mk("img");
		return watch(img, ATTRS, () => {
			const a = document.createAttribute("src");
			a.value = "/a.png";
			img.setAttributeNode(a);
			a.value = "/b.png";
			const b = document.createAttribute("src");
			b.value = "/c.png";
			img.setAttributeNode(b);
			img.removeAttributeNode(b);
		});`
	),
	differential(
		"attr-namednodemap",
		`const img = mk("img", { alt: "x" });
		return watch(img, ATTRS, () => {
			const a = document.createAttribute("src");
			a.value = "/a.png";
			img.attributes.setNamedItem(a);
			img.attributes.getNamedItem("src").value = "/b.png";
			img.attributes.removeNamedItem("src");
			const n = document.createAttribute("nonce");
			n.value = "zzz";
			img.attributes.setNamedItem(n);
			img.attributes.removeNamedItem("nonce");
		});`
	),
	differential(
		"attr-setattributens-null",
		`const img = mk("img");
		return watch(img, ATTRS, () => {
			img.setAttributeNS(null, "src", "/a.png");
			img.setAttributeNS(null, "src", "/b.png");
			img.removeAttributeNS(null, "src");
			probe(() => img.setAttributeNS("bogus", "xml:src", "/c.png"));
		});`
	),
	differential(
		"attr-meta-refresh",
		`const m1 = mk("meta"), m2 = mk("meta");
		const d = mk("div"); d.append(m1, m2);
		return watch(d, ATTRS, () => {
			m1.setAttribute("http-equiv", "refresh");
			m1.setAttribute("content", "5;url=/next");
			m2.setAttribute("content", "5;url=/other");
			m2.setAttribute("http-equiv", "refresh");
			m2.httpEquiv = "content-type";
		});`
	),
	differential(
		"attr-script-type-change",
		`const s = mk("script");
		s.text = "var __mo_t = location.href;";
		const d = mk("div"); d.append(s);
		return watch(d, ALL, () => {
			s.setAttribute("type", "text/plain");
			s.removeAttribute("type");
			s.type = "module";
			s.setAttribute("language", "javascript");
		});`
	),
	differential(
		"attr-script-src-and-text",
		`const s = mk("script");
		const d = mk("div"); d.append(s);
		return watch(d, ALL, () => {
			s.src = "/x.js";
			s.text = "var y = location;";
			s.setAttribute("src", "/z.js");
			s.removeAttribute("src");
		});`
	),
	differential(
		"attr-readback-in-callback",
		`const img = mk("img"), d = mk("div");
		d.append(img);
		const out = [];
		const mo = new MutationObserver((list) => { out.push(readBack(list)); });
		mo.observe(d, { attributes: true, subtree: true });
		img.setAttribute("src", "/a.png");
		d.style.color = "red";
		img.setAttribute("nonce", "n");
		await tick();
		mo.disconnect();
		return out;`
	),
	differential(
		"attr-connected-subtree",
		`const out = await deliver(document.body, ATTRS, async () => {
			const img = conn(mk("img"));
			img.id = "i";
			img.src = "/missing.png";
			const a = conn(mk("a"));
			a.href = "/x";
			a.style.color = "red";
		});
		return out;`
	),
	differential(
		"attr-record-fields",
		`const img = mk("img");
		const out = watch(img, ATTRS, () => { img.setAttribute("src", "/a.png"); });
		const mo = new MutationObserver(() => {});
		mo.observe(img, ATTRS);
		img.setAttribute("src", "/b.png");
		const [r] = mo.takeRecords();
		mo.disconnect();
		return { out, fields: {
			target: r.target === img,
			added: [r.addedNodes.length, r.addedNodes instanceof NodeList, r.addedNodes === r.addedNodes],
			removed: [r.removedNodes.length, r.removedNodes instanceof NodeList],
			prev: r.previousSibling, next: r.nextSibling,
			keys: Object.keys(r), json: JSON.stringify(r), str: String(r),
			tag: Object.prototype.toString.call(r),
		} };`
	),

	// --- text: script and style children ------------------------------------

	differential(
		"text-script-data",
		`const s = mk("script");
		s.text = "a = location;";
		return watch(s, TEXT, () => {
			s.firstChild.data = "b = top;";
			s.firstChild.data = "c = parent;";
		});`
	),
	differential(
		"text-script-mutators",
		`const s = mk("script");
		s.text = "a = location;";
		const t = s.firstChild;
		return watch(s, TEXT, () => {
			t.appendData(" b = top;");
			t.insertData(0, "window.x; ");
			t.deleteData(0, 3);
			t.replaceData(0, 4, "w.");
			t.nodeValue = "n = location;";
			t.textContent = "tc = top;";
		});`
	),
	differential(
		"text-script-second-child",
		`const s = mk("script");
		s.append("a = location;", "b;");
		return watch(s, TEXT, () => {
			s.lastChild.appendData(" c = top;");
			s.lastChild.data = "d;";
			s.firstChild.data = "e = parent;";
		});`
	),
	differential(
		"text-script-noop-data",
		`const s = mk("script");
		s.text = "a = location;";
		const t = s.firstChild;
		return watch(s, TEXT, () => {
			t.appendData("");
			t.data = t.data;
			t.deleteData(0, 0);
		});`
	),
	differential(
		"text-script-no-oldvalue",
		`const s = mk("script");
		s.text = "a = location;";
		return watch(s, { characterData: true, subtree: true }, () => { s.firstChild.data = "b = top;"; });`
	),
	differential(
		"text-script-observe-text-node",
		`const s = mk("script");
		s.append("a = location;", "b = top;");
		const [one, two] = s.childNodes;
		return {
			first: watch(one, { characterData: true, characterDataOldValue: true }, () => { two.data = "c;"; one.data = "d = location;"; }),
			second: watch(two, { characterData: true, characterDataOldValue: true }, () => { one.data = "e = top;"; two.data = "f;"; }),
		};`
	),
	differential(
		"text-script-splittext",
		`const s = mk("script");
		s.text = "a = location; b = top;";
		return watch(s, TEXT, () => {
			const tail = s.firstChild.splitText(14);
			tail.splitText(4);
		});`
	),
	differential(
		"text-script-normalize-runs",
		`const s = mk("script");
		s.append("a = location;", "b = top;", document.createComment("c"), "", "d;", "e;");
		return watch(s, TEXT, () => { s.normalize(); });`
	),
	differential(
		"text-script-normalize-empty",
		`const s = mk("script");
		s.append("", "a;", "");
		return watch(s, TEXT, () => { s.normalize(); });`
	),
	differential(
		"text-script-removechild",
		`const s = mk("script");
		s.append("a = location;", "b = top;", "c;");
		return watch(s, TEXT, () => {
			s.removeChild(s.childNodes[1]);
			s.firstChild.remove();
		});`
	),
	differential(
		"text-script-append",
		`const s = mk("script");
		s.text = "a = 1;";
		return watch(s, TEXT, () => {
			s.append("b = location;");
			s.appendChild(document.createTextNode("c = top;"));
			s.insertBefore(document.createTextNode("d;"), s.firstChild);
			s.prepend("e;", "f;");
		});`
	),
	differential(
		"text-script-connected-empty",
		`const s = conn(mk("script"));
		return watch(s, TEXT, () => { s.append("var __mo_c = location.href;"); });`
	),
	differential(
		"text-script-connected-appendchild",
		`const s = conn(mk("script"));
		return watch(document.body, TEXT, () => { s.appendChild(document.createTextNode("var __mo_d = top.length;")); });`
	),
	differential(
		"text-script-connected-text-child",
		`const s = mk("script");
		s.append(document.createTextNode(""));
		conn(s);
		return watch(s, TEXT, () => { s.firstChild.data = "var __mo_e = 1;"; });`
	),
	differential(
		"text-script-setters",
		`const s = mk("script");
		s.text = "a = 1;";
		return {
			text: watch(s, TEXT, () => { s.text = "b = location;"; }),
			textContent: watch(s, TEXT, () => { s.textContent = "c = top;"; }),
			innerHTML: watch(s, TEXT, () => { s.innerHTML = "d = parent;"; }),
			innerText: watch(s, TEXT, () => { s.innerText = "e = self;"; }),
			empty: watch(s, TEXT, () => { s.textContent = ""; }),
		};`
	),
	differential(
		"text-script-fragment-insert",
		`const s = mk("script");
		s.text = "a;";
		const f = document.createDocumentFragment();
		f.append("b = location;", document.createElement("i"), "c;");
		return watch(s, TEXT, () => { s.append(f); });`
	),
	differential(
		"text-move-out-of-script",
		`const s = mk("script"), d = mk("div");
		s.append("a = location;", "b = top;");
		const root = mk("section"); root.append(s, d);
		return watch(root, TEXT, () => {
			d.append(s.lastChild);
			d.append(s.firstChild);
			d.firstChild.data = "moved";
		});`
	),
	differential(
		"text-move-into-script",
		`const s = mk("script"), d = mk("div");
		d.append("x = location;");
		s.text = "y;";
		const root = mk("section"); root.append(s, d);
		return watch(root, TEXT, () => { s.append(d.firstChild); });`
	),
	// whole-node ranges only: a boundary offset inside a script's later Text
	// children is refused (review bucket 1 #58), which is not the observer's
	// doing
	differential(
		"text-script-range",
		`const s = mk("script"), t = mk("script");
		s.append("a = location;", "b = top;");
		t.append("c = parent;");
		const root = mk("div"); root.append(s, t);
		return watch(root, TEXT, () => {
			const r = document.createRange();
			r.selectNodeContents(s);
			const frag = r.extractContents();
			const r2 = document.createRange();
			r2.setStart(t, 0);
			r2.insertNode(document.createTextNode("d = top;"));
			const r3 = document.createRange();
			r3.selectNodeContents(t);
			r3.deleteContents();
			return frag;
		});`
	),
	differential(
		"text-script-clone",
		`const s = mk("script");
		s.text = "a = location;";
		const root = mk("div"); root.append(s);
		return watch(root, ALL, () => {
			root.append(s.cloneNode(true));
			root.append(document.importNode(s, true));
		});`
	),
	differential(
		"text-style-data",
		`const st = mk("style");
		st.textContent = ".a { background: url(/a.png) }";
		return watch(st, TEXT, () => {
			st.firstChild.data = ".b { background: url(https://example.com/b.png) }";
			st.firstChild.appendData(" .c{}");
		});`
	),
	differential(
		"text-style-append",
		`const st = mk("style");
		st.textContent = ".a{}";
		return watch(st, TEXT, () => {
			st.append(".b { background: url(/x.png) }");
			st.firstChild.data = ".c{}";
			st.lastChild.data = ".d { background: url(/y.png) }";
		});`
	),
	differential(
		"text-style-connected",
		`const st = conn(mk("style"));
		return watch(st, TEXT, () => {
			st.textContent = "body { --mo: url(/z.png) }";
			st.firstChild.data = "body { --mo: 1 }";
		});`
	),
	differential(
		"text-plain-control",
		`const d = mk("div");
		d.append("a", "b");
		return watch(d, TEXT, () => {
			d.firstChild.data = "c";
			d.lastChild.splitText(0);
			d.normalize();
			d.textContent = "x";
		});`
	),

	// --- the MutationObserver API itself ------------------------------------

	differential(
		"api-shape",
		`const fnInfo = (f) => f && [typeof f, f.name, f.length, Function.prototype.toString.call(f)];
		const protoInfo = (p) => Object.getOwnPropertyNames(p).map((k) => {
			const d = Object.getOwnPropertyDescriptor(p, k);
			return [k, "value" in d ? typeof d.value : "accessor", d.enumerable, d.configurable, !!d.writable,
				fnInfo(d.value || null), fnInfo(d.get || null), fnInfo(d.set || null)];
		});
		return {
			ctor: fnInfo(MutationObserver),
			ctorKeys: Object.getOwnPropertyNames(MutationObserver),
			protoIsCtor: MutationObserver.prototype.constructor === MutationObserver,
			proto: protoInfo(MutationObserver.prototype),
			recordProto: protoInfo(MutationRecord.prototype),
			recordCtor: fnInfo(MutationRecord),
			recordNew: probe(() => new MutationRecord()),
			webkit: typeof window.WebKitMutationObserver,
			desc: Object.getOwnPropertyDescriptor(window, "MutationObserver") && Object.keys(Object.getOwnPropertyDescriptor(window, "MutationObserver")),
		};`
	),
	differential(
		"api-ctor-errors",
		`const tryIt = (f) => { try { f(); return "ok"; } catch (e) { return [e.name, e.message, e instanceof TypeError]; } };
		return [
			tryIt(() => new MutationObserver()),
			tryIt(() => new MutationObserver(1)),
			tryIt(() => new MutationObserver({})),
			tryIt(() => new MutationObserver(null)),
			tryIt(() => MutationObserver(() => {})),
			tryIt(() => MutationObserver.call({}, () => {})),
			tryIt(() => new MutationObserver(class {})),
			tryIt(() => new MutationObserver(() => {}, 1, 2)),
		];`
	),
	differential(
		"api-callback-args",
		`const img = mk("img");
		let got;
		const mo = new MutationObserver(function (list, observer) {
			got = {
				thisIsMo: this === mo,
				secondIsMo: observer === mo,
				args: arguments.length,
				isArray: Array.isArray(list),
				proto: Object.getPrototypeOf(list) === Array.prototype,
				frozen: Object.isFrozen(list),
				len: list.length,
				recordProto: Object.getPrototypeOf(list[0]) === MutationRecord.prototype,
				inst: list[0] instanceof MutationRecord,
				tag: Object.prototype.toString.call(list[0]),
				recs: recs(list),
			};
		});
		mo.observe(img, ATTRS);
		img.setAttribute("src", "/a.png");
		img.setAttribute("alt", "x");
		await tick();
		mo.disconnect();
		return got;`
	),
	differential(
		"api-record-getters",
		`const img = mk("img", { src: "/before.png" });
		const mo = new MutationObserver(() => {});
		mo.observe(img, ATTRS);
		img.setAttribute("src", "/after.png");
		const [r] = mo.takeRecords();
		mo.disconnect();
		const out = {};
		for (const k of Object.getOwnPropertyNames(MutationRecord.prototype)) {
			const d = Object.getOwnPropertyDescriptor(MutationRecord.prototype, k);
			if (!d.get) continue;
			const v = d.get.call(r);
			out[k] = v && typeof v === "object" ? (v === img ? "img" : String(v)) : v;
			out[k + ":bad"] = probe(() => d.get.call({}));
			out[k + ":null"] = probe(() => d.get.call(null));
			out[k + ":reflect"] = probe(() => { const x = Reflect.get(MutationRecord.prototype, k, r); return x && typeof x === "object" ? typeof x : x; });
		}
		out.protoRead = probe(() => MutationRecord.prototype.oldValue);
		return out;`
	),
	differential(
		"api-observe-errors",
		`const d = mk("div");
		const mo = new MutationObserver(() => {});
		const tryIt = (f) => { try { f(); return "ok"; } catch (e) { return [e.name, e.message]; } };
		const out = [
			tryIt(() => mo.observe()),
			tryIt(() => mo.observe(null, { attributes: true })),
			tryIt(() => mo.observe({}, { attributes: true })),
			tryIt(() => mo.observe(d)),
			tryIt(() => mo.observe(d, {})),
			tryIt(() => mo.observe(d, { attributes: false, attributeOldValue: true })),
			tryIt(() => mo.observe(d, { attributes: false, attributeFilter: ["x"] })),
			tryIt(() => mo.observe(d, { characterData: false, characterDataOldValue: true })),
			tryIt(() => mo.observe(d, { subtree: true })),
			tryIt(() => mo.observe(d, 5)),
			tryIt(() => mo.observe(d, { attributeFilter: 5 })),
			tryIt(() => mo.observe(d, { attributeFilter: "src" })),
			tryIt(() => MutationObserver.prototype.observe.call({}, d, { attributes: true })),
			tryIt(() => MutationObserver.prototype.takeRecords.call({})),
			tryIt(() => MutationObserver.prototype.disconnect.call(null)),
		];
		mo.disconnect();
		return out;`
	),
	differential(
		"api-observe-option-reads",
		`const d = mk("div");
		const log = [];
		const opts = {};
		for (const k of ["subtree", "childList", "characterDataOldValue", "characterData", "attributes", "attributeOldValue", "attributeFilter"]) {
			Object.defineProperty(opts, k, { get() { log.push(k); return k === "attributeFilter" ? ["src", "style"] : true; } });
		}
		const filter = { length: 2, 0: "a", 1: "b" };
		const mo = new MutationObserver(() => {});
		mo.observe(d, opts);
		const iterLog = [];
		const it = ["x", "src"];
		it[Symbol.iterator] = function* () { iterLog.push("iter"); yield "src"; yield "style"; };
		mo.observe(d, { attributeFilter: it, attributeOldValue: true });
		d.setAttribute("style", "color: red");
		d.setAttribute("src", "/s");
		d.setAttribute("x", "1");
		const out = { log, iterLog, recs: recs(mo.takeRecords()), arrayLike: probe(() => mo.observe(d, { attributeFilter: filter })) };
		mo.disconnect();
		return out;`
	),
	differential(
		"api-observe-implied-options",
		`const d = mk("div"), t = document.createTextNode("x");
		d.append(t);
		return {
			oldValueOnly: watch(d, { attributeOldValue: true }, () => { d.setAttribute("style", "color: red"); d.style.color = "blue"; }),
			filterOnly: watch(d, { attributeFilter: ["style"] }, () => { d.style.color = "green"; d.setAttribute("id", "q"); }),
			cdOldValueOnly: watch(t, { characterDataOldValue: true }, () => { t.data = "y"; }),
		};`
	),
	differential(
		"api-takerecords",
		`const img = mk("img");
		let calls = 0;
		const mo = new MutationObserver(() => { calls++; });
		mo.observe(img, ATTRS);
		img.setAttribute("src", "/a.png");
		img.style.color = "red";
		const first = recs(mo.takeRecords());
		const second = recs(mo.takeRecords());
		await tick();
		img.setAttribute("src", "/b.png");
		await tick();
		mo.disconnect();
		return { first, second, calls, isArray: Array.isArray(mo.takeRecords()) };`
	),
	differential(
		"api-takerecords-internal-only",
		`const d = mk("div");
		d.style.color = "red";
		let calls = 0;
		const mo = new MutationObserver(() => { calls++; });
		mo.observe(d, { attributes: true });
		d.style.color = "red";
		const taken = recs(mo.takeRecords());
		await tick();
		mo.disconnect();
		return { taken, calls };`
	),
	differential(
		"api-disconnect-drops",
		`const img = mk("img");
		let calls = 0;
		const mo = new MutationObserver(() => { calls++; });
		mo.observe(img, ATTRS);
		img.setAttribute("src", "/a.png");
		mo.disconnect();
		const after = recs(mo.takeRecords());
		await tick();
		mo.observe(img, ATTRS);
		img.setAttribute("src", "/b.png");
		const again = recs(mo.takeRecords());
		mo.disconnect();
		return { calls, after, again };`
	),
	differential(
		"api-reobserve-replaces",
		`const img = mk("img");
		const mo = new MutationObserver(() => {});
		mo.observe(img, { attributes: true, attributeOldValue: true, attributeFilter: ["alt"] });
		mo.observe(img, { attributes: true });
		img.setAttribute("src", "/a.png");
		img.setAttribute("alt", "x");
		const out = recs(mo.takeRecords());
		mo.disconnect();
		return out;`
	),
	differential(
		"api-multiple-registrations",
		`const outer = mk("div"), inner = mk("div"), img = mk("img");
		outer.append(inner); inner.append(img);
		const mo = new MutationObserver(() => {});
		mo.observe(outer, { attributes: true, subtree: true, attributeFilter: ["src"] });
		mo.observe(img, { attributes: true, attributeOldValue: true });
		img.setAttribute("src", "/a.png");
		img.setAttribute("src", "/b.png");
		img.setAttribute("alt", "x");
		const out = recs(mo.takeRecords());
		mo.disconnect();
		return out;`
	),
	differential(
		"api-callback-throws",
		`const img = mk("img");
		const errors = [];
		const onerr = (e) => { errors.push([e.message, e.error && e.error.name, typeof e.filename, e.error && e.error.message]); e.preventDefault(); };
		window.addEventListener("error", onerr);
		let second = 0;
		const mo = new MutationObserver(() => { throw new RangeError("boom"); });
		const mo2 = new MutationObserver(() => { second++; });
		mo.observe(img, { attributes: true });
		mo2.observe(img, { attributes: true });
		img.setAttribute("src", "/a.png");
		await tick();
		window.removeEventListener("error", onerr);
		mo.disconnect(); mo2.disconnect();
		return { errors, second };`
	),
	differential(
		"api-subclass",
		`class Sub extends MutationObserver {
			constructor(cb) { super(cb); this.extra = 1; }
			hello() { return "hi"; }
		}
		const img = mk("img");
		let seen;
		const mo = new Sub(function (list, o) { seen = [this instanceof Sub, o === mo, recs(list)]; });
		mo.observe(img, ATTRS);
		img.setAttribute("src", "/a.png");
		await tick();
		mo.disconnect();
		return {
			inst: mo instanceof Sub, base: mo instanceof MutationObserver, extra: mo.extra, hello: probe(() => mo.hello()),
			proto: Object.getPrototypeOf(mo) === Sub.prototype, seen,
			reflect: probe(() => { class Other {} const r = Reflect.construct(MutationObserver, [() => {}], Other); return [Object.getPrototypeOf(r) === Other.prototype, r instanceof MutationObserver]; }),
		};`
	),
	differential(
		"api-microtask-order",
		`const img = mk("img");
		const order = [];
		const a = new MutationObserver(() => order.push("a"));
		const b = new MutationObserver(() => order.push("b"));
		b.observe(img, { attributes: true });
		a.observe(img, { attributes: true });
		Promise.resolve().then(() => order.push("p1"));
		img.setAttribute("src", "/x.png");
		Promise.resolve().then(() => order.push("p2"));
		img.setAttribute("alt", "y");
		queueMicrotask(() => order.push("q"));
		await tick();
		a.disconnect(); b.disconnect();
		return order;`
	),
	differential(
		"api-microtask-order-script-text",
		`const s = mk("script");
		s.text = "a = location;";
		const img = mk("img");
		const order = [];
		const a = new MutationObserver((l) => order.push("a" + l.length));
		const b = new MutationObserver((l) => order.push("b" + l.length));
		a.observe(img, { attributes: true });
		b.observe(s, TEXT);
		img.setAttribute("alt", "1");
		Promise.resolve().then(() => order.push("p"));
		s.firstChild.data = "b = top;";
		img.setAttribute("alt", "2");
		await tick();
		a.disconnect(); b.disconnect();
		return order;`
	),
	differential(
		"api-mutation-in-callback",
		`const img = mk("img");
		const calls = [];
		let n = 0;
		const mo = new MutationObserver((list) => {
			calls.push(recs(list));
			if (n++ < 2) img.setAttribute("src", "/" + n + ".png");
		});
		mo.observe(img, ATTRS);
		img.setAttribute("src", "/0.png");
		await tick(10);
		mo.disconnect();
		return calls;`
	),
	differential(
		"api-script-text-in-callback",
		`const s = mk("script");
		s.text = "a = location;";
		const calls = [];
		let n = 0;
		const mo = new MutationObserver((list) => {
			calls.push(recs(list));
			if (n++ < 2) s.firstChild.data = "v" + n + " = top;";
		});
		mo.observe(s, TEXT);
		s.firstChild.data = "v0 = parent;";
		await tick(10);
		mo.disconnect();
		return calls;`
	),
	differential(
		"api-batch-one-call",
		`return await deliver(mk("div"), ALL, () => {});`
	),
	differential(
		"api-batch-mixed",
		`const d = mk("div"), img = mk("img"), s = mk("script");
		d.append(img, s);
		s.text = "a = 1;";
		return await deliver(d, ALL, () => {
			img.src = "/a.png";
			d.style.color = "red";
			s.firstChild.data = "b = location;";
			img.alt = "x";
			d.append("tail");
			s.setAttribute("nonce", "q");
		});`
	),
	differential(
		"api-cross-realm",
		`const f = conn(mk("iframe"));
		await new Promise((r) => { if (f.contentDocument && f.contentDocument.readyState === "complete") r(); else f.onload = r; setTimeout(r, 500); });
		const w = f.contentWindow;
		const img = mk("img");
		const inner = new w.MutationObserver(() => {});
		inner.observe(img, ATTRS);
		img.setAttribute("src", "/a.png");
		img.style.color = "red";
		const fromInner = recs(inner.takeRecords());
		inner.disconnect();
		const foreignImg = w.document.createElement("img");
		const outer = new MutationObserver(() => {});
		outer.observe(foreignImg, ATTRS);
		foreignImg.setAttribute("src", "/b.png");
		foreignImg.style.color = "blue";
		const fromOuter = recs(outer.takeRecords());
		outer.disconnect();
		return { fromInner, fromOuter, innerIsInstance: inner instanceof w.MutationObserver };`
	),
	differential(
		"api-callback-realm-array",
		`const f = conn(mk("iframe"));
		await new Promise((r) => { f.onload = r; setTimeout(r, 500); });
		const w = f.contentWindow;
		let got;
		const mo = new w.MutationObserver((list) => {
			got = [list instanceof w.Array, list instanceof Array, list[0] instanceof w.MutationRecord];
		});
		const img = mk("img");
		mo.observe(img, { attributes: true });
		img.setAttribute("alt", "x");
		await tick();
		mo.disconnect();
		return got;`
	),

	// --- leak sweeps ----------------------------------------------------------

	leakSweep(
		"document-ops",
		`const mo = new MutationObserver((list) => scan(list));
		mo.observe(document.documentElement, ALL);
		const root = conn(mk("div"));
		root.id = "sweep";
		const img = mk("img", { src: "/sweep.png", srcset: "/s1.png 1x" });
		const a = mk("a", { href: "/x", target: "_top", onclick: "location.href" });
		const l = mk("link", { rel: "preload", as: "image", href: "/l.png", integrity: "sha256-AAAA" });
		const s = mk("script", { nonce: "abc" });
		s.text = "window.__mo_sweep = location.href;";
		const st = mk("style");
		st.textContent = "#sweep { background: url(/bg.png) }";
		const f = mk("form", { action: "/f" });
		const svg = svgEl("svg"), use = svgEl("use");
		use.setAttributeNS(XLINK, "xlink:href", "/sprite.svg#i");
		svg.append(use);
		root.append(img, a, l, s, st, f, svg);
		img.style.width = "1px";
		a.style.color = "red";
		a.style.color = "red";
		s.setAttribute("type", "text/plain");
		s.removeAttribute("type");
		st.firstChild.data = "#sweep { background: url(/bg2.png) }";
		const s2 = conn(mk("script"), root);
		s2.append("window.__mo_sweep2 = top.length;");
		root.setAttribute("style", "color: blue; background: url(/r.png)");
		root.innerHTML += '<img src="/late.png" style="background: url(/late-bg.png)">';
		await tick(20);
		scan(mo.takeRecords());
		mo.disconnect();
		return "done";`
	),
	leakSweep(
		"iframe-insert",
		`const all = [];
		const mo = new MutationObserver((list) => { scan(list); all.push(...recs(list)); });
		mo.observe(document.body, ALL);
		const f = mk("iframe");
		f.id = "frame";
		conn(f);
		await new Promise((r) => { f.onload = r; setTimeout(r, 500); });
		f.setAttribute("sandbox", "allow-scripts allow-same-origin");
		f.removeAttribute("sandbox");
		void f.contentWindow.document;
		await tick(20);
		f.remove();
		await tick();
		scan(mo.takeRecords());
		mo.disconnect();
		return all;`
	),
	leakSweep(
		"script-insertions",
		`const all = [];
		const mo = new MutationObserver((list) => { scan(list); all.push(...recs(list)); });
		mo.observe(document.body, ALL);
		const a = mk("script");
		a.text = "window.__mo_a = location.host;";
		conn(a);
		const b = conn(mk("script"));
		b.appendChild(document.createTextNode("window.__mo_b = top.length;"));
		const c = mk("script");
		c.append("window.__mo_c = 1;", " window.__mo_c2 = parent.length;");
		conn(c);
		const d = conn(mk("script"));
		d.textContent = "window.__mo_d = location.pathname;";
		const e = mk("script", { type: "module" });
		e.text = "window.__mo_e = import.meta.url.length;";
		conn(e);
		await tick(30);
		scan(mo.takeRecords());
		mo.disconnect();
		return all;`
	),
	leakSweep(
		"attribute-oldvalues",
		`const mo = new MutationObserver((list) => scan(list));
		mo.observe(document.body, { attributes: true, attributeOldValue: true, subtree: true });
		const root = conn(mk("div"));
		root.innerHTML = '<a href="/a" target="_top" onclick="top.x">a</a><img src="/i.png" srcset="/i1.png 1x"><iframe sandbox="allow-scripts" csp="x"></iframe><video poster="/p.png" src="/v.mp4"></video><div style="background: url(/d.png)"></div><form action="/f"></form><object data="/o"></object>';
		for (const el of root.querySelectorAll("*")) {
			for (const n of el.getAttributeNames()) el.setAttribute(n, el.getAttribute(n));
			for (const n of el.getAttributeNames()) el.removeAttribute(n);
		}
		await tick();
		scan(mo.takeRecords());
		mo.disconnect();
		return "done";`
	),
];
