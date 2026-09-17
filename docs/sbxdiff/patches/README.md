# Patch set

Against Chromium tag **155.0.8050.1** (see `../README.md` for why the tag and
not the 155.0.8051.0 that `chrome/VERSION` reports). Regenerated from the
working tree and verified: every patch reverse-applies against it, the nine
area patches are a **disjoint partition** of the 72 changed files, and their
concatenation equals `all.patch`.

## Applying

```sh
gclient sync --revision src@155.0.8050.1 --no-history   # if starting fresh
cd src && git apply /path/to/all.patch
```

**Apply after the last `gclient sync`, not before.** Two of the files are in
DEPS sub-repositories — `third_party/boringssl/src/crypto/rand/getentropy.cc`
and `third_party/webrtc/rtc_base/crypto_random.cc` — and a sync checks those out
fresh, silently discarding both. That is not hypothetical: the BoringSSL entropy
pin was listed in `07-determinism` from the day it was written and contributed
nothing to the patch set for the life of the project, because the outer
`git diff` cannot see inside a sub-repository. `regen.sh` discovers them now
rather than taking a list, and the run prints the file count so a silent loss
shows up as 70 where it should say 72.

`all.patch` is the authoritative artifact — it reproduces the built binary.
New files are included with full content, so there is nothing to copy in
separately. (An earlier `sbxdiff-sources/` directory of loose new files has been
removed: it was flat, had drifted, and was missing `sbxdiff_net_replay.*`.)

## The area patches

Each touches a disjoint set of files, so any subset applies cleanly in any
order. They will not necessarily _build_ in isolation — `03` carries the switch
definitions the rest read, and `04` carries the tracer everything else calls.

| Patch                   | What                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `01-host-build-fixes`   | macOS CLT toolchain detection; headless `CGWindowID` DCHECK. Local build enablement, no oracle semantics. |
| `02-undetectability`    | drops the `HeadlessChrome` UA token during a trace run                                                    |
| `03-base-and-switches`  | every `--sbxdiff-*` switch, and the renderer relay array                                                  |
| `04-tracer`             | the tracer itself, plus exception recording                                                               |
| `05-bindings-generator` | `bind_gen` emits the binding/interceptor scopes                                                           |
| `06-realm-identity`     | realm ids for windows, workers and worklets                                                               |
| `07-determinism`        | keyed PRNG, web-crypto keystream, pinned initial time, virtual-time fence                                 |
| `08-runner`             | `--sbxdiff-run` in-binary driver, clicks, screenshots                                                     |
| `09-network`            | request records, the allow-list gate, body record and replay                                              |

## The relay array

If you add a switch the renderer reads, add it to
`::switches::kSbxdiffRendererSwitches` in `base/base_switches.h`. That array
**is** the relay — `render_process_host_impl.cc` iterates it. Forgetting this
produced a silently inert feature five separate times in this project, once
invalidating a whole investigation. Never read an sbxdiff switch through a raw
string literal.
