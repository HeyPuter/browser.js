# Benchmarks

Every tool here runs headless Chromium through the runway harness against the
build in `packages/scramjet/packages/core/dist`, so build first
(`./cv build scramjet controller`). A run compares **modes** on that one build:

| Mode          | What it is                                                   |
| ------------- | ------------------------------------------------------------ |
| `chromium`    | the page loaded directly, no proxy                           |
| `dpsc`        | `jsRewriter: "dpsc"`, the legacy member-key rewrite          |
| `ppsc`        | `jsRewriter: "ppsc"`, the window/document proxy with elision |
| `ppsc-hybrid` | `jsRewriter: "ppsc-hybrid"`, the default                     |
| `<mode>+this` | the same with `ppscWrapThis`                                 |

The flags reach scramjet through the harness (`http://localhost:4500/?flags={...}`
hands them to the frame it creates), so no rebuild is needed to switch modes.
`BENCH_MODES=chromium,dpsc,ppsc-hybrid` picks the modes and `BENCH_FLAGS='{...}'`
adds flags to every scramjet mode. Modes run round-robin with the order rotated
each round (`BENCH_ROUNDS`), so drift over a long run lands on all of them
alike; the tables are medians over rounds. Every run is also appended as a JSON
line to `BENCH_OUTPUT`.

Nothing else heavy should run on the machine at the same time: a second
benchmark, a build or a runway suite moves these numbers by more than most
changes do.

## What to run

| Question                                                   | Tool                                          |
| ---------------------------------------------------------- | --------------------------------------------- |
| Did a change make real apps slower?                        | `benchmark-speedometer.mjs`                   |
| Did it make ordinary JS - calls, `this`, members - slower? | `benchmark-octane.mjs`                        |
| Which operation got slower, and by how much?               | `benchmark-ops.mjs`                           |
| Does it break or slow down real sites?                     | `benchmark-sites.mjs`                         |
| Does the rewriter still produce valid JS, and how fast?    | `capture-script-corpus.mjs` + `native verify` |
| How does the element layer compare with pre-IDL scramjet?  | `benchmark-element.mjs`                       |

### `benchmark-speedometer.mjs`

Speedometer 3.1, one mode per invocation.

```sh
git clone -b release/3.1 https://github.com/WebKit/Speedometer /tmp/speedometer-3.1
SPEEDOMETER_ROOT=/tmp/speedometer-3.1 SPEEDOMETER_SUITES="$(cat tools/benchmark-speedometer-suites.txt)" \
  SPEEDOMETER_VARIANT=rewrite SCRAMJET_FLAGS='{"jsRewriter":"dpsc"}' SPEEDOMETER_LABEL=dpsc \
  node tools/benchmark-speedometer.mjs
```

`SPEEDOMETER_VARIANT=chromium` runs it directly. The suite list leaves out the
two TodoMVC apps that throw under every scramjet build, whose scores would
otherwise be measuring an error path. Speedometer's own confidence interval is
wide (±1 on a score of 17): changes smaller than that need several runs to see.

### `benchmark-octane.mjs`

Octane 2.0 - mostly pure JS with little DOM - which is where a rewrite's cost on
ordinary code shows: wrapped calls, a rebound `this`, renamed members. The
per-test table points at the kind of code a regression is in (RayTrace and
DeltaBlue are method-call heavy; PdfJS leans on a top-level `this`).

```sh
git clone https://github.com/chromium/octane /tmp/octane
OCTANE_ROOT=/tmp/octane node tools/benchmark-octane.mjs
```

### `benchmark-ops.mjs`

Nanoseconds per operation for the shapes real code is made of: document and
window reads, native calls, a global held in a module wrapper's parameter or a
reassigned local, `this` patterns, and a DOM-building loop. Each case is timed
inside the page (`benchmark-ops.html`), calibrated to at least 20ms and reported
as the best of five, so the numbers stay comparable however much faster or
slower a build gets. This is the tool to run first when one of the others moves:
it says which operation did.

```sh
node tools/benchmark-ops.mjs
```

### `benchmark-sites.mjs`

Loads each site in `benchmark-sites.txt` (or the URLs given), lets it settle,
scrolls and moves the mouse, and reads Chromium's ScriptDuration for the tab -
through scramjet that includes the rewriting. It also lists the page errors a
mode threw that loading the site directly did not, which is how a mode that
breaks a site shows up. Sites change daily, so compare modes within one run,
never against another day's.

```sh
node tools/benchmark-sites.mjs                       # the whole list, ~40 minutes
node tools/benchmark-sites.mjs https://discord.com/  # one site
```

### `capture-script-corpus.mjs` and `native verify`

Saves every script the sites load, then rewrites all of them with each
rewriter:

```sh
node tools/capture-script-corpus.mjs /tmp/corpus
cd packages/scramjet/packages/core/rewriter
cargo run --release -p native -- verify /tmp/corpus
```

`verify` fails if any rewritten script no longer parses, and prints ms/MB per
rewriter. It takes any directory of `.js`/`.mjs` - test262's `test/` works too
(files that do not parse to begin with are skipped). The ppsc elision itself is
checked by `cargo test -p native --release elide_diff`, which is a correctness
test, not a benchmark.

## Baseline

