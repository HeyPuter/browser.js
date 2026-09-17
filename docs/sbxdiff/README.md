# sbxdiff

A differential oracle for the browser.js/scramjet sandbox: run a page in
unmodified Chromium and in the sandbox, and report every divergence in what the
guest can observe.

scramjet runs untrusted pages in a real tab by rewriting JS/HTML/CSS and
mediating platform access through per-property interceptors. **The fidelity of
that mediation is the security property** — anywhere the guest sees something
real Chromium would not show it (the host origin, a proxy URL, host cookies, an
untrapped API, the real `top`/`location`) is a leak. sbxdiff is how that gets
measured instead of argued about.

## Why a patched browser

The naive version is an in-page probe that wraps every accessor and compares.
That is symmetric only if both sides' property descriptors start identical — and
the sandbox's have already been rewritten, so the probe measures itself. Worse,
wrapping a native in a plain function is detectable: it loses `[native code]`,
loses the prototype chain, and anti-bot scripts test exactly that pair.

So the recorder is in C++, below anything the page can reach. Both runs use the
**same patched binary**, so any perturbation the patch introduces cancels in the
diff. That is a much weaker requirement than undetectability, and it is what
makes it affordable to virtualize the clock and pin the PRNG.

## The three pieces

| | where |
| --- | --- |
| **The patched browser** — a tracer in the Blink bindings, realm identity, a keyed PRNG, a virtual clock, and network record/replay | `docs/sbxdiff/patches/` |
| **The harness** — runs a page in both worlds, serves the recorded network store, records what the guest asked scramjet for | `packages/scramjet/packages/runway/src/sbxdiff/`, `.../src/harness/` |
| **The differ** — pairs the two traces per realm and buckets what differs | `packages/scramjet/packages/runway/src/sbxdiff/diff.ts` |

`tools/sbxdiff/sbxread.py` decodes a trace directory. It exists so the wire
format has a reader that is not the differ's — a format with one decoder has no
independent check on that decoder.

## Building the browser

Against Chromium tag **155.0.8050.1**.

The patch set was generated from a trunk checkout whose `chrome/VERSION` reads
155.0.8051.0, and that is a version string with no tag behind it — a tag is cut
at release and 8051 was still in development. Verified against the nearest tag
instead: at 155.0.8050.1 all 72 files apply with no conflict and every hunk
regenerates byte-identical, because the only upstream change to a patched file
in the 170 commits between them is a BUILDFLAG rename elsewhere in
`render_process_host_impl.cc`.

Target the tag. It is reproducible, and a shallow clone can fetch it directly:

```sh
gclient sync --revision src@155.0.8050.1 --no-history
```

```sh
cd src && git apply /path/to/docs/sbxdiff/patches/all.patch
```

`all.patch` is the authoritative artifact and reproduces the built binary; new
files are included with full content. The nine area patches are a disjoint
partition of it and exist for reading, not for applying selectively — see
`patches/README.md`.

72 files, and what is *not* in them is deliberate. The patch records and
replays, pins randomness and the clock, and traces bindings. It does not change
what a web API returns for the sandbox's benefit: a divergence closed by
patching this browser is closed only here, and scramjet has to be right on a
stock one.

The one GN arg that matters:

```gn
sbxdiff = true                       # build the tracer into the generated bindings
enable_blink_bindings_tracing = true
dcheck_always_on = false             # see below
```

`sbxdiff` defaults to `false`, so an unset build is byte-stock Chromium.

**`dcheck_always_on` must be off for real-site runs.** A DCHECK build is ~8x
slower on DOM bindings (measured: 38.4 ms vs 4.9 ms for 20k
`setAttribute`/`getAttribute` pairs, while pure JS was not slower). A browser
that is an order of magnitude slow at DOM is trivially detectable by timing, and
a detectable oracle is not an oracle. Keep a second output directory with
DCHECKs on for development — the value serializer's
`DisallowJavascriptExecutionScope` guard is enforced by one.

`regen.sh` rebuilds the patch set from a Chromium working tree and verifies it:
every patch reverse-applies, the area patches are disjoint, and their
concatenation equals `all.patch`. It discovers DEPS sub-repositories rather than
taking a list, because a hand-maintained list has the same failure mode as the
bug it prevents.

## Reading a result

Divergences are bucketed and tiered.

| tier | meaning |
| --- | --- |
| **T0** | the guest itself observed a sandbox artifact. Never suppressible |
| **T1** | guest-observable value or identity divergence |
| **T2** | below the guest-observation layer — mostly shim overhead |
| **T3/T4** | timing and by-design, counted only |

Three files suppress, and the difference between them is the point:

- `baseline.<host>.json` — T2 and below, recorded by a machine from what it saw.
- `noise.<host>.json` — what the oracle cannot reproduce **against itself**. An
  oracle that cannot reproduce its own run cannot convict the sandbox of
  anything, so this is the number that licenses every other number.
- `structural.<host>.json` — a T0/T1 that is provably unreachable, written by
  hand with a cause, a falsifier and a magnitude bound. Entries are validated and
  a run that exceeds the bound fails.

## What it cannot do

Worth knowing before trusting a number.

- **Replay answers by URL and ordinal.** It cannot grade a request, so an
  endpoint that checks what was posted returns the recorded answer whatever was
  sent. Passing under replay is not evidence of passing live.
- **The tracer never serializes object contents or own keys.** Enumerating keys
  can trip a Proxy trap, and the sandbox hands the guest many Proxies. Identity
  and the page's own access sequence are the signal.
- **Some APIs have no oracle counterpart.** The bindings generator instruments
  Web IDL, so `Function.prototype.toString`, `eval` and `console.*` have no
  binding behind them — the oracle *cannot* record them, which is different from
  not calling them. Those are excluded and counted, never silently dropped.

## Invariants

`patches/README.md` carries the one that has cost the most: a switch the
renderer reads must be added to `::switches::kSbxdiffRendererSwitches`. That
array **is** the relay. Forgetting it produces a silently inert feature, which
happened five separate times in this project and once invalidated a whole
investigation. Never read an sbxdiff switch through a raw string literal.
