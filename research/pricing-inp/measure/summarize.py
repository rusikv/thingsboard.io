#!/usr/bin/env python3
"""Summarise out-*.json files: per-label median/max duration, split, idle cost."""
import json, sys, statistics as st, glob, os, re

DOWN = {'pointerdown', 'mousedown', 'touchstart', 'keydown', 'keypress', 'beforeinput', 'input'}

def split(best):
    """Same-frame split: sum processing of all events of the worst event's phase that share its frame."""
    if not best:
        return None
    evs = []
    for x in best['events']:
        m = re.match(r'(\w+):(\d+)\(d(-?\d+)/p(-?\d+)\)', x)
        if m:
            evs.append((m[1], int(m[2]), int(m[3]), int(m[4])))
    D = best['duration']
    ph = best['worstEvent'] in DOWN
    grp = [e for e in evs if (e[0] in DOWN) == ph and abs(e[1] - D) <= 8]
    if not grp:
        return None
    delay = min(e[2] for e in grp)
    proc = sum(e[3] for e in grp)
    return delay, proc, D - delay - proc

files = sys.argv[1:] or sorted(glob.glob(os.path.join(os.path.dirname(__file__), 'out-*.json')))
for f in files:
    d = json.load(open(f))
    ints = [r for r in d.get('interactions', []) if r.get('group') not in ('setup', 'calibration')]
    meas = [r for r in ints if not r.get('err')]
    durs = [r['duration'] or 0 for r in meas]
    s0 = d.get('state0', {})
    print(f"\n##### {d['tag']}  cpu={d.get('cpu')} dpr={d.get('dpr')} gpu={d.get('gpu')} anim(root={s0.get('rootAnim')},chat={s0.get('chatAnim')}) smilPaused={s0.get('smilPaused')} bgSvgVisible={s0.get('bgSvgVisible')}")
    idle = d.get('idle', {})
    if idle:
        ps = idle['perSecond']; tr = idle['trace']
        print(f"  idle/s: recalc {ps['recalcStyleCount']}x {ps['recalcStyleMs']}ms, layout {ps['layoutCount']}x {ps['layoutMs']}ms, task {ps['taskMs']}ms | 5s trace: BeginMainThreadFrame {tr['beginMainThreadFrame']}, ULT {tr['updateLayoutTree']}, Paint {tr['paint']}, PrePaint {tr['prePaint']}, elems {tr['updateLayoutTreeElementCounts'][:4]}")
    if not meas:
        continue
    srt = sorted(durs)
    # page-level INP proxy: with <50 interactions INP = max; report p98-ish too
    print(f"  n={len(meas)} interactions  max={max(durs)}  median={st.median(durs)}  under16={sum(1 for r in meas if r['under16'])}  calib={d.get('calibration')}")
    by = {}
    for r in meas:
        by.setdefault(r['label'], []).append(r)
    rows = []
    for lab, rs in by.items():
        ds = [r['duration'] or 0 for r in rs]
        w = max(rs, key=lambda r: r['duration'] or 0)
        b = w.get('best') or {}
        sp = split(b) or (b.get('inputDelay'), b.get('processing'), b.get('presentation'))
        rows.append((max(ds), lab, ds, sp[0], sp[1], sp[2], b.get('events'), w))
    rows.sort(key=lambda x: -x[0])
    for mx, lab, ds, dl, pr, pz, evs, w in rows[: int(os.environ.get('TOP', '40'))]:
        loaf = ''
        if w.get('loafs'):
            l = max(w['loafs'], key=lambda l: l['duration'])
            sc = l['scripts'][0] if l['scripts'] else None
            loaf = f" | LoAF {l['duration']}ms script {l['scriptMs']} forcedSL {l['forcedStyleLayoutMs']} renderPre {l['preLayoutMs']} SLP {l['styleLayoutPaintMs']}" + (f" top: {sc['invoker']} ({sc['src'].split('/')[-1]}:{sc['char']}) {sc['ms']}ms" if sc else '')
        print(f"  {mx:5.0f}  {str(ds):16} {lab[:52]:52} delay {dl} proc {pr} pres {pz}{loaf}")
    errs = [r for r in ints if r.get('err')]
    if errs:
        print('  skipped:', [(r['label'], r['err']) for r in errs])
