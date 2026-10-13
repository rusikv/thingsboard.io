"""Base vs fix over every /pricing/ interaction: median / p75 / p98 / max per profile, plus labels that got slower.
Usage: python3 summarize-ab.py <runs dir> [profile ...]"""
import json
import statistics as st
import sys
from pathlib import Path

runs = Path(sys.argv[1])
profiles = sys.argv[2:] or ['desktop-1x', 'desktop-4x', 'mobile-4x']


def load(f):
    by = {}
    for r in json.load(open(f))['interactions']:
        if r.get('err') or r['group'] in ('setup', 'calibration'):
            continue
        by.setdefault(r['label'], []).append(r['duration'] or 0)
    return by


def q(a, p):
    return sorted(a)[int(len(a) * p) - 1]


for p in profiles:
    B = [load(f) for f in sorted(runs.glob(f'out-{p}-gpu-base-r*.json'))]
    F = [load(f) for f in sorted(runs.glob(f'out-{p}-gpu-fix-r*.json'))]
    if not B or not F:
        continue
    labels = [l for l in B[0] if all(l in x for x in B + F) and max(B[0][l]) > 0]
    ab = [v for x in B for l in labels for v in x[l]]
    af = [v for x in F for l in labels for v in x[l]]
    print(f'== {p} ({len(B)} base / {len(F)} fix runs): median {st.median(ab):.0f} -> {st.median(af):.0f}  '
          f'p75 {q(ab, .75)} -> {q(af, .75)}  p98 {q(ab, .98)} -> {q(af, .98)}  max {max(ab)} -> {max(af)}')
    worse = []
    for l in labels:
        b = st.median([v for x in B for v in x[l]])
        f = st.median([v for x in F for v in x[l]])
        if f - b > 16:
            worse.append(f'{l} {b:.0f}->{f:.0f}')
    print('   slower by >16 ms:', '; '.join(worse) or 'none')
