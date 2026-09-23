// App-shaped browser workloads. Each function returns a stable digest so that
// timings from different implementations are only compared for equal work.
const NS = "http://www.w3.org/2000/svg";
const XLINK = "http://www.w3.org/1999/xlink";

window.runBench.attributesPlain = function () {
	root.replaceChildren();
	const nodes = Array.from({ length: 90 }, () => document.createElement("div"));
	root.append(...nodes);
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 8; pass++)
		for (let i = 0; i < nodes.length; i++) {
			const el = nodes[i];
			el.setAttribute("data-id", String(i));
			el.setAttribute("aria-label", "entry-" + pass + "-" + i);
			el.toggleAttribute("hidden", (pass + i) % 5 === 0);
			digest += el.getAttribute("data-id").length;
			digest += el.hasAttribute("hidden") ? 1 : 0;
			digest += el.getAttributeNames().length;
			if (pass % 2) el.removeAttribute("aria-label");
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.attributesRewritten = function () {
	root.replaceChildren();
	const links = Array.from({ length: 70 }, () => document.createElement("a"));
	root.append(...links);
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 8; pass++)
		for (let i = 0; i < links.length; i++) {
			const a = links[i];
			const href = "https://example.com/catalog/" + i + "?page=" + pass;
			a.setAttribute("href", href);
			a.setAttribute("ping", "https://example.com/ping/" + i);
			digest += a.getAttribute("href").length;
			digest += a.getAttribute("ping").length;
			digest += a.hasAttribute("href") ? 1 : 0;
			digest += a.getAttributeNames().length;
			if (pass % 2) a.removeAttribute("ping");
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.attributesNamespace = function () {
	root.replaceChildren();
	const nodes = Array.from({ length: 60 }, () =>
		document.createElementNS(NS, "use")
	);
	root.append(...nodes);
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 7; pass++)
		for (let i = 0; i < nodes.length; i++) {
			const el = nodes[i];
			const value = "https://example.com/icons.svg#icon-" + i;
			el.setAttributeNS(XLINK, "xlink:href", value);
			el.setAttributeNS(null, "data-state", "state-" + pass);
			digest += el.getAttributeNS(XLINK, "href").length;
			digest += el.hasAttributeNS(XLINK, "href") ? 1 : 0;
			digest += el.getAttributeNodeNS(XLINK, "href").value.length;
			el.removeAttributeNS(XLINK, "href");
			digest += el.hasAttributeNS(XLINK, "href") ? 1 : 0;
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.attributeNodes = function () {
	root.replaceChildren();
	const links = Array.from({ length: 50 }, () => document.createElement("a"));
	root.append(...links);
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 7; pass++)
		for (let i = 0; i < links.length; i++) {
			const a = links[i];
			const node = document.createAttribute("href");
			node.value = "https://example.com/item/" + pass + "/" + i;
			a.setAttributeNode(node);
			const current = a.getAttributeNode("href");
			digest += current.value.length + current.nodeValue.length;
			current.value = "https://example.com/new/" + i;
			digest += a.getAttribute("href").length;
			const removed = a.removeAttributeNode(current);
			digest += removed.value.length;
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.attributeMap = function () {
	root.replaceChildren();
	const links = Array.from({ length: 50 }, () => document.createElement("a"));
	root.append(...links);
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 6; pass++)
		for (let i = 0; i < links.length; i++) {
			const a = links[i];
			a.href = "https://example.com/story/" + i;
			a.setAttribute("data-id", String(i));
			const map = a.attributes;
			digest += map.length;
			digest += map.getNamedItem("href").value.length;
			digest += map[0].name.length;
			digest += Object.keys(map).length;
			for (const attr of map) digest += attr.name.length;
			map.removeNamedItem("data-id");
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.reflectedUrls = function () {
	root.replaceChildren();
	const items = Array.from({ length: 60 }, () => ({
		a: document.createElement("a"),
		img: document.createElement("img"),
		source: document.createElement("source"),
		form: document.createElement("form"),
		button: document.createElement("button"),
		link: document.createElement("link"),
	}));
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 6; pass++)
		for (let i = 0; i < items.length; i++) {
			const x = items[i];
			x.a.href = "https://example.com/products/" + i;
			x.a.search = "?page=" + pass;
			x.a.hash = "#details";
			x.img.src = "https://example.com/images/" + i + ".png";
			x.img.srcset = "https://example.com/small/" + i + ".png 1x";
			x.source.src = "https://example.com/video/" + i + ".mp4";
			x.form.action = "https://example.com/submit/" + i;
			x.button.formAction = "https://example.com/button/" + i;
			x.link.href = "https://example.com/theme/" + i + ".css";
			digest += x.a.href.length + x.a.pathname.length + x.a.search.length;
			digest += x.img.src.length + x.img.srcset.length + x.source.src.length;
			digest +=
				x.form.action.length + x.button.formAction.length + x.link.href.length;
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.markupMethods = function () {
	root.replaceChildren();
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 75; pass++) {
		const host = document.createElement("section");
		host.innerHTML =
			'<a href="https://example.com/a/' +
			pass +
			'">A</a><img src="https://example.com/a.png"><p>text</p>';
		host.insertAdjacentHTML(
			"beforeend",
			'<span data-id="' + pass + '">more</span>'
		);
		host.firstElementChild.outerHTML =
			'<a href="https://example.com/b/' + pass + '">B</a>';
		digest += host.innerHTML.length;
		digest += host.querySelector("a").getAttribute("href").length;
		root.append(host);
	}
	return { ms: performance.now() - start, digest };
};

window.runBench.markupAdvanced = function () {
	root.replaceChildren();
	const parser = new DOMParser();
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 45; pass++) {
		const host = document.createElement("div");
		const shadow = host.attachShadow({ mode: "open" });
		const html =
			'<a href="https://example.com/item/' +
			pass +
			'">Item</a><span>Details</span>';
		shadow.innerHTML = html;
		const doc = parser.parseFromString(
			"<!doctype html><body>" + html + "</body>",
			"text/html"
		);
		digest += shadow.innerHTML.length + doc.body.innerHTML.length;
		if (shadow.getHTML) digest += shadow.getHTML().length;
		if (host.setHTMLUnsafe) {
			host.setHTMLUnsafe(html);
			digest += host.getHTML().length;
		}
		root.append(host);
	}
	return { ms: performance.now() - start, digest };
};

window.runBench.textAndStructure = function () {
	root.replaceChildren();
	const hosts = Array.from({ length: 50 }, () => document.createElement("div"));
	root.append(...hosts);
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 6; pass++)
		for (let i = 0; i < hosts.length; i++) {
			const host = hosts[i];
			const a = document.createElement("span");
			a.textContent = "Item " + pass + "-" + i;
			host.replaceChildren(a);
			const text = a.firstChild;
			text.appendData(" updated");
			text.insertData(0, "New ");
			text.replaceData(0, 4, "Fresh ");
			digest += text.substringData(0, 5).length;
			const copy = host.cloneNode(true);
			host.append(copy.firstChild);
			host.normalize();
			digest += host.textContent.length;
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.rawText = function () {
	root.replaceChildren();
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 70; pass++) {
		const script = document.createElement("script");
		script.type = "application/x-benchmark";
		script.textContent = "const item = location.href;";
		script.append(" const next = item;");
		script.firstChild.appendData(" // end");
		digest +=
			script.text.length + script.innerHTML.length + script.textContent.length;
		const style = document.createElement("style");
		style.textContent =
			".item { background: url(https://example.com/image/" + pass + "); }";
		style.append(" .other { color: red; }");
		digest += style.innerHTML.length + style.textContent.length;
		root.append(script, style);
	}
	return { ms: performance.now() - start, digest };
};

window.runBench.selectorQueries = function () {
	root.replaceChildren();
	const list = document.createElement("div");
	list.innerHTML = Array.from(
		{ length: 160 },
		(_, i) =>
			'<a class="result" data-group="' +
			(i % 8) +
			'" href="https://example.com/r/' +
			i +
			'">Item</a>'
	).join("");
	root.append(list);
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 180; pass++) {
		const group = pass % 8;
		const found = list.querySelectorAll('[data-group="' + group + '"]');
		digest += found.length;
		digest += list.querySelector("a.result").matches("a[href]") ? 1 : 0;
		digest += found[0].closest("div") === list ? 1 : 0;
		digest += list.querySelectorAll("a[href]").length;
	}
	return { ms: performance.now() - start, digest };
};

window.runBench.cssAndNonce = function () {
	root.replaceChildren();
	const divs = Array.from({ length: 60 }, () => document.createElement("div"));
	root.append(...divs);
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 7; pass++)
		for (let i = 0; i < divs.length; i++) {
			const el = divs[i];
			el.setAttribute(
				"style",
				"background:url(https://example.com/bg/" + i + ".png); color: red"
			);
			el.style.setProperty("border-color", "blue");
			el.setAttribute("nonce", "key-" + i);
			digest += el.getAttribute("style").length;
			digest += el.style.cssText.length;
			digest += el.nonce.length;
			digest += el.getAttribute("nonce").length;
			digest += el.hasAttribute("nonce") ? 1 : 0;
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.svgAndMath = function () {
	root.replaceChildren();
	const svg = document.createElementNS(NS, "svg");
	const uses = Array.from({ length: 50 }, () =>
		document.createElementNS(NS, "use")
	);
	svg.append(...uses);
	const math = document.createElementNS(
		"http://www.w3.org/1998/Math/MathML",
		"math"
	);
	root.append(svg, math);
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 7; pass++)
		for (let i = 0; i < uses.length; i++) {
			const use = uses[i];
			use.href.baseVal = "https://example.com/icons.svg#" + i;
			use.setAttributeNS(
				XLINK,
				"xlink:href",
				"https://example.com/other.svg#" + pass
			);
			digest += use.href.baseVal.length + use.href.animVal.length;
			digest += use.getAttributeNS(XLINK, "href").length;
			math.setAttribute("data-pass", String(pass));
			digest += math.getAttribute("data-pass").length;
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.iframeProperties = function () {
	root.replaceChildren();
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 36; pass++) {
		const iframe = document.createElement("iframe");
		iframe.srcdoc = "<!doctype html><title>Widget</title><p>content</p>";
		iframe.sandbox.add("allow-scripts");
		iframe.sandbox.add("allow-same-origin");
		digest += iframe.srcdoc.length + iframe.sandbox.value.length;
		digest += iframe.contentWindow === null ? 1 : 0;
		digest += iframe.contentDocument === null ? 1 : 0;
		iframe.sandbox.remove("allow-scripts");
		root.append(iframe);
		iframe.remove();
	}
	return { ms: performance.now() - start, digest };
};

window.runBench.mapMutations = function () {
	root.replaceChildren();
	const nodes = Array.from({ length: 50 }, () => document.createElement("a"));
	root.append(...nodes);
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 6; pass++)
		for (let i = 0; i < nodes.length; i++) {
			const el = nodes[i];
			const map = el.attributes;
			const href = document.createAttribute("href");
			href.value = "https://example.com/map/" + pass + "/" + i;
			map.setNamedItem(href);
			const data = document.createAttributeNS("urn:app", "app:state");
			data.value = "ready-" + pass;
			map.setNamedItemNS(data);
			digest += map.getNamedItem("href").value.length;
			digest += map.getNamedItemNS("urn:app", "state").value.length;
			digest += map.item(0).name.length;
			map.removeNamedItem("href");
			map.removeNamedItemNS("urn:app", "state");
			digest += map.length;
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.nodeMutations = function () {
	root.replaceChildren();
	const hosts = Array.from({ length: 50 }, () => document.createElement("div"));
	root.append(...hosts);
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 6; pass++)
		for (let i = 0; i < hosts.length; i++) {
			const host = hosts[i];
			host.replaceChildren("head");
			host.prepend("start");
			host.append("end");
			const span = document.createElement("span");
			span.textContent = "middle";
			host.firstChild.after(span);
			span.before("before");
			span.after("after");
			span.replaceWith("replacement");
			host.insertAdjacentText("beforeend", "tail");
			const copy = host.cloneNode(true);
			digest += copy.textContent.length;
			host.normalize();
			digest += host.childNodes.length;
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.mediaAndEmbeds = function () {
	root.replaceChildren();
	const media = Array.from({ length: 45 }, () => ({
		video: document.createElement("video"),
		track: document.createElement("track"),
		object: document.createElement("object"),
		embed: document.createElement("embed"),
		input: document.createElement("input"),
		quote: document.createElement("blockquote"),
	}));
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 6; pass++)
		for (let i = 0; i < media.length; i++) {
			const x = media[i];
			x.video.src = "https://example.com/v/" + i + ".mp4";
			x.video.poster = "https://example.com/p/" + i + ".jpg";
			x.track.src = "https://example.com/t/" + i + ".vtt";
			x.object.data = "https://example.com/o/" + i + ".svg";
			x.embed.src = "https://example.com/e/" + i + ".svg";
			x.input.src = "https://example.com/i/" + i + ".png";
			x.quote.cite = "https://example.com/q/" + pass;
			digest += x.video.src.length + x.video.poster.length + x.track.src.length;
			digest +=
				x.object.data.length +
				x.embed.src.length +
				x.input.src.length +
				x.quote.cite.length;
		}
	return { ms: performance.now() - start, digest };
};

window.runBench.foreignMarkup = function () {
	root.replaceChildren();
	let digest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 70; pass++) {
		const svg = document.createElementNS(NS, "svg");
		svg.innerHTML =
			'<use href="https://example.com/icons.svg#' +
			pass +
			'"></use><foreignObject><a href="https://example.com/page">Page</a></foreignObject>';
		digest += svg.innerHTML.length;
		digest += svg.querySelector("use").getAttribute("href").length;
		const math = document.createElementNS(
			"http://www.w3.org/1998/Math/MathML",
			"math"
		);
		math.innerHTML =
			'<mi>x</mi><mtext><a href="https://example.com/math">Math</a></mtext>';
		digest += math.innerHTML.length;
		root.append(svg, math);
	}
	return { ms: performance.now() - start, digest };
};

class BenchElement extends HTMLElement {
	static observedAttributes = ["href", "data-state"];
	attributeChangedCallback(name, _oldValue, value) {
		window.benchCallbackDigest += name.length + (value?.length ?? 0);
		window.benchCallbackDigest += this.getAttribute(name)?.length ?? 0;
	}
}
customElements.define("bench-element", BenchElement);
window.runBench.customElements = function () {
	root.replaceChildren();
	const nodes = Array.from({ length: 50 }, () =>
		document.createElement("bench-element")
	);
	root.append(...nodes);
	window.benchCallbackDigest = 0;
	const start = performance.now();
	for (let pass = 0; pass < 6; pass++)
		for (let i = 0; i < nodes.length; i++) {
			const el = nodes[i];
			el.setAttribute("href", "https://example.com/custom/" + pass + "/" + i);
			el.setAttribute("data-state", "ready");
			if (pass % 2) el.removeAttribute("data-state");
		}
	return { ms: performance.now() - start, digest: window.benchCallbackDigest };
};

window.runBench.appendElements = function () {
	root.replaceChildren();
	const nodes = Array.from({ length: 6000 }, (_, i) => {
		const row = document.createElement("li");
		row.textContent = "Result " + i;
		return row;
	});
	const list = document.createElement("ul");
	root.append(list);
	const start = performance.now();
	for (const node of nodes) list.append(node);
	let digest =
		list.childElementCount + list.lastElementChild.textContent.length;
	return { ms: performance.now() - start, digest };
};

window.runBench.appendStrings = function () {
	root.replaceChildren();
	const host = document.createElement("div");
	root.append(host);
	const start = performance.now();
	for (let i = 0; i < 6000; i++) host.append("Result " + i);
	const digest = host.childNodes.length + host.textContent.length;
	return { ms: performance.now() - start, digest };
};

window.runBench.appendRawText = function () {
	root.replaceChildren();
	const script = document.createElement("script");
	script.type = "application/x-benchmark";
	const style = document.createElement("style");
	const start = performance.now();
	for (let i = 0; i < 90; i++) {
		script.append("const item" + i + " = location.href;\n");
		style.append(".item" + i + " { color: red; }\n");
	}
	const digest = script.textContent.length + style.textContent.length;
	return { ms: performance.now() - start, digest };
};
