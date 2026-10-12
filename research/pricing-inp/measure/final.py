import json, sys, statistics as st, re, importlib.util
spec = importlib.util.spec_from_file_location('s', 'summarize.py')
src = open('summarize.py').read().split('files = sys.argv')[0]
ns = {}; exec(src, ns); split = ns['split']
def q(v, p):
    v = sorted(v); k = (len(v) - 1) * p; f = int(k); c = min(f + 1, len(v) - 1); return v[f] + (v[c] - v[f]) * (k - f)
for f in sys.argv[1:]:
    d = json.load(open(f))
    m = [r for r in d['interactions'] if not r.get('err') and r['group'] not in ('setup', 'calibration') and not r['label'].startswith('hover')]
    ds = sorted([r['duration'] or 0 for r in m], reverse=True)
    inp = ds[len(ds) // 50] if ds else None
    print(f"\n## {d['tag']}: n={len(m)} median={st.median(ds):.0f} p75={q(ds,.75):.0f} INP-est(p98 rule)={inp} max={ds[0]} <16ms={sum(1 for r in m if r['under16'])}")
    i = d['idle']; ps = i['perSecond']
    print(f"   idle/s: frames {i['trace']['beginMainThreadFrame']/i['seconds']:.0f}, style recalc {ps['recalcStyleCount']}x {ps['recalcStyleMs']}ms, layout {ps['layoutCount']}x {ps['layoutMs']}ms, renderer task {ps['taskMs']}ms, threads {i.get('threadBusyMsPerSec')}")
    seen = set(); rows = []
    for r in sorted(m, key=lambda r: -(r['duration'] or 0)):
        if r['label'] in seen: continue
        seen.add(r['label']); rows.append(r)
        if len(rows) == 3: break
    for r in rows:
        b = r['best']; sp = split(b)
        same = [x['duration'] for x in m if x['label'] == r['label']]
        l = max(r['loafs'], key=lambda l: l['duration']) if r['loafs'] else None
        att = ''
        if l:
            att = f" LoAF {l['duration']}ms (script {l['scriptMs']}, forced style/layout {l['forcedStyleLayoutMs']}, rAF/pre-layout {l['preLayoutMs']}, style+layout+paint {l['styleLayoutPaintMs']})"
            if l['scripts']:
                s0 = l['scripts'][0]; att += f" top={s0['invoker']} [{s0['src'].split('/')[-1]}:{s0['char']}] {s0['ms']}ms (forced {s0['forcedSL']})"
        print(f"   {r['label']}: {same} -> worst {r['duration']}ms = delay {sp[0]} + processing {sp[1]} + presentation {sp[2]};{att}")