Taken on `feat/ppsc-hybrid` on 2026-09-29: headless Chromium 149.0.7827.0,
aarch64 with 18 logical CPUs, nothing else running. Read these as a reference
point for the shape of the costs, not as numbers to match on other hardware.

### Octane (median of 3 rounds; higher is better)

| Test            | chromium |   dpsc |   ppsc | ppsc-hybrid |
| --------------- | -------: | -----: | -----: | ----------: |
| Richards        |    47407 |  47273 |  47707 |       45769 |
| DeltaBlue       |   170307 | 182591 | 187775 |      179378 |
| Crypto          |    84484 |  58661 |  88973 |       86293 |
| RayTrace        |   230951 | 222441 | 230507 |      229323 |
| EarleyBoyer     |   145776 | 127063 | 149418 |      152585 |
| RegExp          |    19982 |  19800 |  20890 |       20254 |
| Splay           |    80148 |  81328 |  35546 |       77824 |
| SplayLatency    |    82367 |  78384 |  23874 |       78361 |
| NavierStokes    |    55243 |  46301 |  54408 |       55001 |
| PdfJS           |   126813 | 115742 | 129083 |      128586 |
| Mandreel        |   103324 |  18405 | 101759 |      104577 |
| MandreelLatency |   155788 |  31753 | 160813 |      155788 |
| Gameboy         |   195598 | 120565 | 198206 |      193182 |
| CodeLoad        |    68530 |  17568 |  15457 |       15079 |
| Box2D           |   221114 | 210792 | 220894 |      221536 |
| zlib            |   151904 |  67918 | 110416 |      107616 |
| Typescript      |   220217 | 201431 | 203683 |      219837 |
| **Score**       |   106908 |  71918 |  85849 |       95934 |

Splay and SplayLatency are bimodal under every scramjet mode - about 80k or
about 33k from one round to the next, dpsc included - which is GC timing, not
the rewrite; they drag the total score around by ±10%. Look at the per-test
rows rather than the total for anything smaller than that. CodeLoad is the
cost of rewriting code that is `eval`ed, which every mode pays. dpsc's losses
on Mandreel, Gameboy, zlib and Crypto are its member-key rewrite on hot typed
array and object code; ppsc leaves those member accesses alone.

### Operations (ns, median of 3 rounds; lower is better)

| Case                                     | chromium |   dpsc |   ppsc | ppsc-hybrid |
| ---------------------------------------- | -------: | -----: | -----: | ----------: |
| control: arithmetic loop                 |      1.2 |    1.2 |    1.2 |         1.2 |
| control: el.setAttribute                 |       62 |    491 |    525 |         504 |
| control: el.className =                  |       33 |     32 |     33 |          33 |
| document.body                            |      6.1 |    6.0 |    5.8 |         6.0 |
| document.title                           |      8.6 |    8.8 |    8.7 |         8.6 |
| document.getElementById                  |       28 |     27 |     47 |          47 |
| document.querySelector                   |       29 |     90 |     95 |          93 |
| document.createElement                   |       66 |     80 |    116 |         126 |
| document.createTextNode                  |       89 |     73 |    106 |         108 |
| document["bo" + "dy"]                    |      6.0 |    5.9 |     19 |          19 |
| el.ownerDocument.body                    |       16 |     17 |     99 |         101 |
| window.&lt;own data property&gt;         |      0.3 |    0.3 |    0.3 |         0.3 |
| window.innerWidth                        |       54 |    453 |    446 |         435 |
| window.parseInt                          |      0.3 |    0.3 |    0.3 |         0.3 |
| window add/removeEventListener           |      253 |    803 |    769 |         757 |
| location.href                            |      155 |   2478 |   2466 |        2594 |
| window.top                               |       66 |     80 |    129 |          85 |
| IIFE param d.createElement               |       66 |     59 |     91 |          91 |
| IIFE param d.body                        |      5.9 |    6.0 |    5.9 |         6.0 |
| IIFE param w.innerWidth                  |       53 |    447 |    443 |         485 |
| reassigned local d.getElementById        |       27 |     27 |     47 |          49 |
| alias on an object o.doc.body            |      6.3 |    6.3 |     17 |          17 |
| el === doc \|\| el.ownerDocument === doc |      5.7 |    5.7 |     80 |          81 |
| this: method returning this              |      2.7 |    2.7 |    2.7 |         2.7 |
| this: var self = this closure            |      1.0 |    1.0 |    1.0 |         1.0 |
| this: constructor setting this[k]        |      5.8 |    5.7 |    5.5 |         5.7 |
| this: fn.apply(this, arguments)          |      1.0 |    1.0 |    1.0 |         1.0 |
| dom: build a 200 node tree               |    88672 | 292187 | 314063 |      314062 |

What the ppsc columns show: a read or call the elision proved safe costs what
it does unproxied (`document.body`, the IIFE parameter reads). What still goes
through the document proxy costs 10-15ns a read (`document[k]`, an alias kept
on an object), and a native method called on the document pays the receiver
fix in the slot dispatch (`getElementById` 27 → 47ns). The worst case is
`el.ownerDocument`, whose getter hands back the document proxy, and which a
jQuery-style identity check hits on every element. `window.innerWidth`,
`location.href` and `setAttribute` are just as slow under dpsc: those costs are
the interceptors', not the rewrite's.
