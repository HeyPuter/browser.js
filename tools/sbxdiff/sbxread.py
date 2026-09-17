#!/usr/bin/env python3
"""Decode an sbxdiff trace (.sbxd).

Wire format is documented in docs/sbxdiff/ARCHITECTURE.md and produced by
third_party/blink/renderer/platform/bindings/sbxdiff/sbx_tracer.cc.

  header := "SBXD" varint(version=4) varint(pid) varint(run_key)
  record := varint(kind) payload
    kIntern(0)      := varint(id) varint(len) bytes
    kBindingCall(1) := u8(level) varint(seq) varint(realm) varint(task)
                       varint(top_script) varint(entry_script)
                       varint(name_id) u8(threw) value(recv) value(result)
                       varint(argc_total) varint(argc_emitted) value*
    kInterceptor(2) := u8(level) varint(seq) varint(realm) varint(task)
                       varint(top_script) varint(entry_script)
                       varint(name_id) u8(key_kind) value(recv)
                       key_kind 0 -> value(key) u8(has_value) [value(written)]
                       key_kind 1 -> varint(index) u8(has_value) [value(written)]
                       key_kind 2 -> (ends here: no has_value byte)
    kRealm(3)       := varint(seq) varint(realm) varint(len) bytes
                       varint(created_us)          # v4 and later
    kInterceptorOutcome(4) := varint(target_seq) u8(intercepted)
    kNetRequest(5)         := varint(seq) varint(task)
                              varint(len) method varint(len) url
    kException(6)          := varint(seq) varint(task) varint(code)
                              varint(msg_len) varint(msg_emitted) bytes
    kScript(7)             := varint(script_id) varint(len) url
  value  := u8(tag) [payload per tag]

Usage:
  sbxread.py <file.sbxd> [--limit N] [--summary] [--names]
"""
import sys
import os
import argparse
from collections import Counter

KINDS = {0: "intern", 1: "binding_call", 2: "interceptor", 3: "realm",
         4: "interceptor_outcome", 5: "net_request", 6: "exception",
         7: "script"}
KEY_KINDS = {0: "name", 1: "index", 2: "none"}
LEVELS = {0: "compared", 1: "internal", 2: "debug"}
TAGS = {
    0: "undefined", 1: "null", 2: "bool", 3: "number", 4: "string",
    5: "bigint", 6: "symbol", 7: "object", 8: "dom", 9: "function",
    10: "proxy", 11: "opaque",
}
# tags carrying an object id, and whether they also carry an interned iface name
OBJ_TAGS = {7: False, 9: False, 10: False, 8: True}


class Reader:
    def __init__(self, buf):
        self.b = buf
        self.i = 0

    def eof(self):
        return self.i >= len(self.b)

    def u8(self):
        v = self.b[self.i]
        self.i += 1
        return v

    def varint(self):
        shift = 0
        out = 0
        while True:
            byte = self.b[self.i]
            self.i += 1
            out |= (byte & 0x7F) << shift
            if not (byte & 0x80):
                return out
            shift += 7

    def raw(self, n):
        v = self.b[self.i:self.i + n]
        self.i += n
        return v


def read_value(r, names):
    tag = r.u8()
    name = TAGS.get(tag, "tag%d" % tag)
    if tag == 2:
        return "%s(%d)" % (name, r.u8())
    if tag == 3:
        import struct
        bits = r.varint()
        (d,) = struct.unpack("<d", struct.pack("<Q", bits))
        return "number(%r)" % d
    if tag == 4:
        total = r.varint()
        emitted = r.varint()
        raw = r.raw(emitted).decode("utf-8", "replace") if emitted else ""
        trunc = "..." if emitted < total else ""
        return "string(%d)%r%s" % (total, raw, trunc)
    if tag in OBJ_TAGS:
        oid = r.varint()
        if OBJ_TAGS[tag]:
            iface = names.get(r.varint(), "?")
            return "dom(#%d %s)" % (oid, iface)
        return "%s(#%d)" % (name, oid)
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="+",
                    help="one or more .sbxd files, or a trace directory")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--summary", action="store_true")
    ap.add_argument("--names", action="store_true")
    args = ap.parse_args()

    # A run produces ONE FILE PER PROCESS. Do not assume the biggest file is the
    # one you want: the page under test often runs in a different renderer than
    # the about:blank/dump-dom infrastructure, whose file is usually larger.
    # Reading the wrong file looks exactly like missing instrumentation.
    import glob as _glob
    paths = []
    for p in args.path:
        paths.extend(sorted(_glob.glob(p + "/trace.*.sbxd")) if os.path.isdir(p)
                     else [p])
    if len(paths) > 1:
        print("%d trace files; decoding each separately\n" % len(paths))
    for p in paths:
        decode(p, args)
    return


