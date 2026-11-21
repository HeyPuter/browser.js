### U3-rewriter-asi-1. Stamping a parenthesized call can merge `return` with the helper name

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/rewriter/js/src/changes.rs:380` (HEAD), `packages/core/rewriter/js/src/visitor.rs:581` (upstream)  
Mechanism: The non-optional literal-call rewrite inserts a bare helper identifier directly before the callee. If the original callee starts with `(`, the source needs no whitespace between it and a preceding keyword. The inserted identifier does. Neither ASI fix covers a call inside a return expression.  
Failure scenario: In `stamp` mode, `function read(){return(0,getValue)()}` starts its rewritten body with the single identifier `return$scramjet$call`. Calling `read()` throws a `ReferenceError`. Chrome and upstream return the result of `getValue`. The `(0,fn)()` shape occurs in bundled code.  
Repro sketch: Serve `const getValue=()=>7; function read(){return(0,getValue)()} document.title=String(read())` in a `playwrightTest` with `stamp` enabled. Assert the title is `"7"`.

### U3-rewriter-asi-2. A stamped optional call can suppress a required `TypeError` on the next property read

Kind: REGRESSION Confidence: high Impact: visible  
Where: `packages/scramjet/packages/core/rewriter/js/src/visitor.rs:608` (HEAD), `packages/core/rewriter/js/src/visitor.rs:548` (upstream)  
Mechanism: HEAD changes an ordinary property access following a potentially short-circuiting stamped call into `?.`. Once the helper returns, that check cannot distinguish a skipped call from a method that ran and returned `undefined` or `null`.  
Failure scenario: For `port?.postMessage().status`, a missing `port` gives `undefined` in Chrome. A present `port` whose method returns `undefined` throws on `.status`. HEAD returns `undefined` in both cases under `stamp` and `lazystamp`, bypassing any error handler.  
Repro sketch: In `lazystamp` mode, serve a function evaluating that expression inside `try`/`catch`. Call it with `null` and with `{postMessage(){}}`. Assert the first returns `undefined` and the second catches a `TypeError`.

### U3-rewriter-asi-3. Calling a parenthesized optional member can skip argument side effects

Kind: REGRESSION Confidence: high Impact: contrived  
Where: `packages/scramjet/packages/core/rewriter/js/src/changes.rs:53`, `packages/scramjet/packages/core/rewriter/js/src/visitor.rs:699` (HEAD), `packages/core/rewriter/js/src/visitor.rs:581` (upstream)  
Mechanism: For `(obj?.method)(arg)`, the nullish branch emits `(void 0)()` immediately. Chrome evaluates `arg` before throwing for the non-callable value. Parentheses end the optional chain before argument evaluation.  
Failure scenario: With `obj = null`, `(obj?.method)(++count)` leaves `count` at zero in `stamp` mode. Chrome and upstream increment it to one.  
Repro sketch: Serve `let count=0; try {(null?.method)(++count)} catch(e) {document.title=e.name+":"+count}` with `stamp` enabled. Assert `"TypeError:1"`.

### U3-rewriter-asi-4. Stamped member calls introduce quadratic work on large bundles

Kind: DESIGN-CONCERN Confidence: high Impact: visible  
Where: `packages/scramjet/packages/core/rewriter/js/src/visitor.rs:608`, `:737`, `:746` (HEAD)  
Mechanism: `split_members` is a vector shared across the entire script. The call visitor appends spans, and every non-optional member visit linearly searches the accumulated spans. Nothing removes them when the visitor finishes a call. In `stamp` mode, even a flat sequence of independent `obj.m()` calls performs a quadratic number of span comparisons.  
Failure scenario: Doubling the number of ordinary calls in a generated bundle roughly quadruples this part of rewrite work before the script can execute. The wall-clock cost is unmeasured.  
Repro sketch: Generate scripts containing 1,000 and 2,000 consecutive `obj.m()` statements. In a native rewriter test, count span comparisons in `stamp` mode. Assert linear growth after fixing the lookup. A comparison count avoids a timing-dependent Runway assertion.

### U3-rewriter-asi-5. Trivia before the opening parenthesis still breaks direct `eval` and dynamic `import`

Kind: PRE-EXISTING Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/rewriter/js/src/visitor.rs:665`, `:802` (HEAD)  
Mechanism: Direct `eval` inserts its argument wrapper one byte after the identifier. Dynamic `import` replaces the first seven bytes. Both offsets assume `(` immediately follows the keyword or identifier.  
Failure scenario: `eval ("1+1")` places the helper between `eval` and its opening parenthesis. `import /* chunk */ ("./m.js")` consumes the space and leaves an unmatched opening parenthesis in the rewritten call. Both inputs are valid in Chrome.  
Repro sketch: Serve the two expressions in separate scripts so a parse error in one cannot mask the other. Assert the eval script records `2` and the import script records the fixture module’s default export.

### U3-rewriter-asi-6. The native `dump` command discards the parser diagnostic on fatal input

Kind: NEW-BUG Confidence: high Impact: contrived  
Where: `packages/scramjet/packages/core/rewriter/native/src/main.rs:190` (HEAD)  
Mechanism: `dump` collects Oxc’s errors into a string and then panics with the constant `oxc panicked`. The string never reaches stderr. This affects the reviewer-facing CLI.  
Failure scenario: Dumping an unterminated function produces a generic panic precisely when the parser’s explanation would help diagnose a rewrite fixture.  
Repro sketch: A native CLI test can pass a file containing `function f(`, assert a failing exit status, and assert stderr includes the parser’s diagnostic.

**Checked and fine**

- `fb97bd59` protects rewritten expression starts in actual statement lists, including switch consequents. It leaves single-statement `if`, loop, and label bodies attached to their owners.
- `0bab40f9` fixes the concise-arrow regression introduced by that separator. It also preserves a `debugger` statement’s syntactic position and moves the generated `for…of` body closer after the body’s own rewrites.
- The program prelude uses the parsed directive list, preserves a final directive that relied on ASI, and retains directive-only eval completion. The ordinary hashbang, EOF hashbang, and leading HTML-close-comment paths account for line termination.
- I found no additional ASI regression specific to class fields, `let` used as an identifier, or the original continuation starters `(`, `[`, template literal, `+`, `-`, and `/`. The token-merging regression above concerns a rewrite _inside_ an expression.
- Static module rewriting places the fragment after the proxy query and uses the supplied initiator origin. The native `dump` branch is separate from production rewriting.

This was a reading review. No Runway tests, builds, browsers, or Cargo commands were run.
