#!/usr/bin/env python3
"""Print a compact first-mismatch summary per failing test from a runway log."""
import json, re, sys
t = open(sys.argv[1]).read()
blocks = re.split(r'\n(?=Test: )', t)
for b in blocks:
    m = re.match(r'Test: (\S+) \.\.\. (.)', b)
    if not m or m.group(2) == '✅': continue
    name = m.group(1)
    msg = b.split('\n')[1].strip() if '\n' in b else ''
    d = b.find('details: ')
    out = msg
    if d >= 0:
        raw = b[d + 9:]
        try:
            det, _ = json.JSONDecoder().raw_decode(raw)
            if isinstance(det, list) and det:
                x = det[0]
                out += f" | {x.get('label')}: sj={json.dumps(x.get('scramjet',{}).get('value'))[:220]} bare={json.dumps(x.get('bare',{}).get('value'))[:220]}"
        except Exception as e:
            out += ' | ' + raw[:200].replace('\n', ' ')
    print(f"{name}\n    {out}")