def decode(path, args):
    r = Reader(open(path, "rb").read())
    magic = r.raw(4)
    if magic != b"SBXD":
        sys.exit("not an sbxd trace: magic=%r" % magic)
    version, pid, run_key = r.varint(), r.varint(), r.varint()
    print("%s: SBXD v%d pid=%d run_key=%#x  (%d bytes)"
          % (os.path.basename(path), version, pid, run_key, len(r.b)))

    names, calls, shown = {}, Counter(), 0
    levels, recv_kinds, n_records, n_threw = Counter(), Counter(), 0, 0
    n_intercept = 0
    realms, realm_urls, tasks = Counter(), {}, Counter()
    realm_created = {}
    scripts = {}
    outcomes, n_declined = {}, 0
    n_args, n_sets = 0, 0
    n_net, n_net_blocked = 0, 0
    n_exc, exc_codes = 0, Counter()

    while not r.eof():
        try:
            kind = r.varint()
            if kind == 0:
                ident = r.varint()
                names[ident] = r.raw(r.varint()).decode("utf-8", "replace")
            elif kind == 1:
                level = r.u8()
                seq = r.varint()
                realm = r.varint()
                task = r.varint()
                top_script = r.varint()
                entry_script = r.varint()
                name = names.get(r.varint(), "?")
                threw = r.u8()
                recv = read_value(r, names)
                result = read_value(r, names)
                argc_total = r.varint()
                argc_emitted = r.varint()
                argv = [read_value(r, names) for _ in range(argc_emitted)]
                n_records += 1
                n_args += argc_total
                calls[name] += 1
                levels[LEVELS.get(level, level)] += 1
                recv_kinds[recv.split("(")[0]] += 1
                n_threw += bool(threw)
                realms[realm] += 1
                tasks[task] += 1
                if not args.summary and shown < args.limit:
                    shown_args = ", ".join(argv)
                    if argc_total > argc_emitted:
                        shown_args += ", ...+%d" % (argc_total - argc_emitted)
                    print("  [%d] r%-3s t%-5s %-32s recv=%-20s (%s) -> %s%s"
                          % (seq, realm, task, name, recv, shown_args, result,
                             "  THREW" if threw else ""))
                    shown += 1
            elif kind == 2:
                level = r.u8()
                seq = r.varint()
                realm = r.varint()
                task = r.varint()
                top_script = r.varint()
                entry_script = r.varint()
                name = names.get(r.varint(), "?")
                key_kind = r.u8()
                recv = read_value(r, names)
                if key_kind == 0:
                    key = read_value(r, names)
                elif key_kind == 1:
                    key = "index(%d)" % r.varint()
                else:
                    key = "-"
                # Setter/definer interceptors append the value written; reads
                # do not, so read records keep their old size.
                written = None
                if key_kind != 2:
                    if r.u8():
                        written = read_value(r, names)
                        n_sets += 1
                n_records += 1
                n_intercept += 1
                calls[name] += 1
                levels[LEVELS.get(level, level)] += 1
                recv_kinds[recv.split("(")[0]] += 1
                realms[realm] += 1
                tasks[task] += 1
                if not args.summary and shown < args.limit:
                    print("  [%d] r%-3s t%-5s %-32s recv=%-20s key=%s%s"
                          % (seq, realm, task, name, recv, key,
                             "" if written is None else " := " + written))
                    shown += 1
            elif kind == 3:
                seq = r.varint()
                realm = r.varint()
                url = r.raw(r.varint()).decode("utf-8", "replace")
                # v4 appended the realm's creation time, in microseconds on a
                # clock comparable ACROSS PROCESSES. Reading it is not optional
                # for a v4 trace: skipping it leaves the cursor mid-record and
                # the very next varint decodes as a nonsense record kind, which
                # is exactly how this decoder failed -- "unknown record kind
                # 285402408423 at offset 102" on the first realm in the file.
                created_us = r.varint() if version >= 4 else None
                realm_urls[realm] = url
                if created_us is not None:
                    realm_created[realm] = created_us
                if not args.summary:
                    print("  [%d] REALM r%s -> %s%s"
                          % (seq, realm, url or "<empty>",
                             "" if created_us is None
                             else "  created=%.3fms" % (created_us / 1000.0)))
            elif kind == 4:
                # Annotation on an existing interceptor record; carries no seq
                # of its own because it is not a guest-observable event.
                target = r.varint()
                intercepted = r.u8()
                outcomes[target] = bool(intercepted)
                if not intercepted:
                    n_declined += 1
                if not args.summary and shown < args.limit:
                    print("  [%d] ^ interceptor %s"
                          % (target, "INTERCEPTED" if intercepted else "DECLINED"))
            elif kind == 5:
                # Resource request. No realm id: loads are not necessarily
                # inside a v8 context, so ordering comes from seq.
                seq = r.varint()
                task = r.varint()
                blocked = r.u8()
                method = r.raw(r.varint()).decode("utf-8", "replace")
                url = r.raw(r.varint()).decode("utf-8", "replace")
                n_net += 1
                if blocked:
                    n_net_blocked += 1
                if not args.summary and shown < args.limit:
                    print("  [%d] %-5s NET %s %s%s"
                          % (seq, "t%s" % task, method, url,
                             "   BLOCKED (replay miss)" if blocked else ""))
                    shown += 1
            elif kind == 7:
                sid = r.varint()
                scripts[sid] = r.raw(r.varint()).decode("utf-8", "replace")
                continue
            elif kind == 6:
                seq = r.varint()
                task = r.varint()
                code = r.varint()
                mlen = r.varint()
                memit = r.varint()
                msg = r.raw(memit).decode("utf-8", "replace")
                n_exc += 1
                exc_codes[code] += 1
                if not args.summary and shown < args.limit:
                    print("  [%d] t%-5s THROW code=%d %r%s"
                          % (seq, task, code, msg,
                             "..." if mlen > memit else ""))
                    shown += 1
            else:
                sys.exit("unknown record kind %d at offset %d" % (kind, r.i))
        except IndexError:
            print("  (truncated at offset %d -- trailing partial record, "
                  "expected if the process did not flush)" % r.i)
            break

    print("\nrecords: %d (binding=%d interceptor=%d)   interned names: %d   threw: %d"
          % (n_records, n_records - n_intercept, n_intercept, len(names), n_threw))
    print("levels: %s" % dict(levels))
    print("arguments: %d recorded across binding calls; %d interceptor writes "
          "carry a value" % (n_args, n_sets))
    if n_exc:
        print("exceptions: %d thrown; codes %s"
              % (n_exc, dict(exc_codes.most_common(8))))
    if n_net:
        print("network: %d requests, %d blocked by the replay gate "
              "(each blocked request is a divergence, not an error)"
              % (n_net, n_net_blocked))
    if outcomes:
        print("interceptor outcomes: %d recorded, %d declined (kNo), "
              "%d of %d interceptor records annotated"
              % (len(outcomes), n_declined, len(outcomes), n_intercept))
    if tasks:
        named = sum(v for k, v in tasks.items() if k)
        print("tasks: %d distinct ids, %d/%d records attributed to a task"
              % (len([k for k in tasks if k]), named, n_records))
    if realm_urls or realms:
        print("realms:")
        for rid, n in realms.most_common():
            print("  r%-4s %6d records   %s"
                  % (rid, n, realm_urls.get(rid, "<no URL recorded>")))
    print("receiver tags: %s" % dict(recv_kinds))
    if args.names or args.summary:
        print("\ntop 25 by count:")
        for n, c in calls.most_common(25):
            print("  %7d  %s" % (c, n))


if __name__ == "__main__":
    main()
