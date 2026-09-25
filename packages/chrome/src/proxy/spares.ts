import type { Controller } from "./Controller";

/**
 * Pre-made tab frames, one pool per controller origin, that a proxied page can
 * claim *synchronously* from inside `window.open`.
 *
 * In isolated mode the page and the chrome are cross-origin, so asking the
 * chrome for a new tab is a postMessage round trip - a task too late for
 * `window.open`, which has to hand back a WindowProxy before it returns.
 *
 * The page never needs to wait for the chrome if the frame already exists:
 *
 *  - every spare lives in the chrome's document, so it is a sibling of the
 *    tab frames and the page can reach it with `chromeframe.frames[i]`
 *  - each spare is same-origin with its controller's pages (it loads
 *    `spare.html` off the isolation origin, which replaces itself with an
 *    about:blank that inherits that origin), so the page can read its `name`
 *    to find it and rename it to claim it
 *  - the page then calls the *native* `open(url, spareName)`. Chrome resolves
 *    the name to the sibling frame, is allowed to navigate it because it is
 *    same-origin, and returns its real WindowProxy - and it sets `opener` on
 *    the frame, exactly as it does for a real popup
 *
 * After that the chrome only has to catch up: `adoptSpare` hands the frame to
 * a new tab, which moves it into place with `moveBefore` so its browsing
 * context - and the WindowProxy the page already holds - survives the move.
 */

export const SPARE_PREFIX = "__sj_spare_";
const POOL_SIZE = 2;

const pools = new Map<Controller, HTMLIFrameElement[]>();

let poolContainer: HTMLDivElement | null = null;
function container(): HTMLDivElement {
	if (!poolContainer) {
		poolContainer = document.createElement("div");
		poolContainer.id = "spare-frames";
		poolContainer.style.display = "none";
		document.body.appendChild(poolContainer);
	}
	return poolContainer;
}

export function ensureSpares(controller: Controller) {
	let pool = pools.get(controller);
	if (!pool) {
		pool = [];
		pools.set(controller, pool);
	}

	while (pool.length < POOL_SIZE) {
		const frame = document.createElement("iframe");
		// the name is given at creation - changing the attribute later does
		// not rename the browsing context
		frame.name = SPARE_PREFIX + Math.random().toString(36).substring(2, 10);
		frame.src = controller.prefix.origin + "/spare.html";
		container().appendChild(frame);
		pool.push(frame);
	}
}

/**
 * Take the spare whose window is `win` out of its pool. Null if the window is
 * not a spare - a page claiming a frame the chrome never made.
 */
export function adoptSpare(
	win: Window
): { frame: HTMLIFrameElement; controller: Controller } | null {
	for (const [controller, pool] of pools) {
		const idx = pool.findIndex((f) => f.contentWindow === win);
		if (idx === -1) continue;
		const [frame] = pool.splice(idx, 1);
		ensureSpares(controller);
		return { frame, controller };
	}
	return null;
}
