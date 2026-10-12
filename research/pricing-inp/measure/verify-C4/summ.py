import json, glob, statistics as st, collections, sys
rows = collections.defaultdict(list)
extra = collections.defaultdict(list)
for f in sorted(glob.glob('ab-*.json')):
    d = json.load(open(f))
    if d.get('error'): print('ERR', f, d['error'][:100])
    for r in d['results']:
        if 'dur' not in r: continue
        k = (d['profile'], r['label'], d['variant'])
        rows[k].append(r['dur'])
        extra[k].append(r.get('loafForced', 0))
    if 'sliderAfterArrows' in d: print(f, 'sliderAfterArrows', d['sliderAfterArrows'])
labels = sorted({(p, l) for p, l, v in rows})
print(f"{'profile':11} {'interaction':38} {'base med (n) [min-max]':28} {'fix med (n) [min-max]':28} {'delta':>6}  forced base/fix")
for p, l in labels:
    b = rows.get((p, l, 'base'), []); x = rows.get((p, l, 'fix'), [])
    if not b or not x: continue
    fb = st.median(extra[(p,l,'base')]); fx = st.median(extra[(p,l,'fix')])
    print(f"{p:11} {l:38} {st.median(b):6.0f} ({len(b):2}) [{min(b):.0f}-{max(b):.0f}]{'':8} {st.median(x):6.0f} ({len(x):2}) [{min(x):.0f}-{max(x):.0f}]{'':8} {st.median(x)-st.median(b):+6.0f}  {fb:.0f}/{fx:.0f}")
