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
