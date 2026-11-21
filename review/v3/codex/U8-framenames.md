### U8-framenames-1. A form inside a shadow root can submit into the child frame instead of its parent

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/shared/htmlRules.ts:273`, `packages/scramjet/packages/core/src/client/dom/targets.ts:109` (HEAD). Upstream `packages/core/src/shared/htmlRules.ts:129`.  
Mechanism: When a served child document carries no parent-frame metadata, HEAD writes `_self` for `<form target="_parent">`. The repair listener is on `window`. A native `submit` event stays inside its shadow root, even an open one. Clicking a submit button or calling `requestSubmit()` therefore misses the repair. Upstream left `form[target]` alone, so the browser resolved `_parent` correctly in a child frame.  
Failure scenario: An embedded checkout renders a form in a declarative shadow root and submits its confirmation into the parent. HEAD loads the confirmation inside the checkout iframe. Chrome replaces the parent document.  
Repro sketch: In a `playwrightTest`, serve a static iframe whose child contains `<div><template shadowrootmode="open"><form target="_parent" action="/done"><button>Finish</button></form></template></div>`. Click the button and assert that the emulated top reaches `/done`. The existing declarative-shadow case exercises a link. Its `click` event crosses the shadow boundary.

### U8-framenames-2. Changing `window.name` changes the proxy URL of the same iframe document

Kind: REGRESSION Confidence: high Impact: visible  
Where: `packages/scramjet/packages/core/src/client/client.ts:630`, `packages/scramjet/packages/core/src/client/client.ts:643`, `packages/scramjet/packages/core/src/shared/htmlRules.ts:170`, `packages/scramjet/packages/core/src/shared/rewriters/url.ts:307` (HEAD). Upstream `packages/core/src/client/client.ts:423`, `packages/core/src/shared/htmlRules.ts:46`.  
Mechanism: A script-assigned iframe `src` includes the emulated top’s live `window.name` in the proxy query parameters. Upstream obtained the top name from the containing iframe element. Assigning `window.name` does not change that element’s `name` attribute, so upstream’s URL stayed stable across the assignment.  
Failure scenario: An application loads `/widget`, sets `window.name` so a helper popup can target its opener, then creates another iframe for `/widget`. HEAD gives the second load a different request URL and browser cache key. Chrome uses the same URL both times. Long application-supplied names also go into both frame parameters when the top creates the iframe.  
Repro sketch: Create and load an iframe with `f.src = "/widget"`, set `window.name = "main"`, then create a second iframe identically. Capture the two iframe document request URLs from Playwright and assert equality. Use the request URLs as the assertion so cache headers and service-worker caching do not affect the result.

### U8-framenames-3. Removing a link’s target during its click can select the wrong base target

Kind: NEW-BUG Confidence: high Impact: visible  
Where: `packages/scramjet/packages/core/src/client/dom/targets.ts:103`, `packages/scramjet/packages/core/src/shared/htmlRules.ts:272` (HEAD).  
Mechanism: The capture listener skips the base whenever the link has a nonempty target. A later click handler can remove that target before Chrome chooses the destination. In a served child document, the base’s real target can still be the service worker’s `_self` fallback. The submit listener already accounts for this ordering by settling the base unconditionally.  
Failure scenario: An embedded page declares `<base target="_top">`. A click handler removes a link’s explicit `_blank` target to continue in the main page. Chrome follows the base and replaces the top document. HEAD can replace only the iframe.  
Repro sketch: Serve a static child iframe containing `<base target="_top"><a href="/done" target="_blank" onclick="this.removeAttribute('target')">Continue</a>`. Click the link and assert that the emulated top reaches `/done` and no popup opens.

### U8-framenames-4. A page-assigned name matching the generated-name pattern reads back as empty

Kind: REGRESSION Confidence: high Impact: contrived  
Where: `packages/scramjet/packages/core/src/client/dom/name.ts:28`, `packages/scramjet/packages/core/src/client/helpers.ts:34` (HEAD). Upstream `packages/controller/src/inject.ts:294` initialized unnamed frames and left subsequent assignments native.  
Mechanism: The getter recognizes a generated name solely by prefix and length. The setter accepts a page-supplied string of the same shape, and the next read hides it.  
Failure scenario: After `window.name = "scramjet-frame-0123456789abcdef"`, HEAD returns `""`. Chrome and upstream return the assigned string.  
Repro sketch: In the emulated top, assign that literal and immediately assert that `window.name` equals it.

**Checked and fine**

- This unit installs **no MutationObserver**. DOM insertion alone incurs no target-repair work. Each document gets capture listeners for clicks and submits. Ordinary clicks do a nearest-link lookup, while targetless link clicks and submits can query `base[target]`.
- Ordinary named links, forms, `_blank`, `_self`, and repeated `window.open(url, "pay")` preserve native target lookup. I found no regression in the usual named OAuth/payment popup reuse path. Subframes and popups retain native `window.name` handling, and naming a child window does not write an iframe `name` attribute.
- For an ordinary light-DOM click, the repair uses the current top name. This covers a nested `_top` link after the page renames its window. `_parent` below the emulated top remains a native keyword. Later commit `f914b6a4` adds coverage for the scripted iframe and renamed-top cases.
- HTML `target` and `formtarget` readback uses the page-written value, including original casing. SVG `target.baseVal` reflection is already recorded as a known failure. I found no additional confirmed `noopener` or `noreferrer` regression in the reading review.
- No builds, browsers, or Runway tests were run.
