import json, re
src = open('summarize.py').read().split('files = sys.argv')[0]
ns = {}; exec(src, ns); split = ns['split']
SEL = {
 'baseline: click empty background': 'div.pricing-page background (no handler)',
 'sub-tab: Cloud -> Private Cloud': '.sub-tab[data-subtab=thingsboard-private-cloud]',
 'sub-tab: Private Cloud -> On-premises': '.sub-tab[data-subtab=thingsboard-pe]',
 'sub-tab: On-premises -> Cloud': '.sub-tab[data-subtab=thingsboard-cloud] (center hits its .sub-tab-info icon)',
 'region: label -> Europe': '.region-toggle-label[data-region=eu]',
 'region: switch (checkbox)': '.region-toggle-switch',
 'upsell: See Private Cloud Options (switch tab)': '.upsell-card-btn[data-switch-to]',
 'top-up accordion toggle': '.topup-header',
 'PC billing: -> Annual': '.billing-toggle[data-toggle-id=tb-pc-billing] .billing-toggle-label[data-value=annual]',
 'On-prem billing: -> Perpetual': '.billing-toggle[data-toggle-id=tb-sm-billing] .billing-toggle-label[data-value=perpetual]',
 'PC calculator: open #2': 'PC .upsell-card-btn[onclick=openTbPcCalc] (chunk cached)',
 'PC calc: click slider track @0.35': '#tb-pc-calc .calc-slider',
 'PC calc: type digit into devices': '#tb-pc-calc .calc-number-input (keydown digit)',
 'PC calc: add-on switch': '#tb-pc-calc .calc-toggle (Edge)',
 'PC calc: stepper +': '#tb-pc-calc .calc-stepper-btn[data-action=increment]',
 'PAYG calculator: open #2': 'On-prem .upsell-card-btn[onclick=openTbPaygCalc] (chunk cached)',
 'PAYG calc: click slider track @0.75': '#sm-slider (pointer on track)',
 'PAYG calc: slider ArrowRight': '#sm-slider (keyboard ArrowRight)',
 'PAYG calc: type digit into devices': '#sm-devices (keydown digit)',
 'PAYG calc: Edge add-on switch': '#sm-edge-toggle label (.calc-toggle); also blurs #sm-devices',
 'PAYG calculator: close #2': '.calc-modal-close',
 'FAQ: category tab -> 2nd': '.faq-cat-tab',
 'FAQ: expand/collapse item': '.faq-question-toggle',
 'FAQ: Load more': '.faq-load-more',
 'feature (i) click -> jump to FAQ': '.plan-card .plan-feature-info (scrolls to FAQ)',
 'hover: plan feature (i) tooltip': '.plan-feature-info (mouse hover only)',
 'header: hover "Products" (mega-menu open)': 'nav.head-menu > ul > li[data-submenu-id] (hover)',
 'header: click "Products" label (desktop no-op)': 'span.main-menu-link',
 'header: burger open': 'header .burger',
 'header: expand "Products" in drawer': 'span.main-menu-link (mobile drawer)',
 'theme toggle': '.theme-toggle-btn',
}
PROF = {
 'out-desktop-1x-gpu.json': 'desktop-1x (GPU raster on)',
 'out-desktop-4x-gpu.json': 'desktop-4x (GPU raster on)',
 'out-mobile-4x-gpu.json': 'mobile-4x (412x823 dpr1.75, touch, GPU raster on)',
 'out-mobile-4x-3pblocked-gpu.json': 'mobile-4x-3p-blocked',
 'out-mobile-4x-noanim-nosmil-gpu.json': 'mobile-4x, all animations stopped (CSS anim none + SMIL paused)',
 'out-desktop-4x-quick-dropscriptrule-gpu.json': 'desktop-4x, Starlight :has(~script:last-child) rule deleted (1 rep)',
 'out-mobile-4x-quick-reducedmotion-dropscriptrule-gpu.json': 'mobile-4x, prefers-reduced-motion + that rule deleted (1 rep)',
}
ONLY = {
 'out-desktop-1x-gpu.json': ['baseline: click empty background','sub-tab: Cloud -> Private Cloud','region: label -> Europe','PC calc: click slider track @0.35','PAYG calc: slider ArrowRight','PAYG calc: type digit into devices','FAQ: category tab -> 2nd','theme toggle','hover: plan feature (i) tooltip'],
 'out-desktop-4x-gpu.json': ['baseline: click empty background','sub-tab: Cloud -> Private Cloud','sub-tab: Private Cloud -> On-premises','region: label -> Europe','On-prem billing: -> Perpetual','PC billing: -> Annual','top-up accordion toggle','PC calculator: open #2','PC calc: click slider track @0.35','PC calc: type digit into devices','PC calc: add-on switch','PAYG calculator: open #2','PAYG calc: slider ArrowRight','PAYG calc: click slider track @0.75','PAYG calc: Edge add-on switch','FAQ: Load more','feature (i) click -> jump to FAQ','theme toggle','header: hover "Products" (mega-menu open)','hover: plan feature (i) tooltip'],
 'out-mobile-4x-gpu.json': ['baseline: click empty background','sub-tab: Cloud -> Private Cloud','sub-tab: Private Cloud -> On-premises','region: label -> Europe','On-prem billing: -> Perpetual','PC billing: -> Annual','top-up accordion toggle','PC calculator: open #2','PC calc: click slider track @0.35','PC calc: add-on switch','PC calc: stepper +','PAYG calculator: open #2','PAYG calc: click slider track @0.75','PAYG calc: slider ArrowRight','PAYG calc: type digit into devices','PAYG calc: Edge add-on switch','FAQ: category tab -> 2nd','FAQ: expand/collapse item','feature (i) click -> jump to FAQ','header: burger open','theme toggle'],
 'out-mobile-4x-3pblocked-gpu.json': ['baseline: click empty background','sub-tab: Cloud -> Private Cloud','PC calc: stepper +','PAYG calc: Edge add-on switch','region: label -> Europe'],
 'out-mobile-4x-noanim-nosmil-gpu.json': ['baseline: click empty background','sub-tab: Cloud -> Private Cloud','region: label -> Europe','FAQ: category tab -> 2nd','PAYG calc: Edge add-on switch','PAYG calc: click slider track @0.75','header: burger open','theme toggle'],
 'out-desktop-4x-quick-dropscriptrule-gpu.json': ['PAYG calc: slider ArrowRight','PAYG calc: click slider track @0.75','PC calc: click slider track @0.35','PC calc: add-on switch','PAYG calc: Edge add-on switch'],
 'out-mobile-4x-quick-reducedmotion-dropscriptrule-gpu.json': ['baseline: click empty background','sub-tab: Cloud -> Private Cloud','PAYG calc: Edge add-on switch','PC calc: add-on switch','PAYG calc: slider ArrowRight','theme toggle'],
}
out = []
for f, prof in PROF.items():
    d = json.load(open(f))
    by = {}
    for r in d['interactions']:
        if r.get('err') or r['group'] in ('setup','calibration'): continue
        by.setdefault(r['label'], []).append(r)
    for lab, sel in SEL.items():
        if lab not in by: continue
        if f in ONLY and lab not in ONLY[f]: continue
        rs = by[lab]
        w = max(rs, key=lambda r: r['duration'] or 0)
        e = {'label': lab, 'profile': prof, 'selector': sel, 'duration_ms': [r['duration'] if r['duration'] else 0 for r in rs]}
        if w['best']:
            sp = split(w['best'])
            e['input_delay_ms'], e['processing_ms'], e['presentation_ms'] = sp
            if w['loafs']:
                l = max(w['loafs'], key=lambda l: l['duration'])
                e['style_layout_ms'] = round(l['forcedStyleLayoutMs'] + l['styleLayoutPaintMs'], 1)
                ts = '; '.join(f"{s['invoker']} @{s['src'].split('/')[-1]}:{s['char']} {s['ms']}ms (forced S/L {s['forcedSL']})" for s in l['scripts'][:2])
                e['top_scripts'] = f"LoAF {l['duration']} (script {l['scriptMs']}, rAF {l['preLayoutMs']}, S/L/P {l['styleLayoutPaintMs']})" + (': ' + ts if ts else '; no script >5ms')
            else:
                e['top_scripts'] = 'no LoAF >50ms'
        else:
            e['top_scripts'] = '<16ms (below Event Timing threshold)'
        out.append(e)
json.dump(out, open('interactions-final.json','w'), indent=0)
print(len(out))
