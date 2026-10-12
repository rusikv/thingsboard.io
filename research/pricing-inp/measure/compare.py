import json, sys, statistics as st, re
files = sys.argv[1:]
data = []
for f in files:
    d = json.load(open(f))
    by = {}
    for r in d['interactions']:
        if r.get('err') or r['group'] in ('setup', 'calibration'): continue
        by.setdefault(r['label'], []).append(r['duration'] or 0)
    data.append((d['tag'], by, d))
labels = [l for l in data[0][1]]
for _, by, _ in data[1:]:
    for l in by:
        if l not in labels: labels.append(l)
print('label'.ljust(50), ' | '.join(t[:26].rjust(26) for t, _, _ in data))
common = [l for l in labels if all(l in by for _, by, _ in data)]
for l in labels:
    cells = []
    for _, by, _ in data:
        v = by.get(l)
        cells.append((f"{st.median(v):.0f} (max {max(v)})" if v else '-').rjust(26))
    print(l[:50].ljust(50), ' | '.join(cells))
print('MEDIAN of per-label medians (common labels):'.ljust(50), ' | '.join(f"{st.median([st.median(by[l]) for l in common]):.0f}".rjust(26) for _, by, _ in data))
print('MAX over common labels:'.ljust(50), ' | '.join(f"{max(max(by[l]) for l in common):.0f}".rjust(26) for _, by, _ in data))
