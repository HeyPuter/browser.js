# Element-layer benchmark — 2026-09-23

Compared production JS bundles from this branch (`36fdce18`) and the parent of
the IDL rewrite (`046df330`) with unproxied native Chromium 149.0.7827.0.
The browser ran headless on an aarch64, 18-CPU machine. Both Scramjet variants
used the same local target page, service-worker harness, Wisp transport, and
Chromium process. The pre-IDL checkout used the installed dependencies and
generated Wasm artifacts from this workspace to build its production bundle.

Each scenario had two warmups and eight timed runs per variant. The entire suite
ran twice with reversed variant order. Numbers below are medians of the 16
browser `performance.now()` measurements, in milliseconds. Navigation, network,
and harness initialization were outside the timed section. `Δ` is rewrite time
relative to pre-IDL; it is omitted where the workloads returned different
checksums or the old implementation failed. Lower is better.

| Workload                                            | Pre-IDL | Rewrite | Native |                       Δ |
| --------------------------------------------------- | ------: | ------: | -----: | ----------------------: |
| Dashboard row updates                               |    52.0 |    61.3 |    2.2 |                    +18% |
| Feed card insertion via `insertAdjacentHTML`        |    59.2 |    60.5 |    7.2 |                     +2% |
| Form field edits                                    |    16.0 |    12.2 |    1.2 |                    −24% |
| Plain attributes                                    |     1.7 |     6.5 |    0.4 |                   +282% |
| Rewritten URL attributes                            |     8.8 |    13.3 |    0.3 |                    +53% |
| Namespace attributes                                |    20.0 |    17.5 |   16.5 |                    −12% |
| Attr nodes                                          |    10.9 |    17.7 |    0.3 |        Different output |
| NamedNodeMap reads and enumeration                  |    10.7 |    14.9 |    0.4 |        Different output |
| Reflected URL properties                            |    45.5 |    84.7 |    8.4 |        Different output |
| innerHTML, outerHTML, insertAdjacentHTML            |    12.1 |    11.0 |    4.0 |                     −8% |
| Shadow DOM, DOMParser, setHTMLUnsafe                |     4.4 |     6.3 |    1.5 |                    +43% |
| Text editing and clone/normalize                    |     1.5 |     5.8 |    3.0 |                   +300% |
| Script/style raw text                               |     1.8 |    12.7 |    0.6 |        Different output |
| Selector queries                                    |     0.7 |     0.9 |    0.7 |                    +29% |
| Style and nonce attributes                          |    10.6 |    14.2 |    1.3 |        Different output |
| SVG href and MathML                                 |    14.3 |    21.4 |   26.7 |                    +50% |
| Iframe srcdoc/sandbox/properties                    |    34.2 |    38.3 |   25.4 |        Different output |
| NamedNodeMap mutations                              |   Error |    17.6 |    0.5 |      Old version errors |
| Node insertion and replacement                      |     1.3 |     9.2 |    1.0 |                   +581% |
| Media, object, embed reflection                     |    21.2 |    38.1 |    2.7 |        Different output |
| SVG/MathML markup                                   |    11.0 |    10.7 |    4.2 |                     −3% |
| Custom-element attribute callbacks                  |     1.3 |     2.4 |    0.7 |                    +81% |
| `append(Element)` for 6,000 list items              |     1.0 |    30.5 |    1.1 |                 +2,945% |
| `append(string)` for 6,000 text nodes               |     1.2 |    20.1 |    1.1 |                 +1,579% |
| `append(string)` to script/style, 90 fragments each |    <0.1 |    34.5 |   <0.1 | Different internal work |

The rewrite and native Chromium returned the same checksum in all 25 workloads.
The pre-IDL build returned different checksums in seven workloads and threw in
the NamedNodeMap mutation workload. A matching checksum is a basic guard against
comparing obviously different work; it does not prove full semantic equivalence.
The small native measurements, particularly those below 2 ms, have limited
precision, so their ratios should be treated as approximate.

The feed case above does **not** time `Element.append`: it times
`insertAdjacentHTML`, which the pre-IDL revision already proxied. The three
isolated append cases were added after the main suite and run with the same
warmup, sample count, and reversed-order method. The pre-IDL revision has its
`Element.append` proxy commented out; the rewrite intercepts it. The raw-text
append case performs additional script/style rewriting in the new layer, so
equal visible-text checksums do not make that latency an equal-work comparison.

These are repeatable app-shaped API workloads, not end-to-end application
benchmarks. They cover attribute methods and nodes, namespaced attributes,
exotic maps, reflected properties, HTML and foreign markup, shadow DOM, text
and raw-text sources, selectors, structural mutation, frames, and custom-element
callbacks. The suite does not cover network fetch timing, layout/paint, live
third-party applications, or every error/coercion edge.

Run with a built pre-IDL checkout at `/tmp/browserjs-preidl-bench` (or set
`PRE_IDL_ROOT`):

```sh
node --experimental-strip-types --no-warnings tools/benchmark-element.mjs
BENCH_REVERSE=1 node --experimental-strip-types --no-warnings tools/benchmark-element.mjs
BENCH_FILTER=append node --experimental-strip-types --no-warnings tools/benchmark-element.mjs
```
