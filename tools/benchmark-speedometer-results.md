# Speedometer 3.1 — 2026-09-23

Ran the official [Speedometer 3.1](https://browserbench.org/Speedometer3.1/)
release (`WebKit/Speedometer` branch `release/3.1`, commit `1386415`), served
locally without changing its sources. Compared pre-IDL Scramjet (`046df330`),
the element rewrite (`36fdce18`), and native Chromium 149.0.7827.0. The
machine was aarch64 with 18 logical CPUs. All runs used headless Chromium at
1280×900, the benchmark's default RAF measurement method, and its default 10
iterations. Higher scores are better.

Each variant ran twice, with the variant order reversed on the second pass.
Numbers below are Speedometer's scores and its own confidence intervals, not
timings collected by Playwright.

| Suite set               | Run | Native Chromium |     Pre-IDL |     Rewrite |
| ----------------------- | --: | --------------: | ----------: | ----------: |
| Full default, 20 suites |   1 |      33.3 ± 1.9 | 16.2 ± 0.79 | 13.9 ± 0.83 |
| Full default, 20 suites |   2 |      30.7 ± 1.7 | 15.0 ± 0.93 | 13.2 ± 0.72 |
| Clean subset, 18 suites |   1 |      32.8 ± 2.1 | 17.0 ± 0.95 | 15.2 ± 0.71 |
| Clean subset, 18 suites |   2 |      31.0 ± 1.9 | 17.1 ± 0.60 | 15.8 ± 0.56 |

**The full-suite proxy scores have a correctness caveat.** Both Scramjet
variants logged `TypeError: Cannot set properties of null (setting 'className')`
in `TodoMVC-JavaScript-ES5` and
`TodoMVC-JavaScript-ES6-Webpack-Complex-DOM`; native Chromium did not. The
error occurs in the apps' filter-link selection code. Speedometer still emitted
scores and all 206 metric entries, but those two apps did not run without
errors. The full scores are diagnostic, not a clean performance comparison.

The **clean subset** used all default suites except those two. Each of its six
runs completed 10 iterations, produced 186 metric entries, and logged no page
errors after ignoring the same Wake Lock denial and SVG `NaN` console messages
observed in native Chromium. Its two-run average was **15.5 for the rewrite,
17.05 for pre-IDL, and 31.9 for native**. The rewrite score was about **9%
lower** than pre-IDL in this subset.

Per-suite mean duration, averaged across the two clean-subset runs (ms; lower
is better):

| Suite                 | Native | Pre-IDL | Rewrite | Rewrite change |
| --------------------- | -----: | ------: | ------: | -------------: |
| React Stockcharts SVG |   66.9 |   116.2 |   163.8 |           +41% |
| Svelte complex DOM    |   11.5 |    16.6 |    22.8 |           +37% |
| Preact complex DOM    |   12.3 |    16.3 |    21.1 |           +30% |
| Perf Dashboard        |   47.4 |    84.5 |    95.2 |           +13% |
| NewsSite Nuxt         |   49.0 |    83.6 |    92.8 |           +11% |
| NewsSite Next         |   58.0 |   127.7 |   127.7 |            ~0% |
| Vue                   |   18.2 |    31.9 |    30.7 |            −4% |
| Lit complex DOM       |   15.4 |    32.2 |    28.8 |           −10% |
| Backbone              |   21.1 |    53.9 |    48.2 |           −11% |

The remaining clean-subset suites fell between these changes; inspect the raw
metric JSON for individual steps. Stockcharts, Svelte, and Preact were slower
in the rewrite in **both** run orders. Suite timings include application and
rendering work, so they do not isolate the element layer by themselves.

Raw results are in `/tmp/speedometer-results/{order1,order2,filtered,filtered-order2}`.
The runner is `tools/benchmark-speedometer.mjs`. For a clean-subset run with
the same local Speedometer release and built pre-IDL checkout:

```sh
SPEEDOMETER_SUITES="$(cat tools/benchmark-speedometer-suites.txt)" \
SPEEDOMETER_VARIANT=rewrite SPEEDOMETER_ITERATIONS=10 \
node --experimental-strip-types --no-warnings tools/benchmark-speedometer.mjs
```

## HTML rule-scan optimization

After the selector-mirror fix, a clean full 10-iteration rewrite run scored
**13.2 ± 0.72**, with no page errors. A Chrome CPU profile of a 10-iteration
TodoMVC-jQuery run placed 651 samples in `traverseParsedHtml`, 414 in
`traverseChildren`, 194 in the HTML parser, and 125 in interceptor installation.
The selector proxy was not a material CPU hotspot in that run. This is sampled
CPU time, not a breakdown of Speedometer's score.

The HTML rewriter now caches its ordered rule keys and tests whether an element
has the attribute before checking whether its tag is eligible. The rule
functions, their order, and the parser are unchanged. An unprofiled A/B run of
TodoMVC-jQuery on the same built branch measured **2.14 ± 0.16** before and
**2.75 ± 0.096** after (higher is better); mean suite duration fell from
473 ms to 364 ms over 10 iterations. Two full default 10-iteration runs after
the change scored **14.2 ± 0.74** and **14.0 ± 0.56**, both with no page
errors. These were separate runs, so the full-suite score difference includes
normal run-to-run variation.

Raw records: `/tmp/speedometer-results/{selector-fix-full,baseline-unprofiled,opt-jquery,html-opt-full,html-opt-final}`.
CPU profiles: `/tmp/speedometer-rewrite.cpuprofile` and
`/tmp/speedometer-jquery.cpuprofile`. Set `SPEEDOMETER_CPU_PROFILE` to write a
Chrome CPU profile from the runner.

## Event-attribute check

A second profile of the optimized TodoMVC-jQuery run still placed HTML
traversal above the other Scramjet work: 254 samples in
`traverseParsedHtml`, 134 in `traverseChildren`, 174 in the tokenizer, and
129 in interceptor installation. The rewriter had been searching its list of
roughly 100 event-handler attributes for every parsed attribute. It now tests
the `on` prefix first, then uses the same list and rewrite path for matching
names.

Two unprofiled 10-iteration jQuery runs with the prefix check scored **2.77**
and **2.79**; two runs without it scored **2.63** and **2.65**. Mean suite time
across those runs was **361 ms** with the check and **381 ms** without it.
The full default 10-iteration suite scored **14.1 ± 0.64** after the change,
within the range of the previous 14.0–14.2 runs, and logged no page errors.
All 62 markup escape tests passed.

Raw records: `/tmp/speedometer-results/{pass2-baseline,pass2-baseline-repeat,pass2-prefilter,pass2-prefilter-repeat,pass2-full}`.
CPU profile: `/tmp/speedometer-pass2-jquery.cpuprofile`.

## Native-wrapper class cache

A profile of Stockcharts, Preact, and Svelte put 410 samples in interceptor
installation and 136 in the `client.native` property lookup. That lookup was
creating a new internal wrapper class for every `client.native.Element`,
`client.native.Node`, and similar access. The class only closes over the
client's fixed native descriptor table, so each client now caches one class
per interface name. The wrapper instance and its native method proxies still
work as before.

In paired, unprofiled 10-iteration runs of those three suites, scores were
**25.5** and **25.2** without the cache, versus **28.4** and **27.6** with it.
Two full default 10-iteration runs with the cache scored **15.0 ± 0.96** and
**15.5 ± 0.51**, both with zero page errors; the preceding full runs scored
14.0–14.2. The broad element-layer tests had 65 passes and the same two
expected failures; all 62 markup escape tests and both selector regressions
passed.

Raw records: `/tmp/speedometer-results/{pass3-baseline,pass3-baseline-repeat,pass3-cache,pass3-cache-repeat,pass3-full,pass3-full-repeat}`.
Profiles: `/tmp/speedometer-pass3.cpuprofile` and
`/tmp/speedometer-pass3-cache.cpuprofile`.
