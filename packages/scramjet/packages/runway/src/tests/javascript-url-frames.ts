import { basicTest } from "../testcommon.ts";

// A javascript: URL in a frame runs in the frame's realm, which scramjet has
// not installed a client in yet: its rewritten code must not call into one.
const tick = `const tick = (ms) => new Promise((r) => setTimeout(r, ms));`;

const cases: Record<string, string> = {
	"string-src": `const f = document.createElement("iframe"); f.src = "javascript:'<b>yo</b>'"; document.body.appendChild(f); await tick(600); assertConsistent("text", f.contentDocument && f.contentDocument.body && f.contentDocument.body.textContent);`,
	"string-attr": `const f = document.createElement("iframe"); f.setAttribute("src", "javascript:'<p>js</p>'"); document.body.appendChild(f); await tick(600); assertConsistent("text", f.contentDocument && f.contentDocument.body && f.contentDocument.body.textContent);`,
	"void-src": `const f = document.createElement("iframe"); f.src = "javascript:void(0)"; document.body.appendChild(f); await tick(300); f.contentDocument.body.innerHTML = "<b>x</b>"; assertConsistent("text", f.contentDocument.body.textContent); assertConsistent("src", f.src);`,
	"code-src": `window.__jr = 0; const f = document.createElement("iframe"); f.src = "javascript:parent.__jr = 1; void 0"; document.body.appendChild(f); await tick(600); assertConsistent("ran", window.__jr);`,
};

export default Object.entries(cases).map(([name, js]) =>
	basicTest({ name: `javascript-url-frame-${name}`, js: `${tick}\n${js}` })
);
