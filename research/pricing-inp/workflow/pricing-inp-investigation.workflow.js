export const meta = {
  name: 'pricing-inp-investigation',
  description: 'Find root causes of the failing field INP on thingsboard.io/pricing/: map handlers in code, measure interactions on prod, verify causes',
  phases: [
    { title: 'Map', detail: '4 code readers map interaction handlers + continuous main-thread work' },
    { title: 'Measure', detail: 'headless Chrome + CDP: per-interaction Event Timing + LoAF attribution on prod' },
    { title: 'Synthesize', detail: 'rank candidate INP root causes from map + measurements' },
    { title: 'Verify', detail: 'adversarially verify each candidate' },
  ],
}

const REPO = '/home/thingsboard095/tb/thingsboard.io'
const SCRATCH = '/tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad'

const FIELD = `
FIELD + LAB CONTEXT (already collected, treat as fact):
- PSI lab today (Oct 12 2026, Lighthouse 13.5): mobile Performance 99 (FCP 1.5s, LCP 1.8s, TBT 10ms, CLS 0), desktop 100 (TBT 0ms). In July it was mobile 95 / desktop 77 (desktop TBT 530ms) — load-time JS is now fine.
- PSI lab leftovers: forced reflow (mostly [unattributed] 49-79ms; YourGptWidget chunk + scroll-regions.js small); 2 non-composited animations: <html> animates custom property --promo-cur (animation "promo-collapse"), and #chat-launcher animates --chat-hue (animation "chat-hues"); oversized award badge images (521px shown at 80px); 12 KiB unused CSS.
- CrUX field for URL https://thingsboard.io/pricing/ (28d to Oct 9): PHONE INP p75 = 319ms FAILING (46% good / 46% NI / 8% poor); DESKTOP INP p75 = 166ms passing (81/16/2). LCP/CLS/FCP/TTFB all good. ~86% of this URL's traffic is desktop.
- Origin-level INP (all pages): desktop 77ms, phone 182ms. So /pricing/ desktop INP is ~2x the site average — the problem is pricing-specific.
- History (CrUX Vis, p75, rolling 28d): desktop pricing INP was 93-98ms Dec 2025–Apr 2026, rose 101 (window ending May 23) -> 120 (Jun 6) -> 132 (Jun 20) -> 150 (Jul 18) -> 176-181 (Aug) -> ~177 now. Phone pricing INP ~200-220 until May, 306 (Jun 20), dip to 250 (Jul 25), then 329-339 (Aug), ~302-311 now. Origin TTFB/LCP/CLS all stepped DOWN sharply in the same May window (the new Astro site launch replaced the old site ~mid-May 2026), so the INP regression coincides with the new Astro pricing page going live, with a further rise mid-July to early-August.
- The site has no ClientRouter/View Transitions. Prod deploys from upstream/main (Cloudflare Pages).
`

const MAP_SCHEMA = {
  type: 'object',
  properties: {
    handlers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          trigger: { type: 'string', description: 'event type(s) + target, e.g. "click on [data-tab]"' },
          work: { type: 'string', description: 'what runs synchronously on the interaction: DOM writes, layout reads, how many elements touched, URL/history writes, analytics pushes, etc.' },
          dom_scope: { type: 'string', description: 'approx number of nodes restyled/relaid out, e.g. "toggles hidden on 3 panels each ~900 nodes"' },
          forced_layout: { type: 'boolean' },
          site_wide: { type: 'boolean' },
          est_cost: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: { type: 'string', description: 'quote the key lines' },
        },
        required: ['name', 'file', 'line', 'trigger', 'work', 'est_cost', 'evidence'],
      },
    },
    continuous_work: {
      type: 'array',
      description: 'work that runs without interaction: infinite animations (esp. of custom properties / on html or body), timers, observers, rAF loops',
      items: {
        type: 'object',
        properties: { what: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' }, why_it_matters: { type: 'string' } },
        required: ['what', 'file', 'why_it_matters'],
      },
    },
    git_timeline: { type: 'string', description: 'relevant commits on upstream/main with dates (esp. May 2026 and Jul 10–Aug 10 2026) touching your area' },
    notes: { type: 'string' },
  },
  required: ['handlers', 'continuous_work', 'notes'],
}

const MAP_COMMON = `You are investigating why the FIELD INP (Interaction to Next Paint) of https://thingsboard.io/pricing/ is bad. Repo: ${REPO} (Astro site; page entry src/pages/pricing/index.astro, components in src/components/Pricing/, data in src/data/pricing/). Read-only task: do NOT edit any files.
${FIELD}
INP = input delay + processing time (sync event handlers) + presentation delay (style recalc, layout, paint of the next frame). Things that hurt it: big synchronous DOM rewrites, toggling visibility on large subtrees, forced synchronous layout (reading offsetHeight/getBoundingClientRect after writes), style recalc of the whole document (e.g. changing a class/attribute/custom property on <html>/<body>, or animating a custom property on <html> every frame), sync localStorage, history.replaceState storms, analytics dataLayer pushes that trigger GTM listeners, heavy :has() selectors, large DOM, continuous animations/timers that keep the main thread busy so input waits.
Map EVERY handler in your assigned area with file:line and quote the evidence. Estimate per-interaction cost honestly (high/medium/low) and say why. Also check \`git log --format='%h %ad %s' --date=short upstream/main -- <paths>\` for when your area's code landed or changed, esp. around mid-May 2026 and Jul 10–Aug 10 2026.
YOUR AREA:
`

const AREAS = [
  {
    key: 'nav',
    prompt: `Pricing page navigation and state switching: ProductSubTabs, the top-level product tabs (ThingsBoard / TBMQ / Edge / Trendz etc. if present), RegionToggle, BillingToggle, PlanCardGrid / PlanCard / PlanFeatureItem, PromoHeroCard, UpsellCard, PricingHero, PricingBackground, PerpetualBenefits, the cloud-region script (src/scripts/cloud-region.js), URL/hash/query deep-link sync, the faqTooltip tooltips on tabs/features/comparison rows, and every <script> block inside src/pages/pricing/index.astro (it is 1441 lines — read all of it). For each switch, quantify how many DOM nodes are shown/hidden/re-rendered (count plans, features, rows from src/data/pricing/*).`,
  },
  {
    key: 'calc',
    prompt: `Pricing calculators and modals: TbPaygCalculator, TbPrivateCloudCalculator, CalculatorInline, CalculatorModal, any TBMQ / perpetual / Trendz calculators reachable on /pricing/, their client scripts (input/range/change/keydown handlers, recompute + re-render functions, number formatting, debounced analytics pushes of calculator_interaction), and any scroll-lock / dialog open logic (src/util/scroll-lock.ts). Count how much DOM each recompute touches and whether range-slider 'input' events re-render synchronously on every tick.`,
  },
  {
    key: 'content',
    prompt: `Below-the-fold content: FaqSection + FaqItem (accordion, category tabs, "Load more", deep-link hash), ComparisonTable (expand/collapse, sticky headers, scroll regions — src/util or wherever initScrollRegions lives, scroll-regions.js), AddOnsSection, TopUpsSection, DataTable usage on the page. Also estimate total DOM size of the rendered /pricing/ page from the components + data (how many plan cards, comparison rows x columns, FAQ items, hidden product contexts rendered at once). Large hidden-but-rendered DOM makes every style recalc on the page slower.`,
  },
  {
    key: 'chrome',
    prompt: `Site-wide chrome that is present on /pricing/ (via BaseLayout / src/layouts/ and the components it pulls in): header + mega-menu, the promo banner (PSI says <html> animates custom property --promo-cur via animation "promo-collapse" — find it, determine duration/iteration count, whether it runs on every page load and what it restyles), the AI chat launcher / YourGptWidget (#chat-launcher animates --chat-hue via "chat-hues" — is it infinite? does a custom property animation on it force style recalc every frame? is @property registered?), consent banner/tbConsent, GTM/gtag/dataLayer setup and any global click/pointer/keydown listeners (document-level delegation, analytics click tracking), search modal, theme toggle, print helpers, any web-vitals/RUM reporting. For each, say whether it does work on EVERY interaction or continuously (every frame / timer), and whether it is new between May and Aug 2026 (git log dates). Also check whether the site already reports INP attribution anywhere (web-vitals lib, GA4 events) — if not, note it.`,
  },
]

const MEASURE_SCHEMA = {
  type: 'object',
  properties: {
    method: { type: 'string' },
    script_paths: { type: 'array', items: { type: 'string' } },
    dom_stats: { type: 'object', additionalProperties: true },
    idle_activity: { type: 'string', description: 'style recalcs / frames / animation activity per second while idle, with and without third parties' },
    interactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          selector: { type: 'string' },
          profile: { type: 'string', description: 'e.g. mobile-4x, desktop-1x, desktop-1x-3p-blocked' },
          duration_ms: { type: 'array', items: { type: 'number' } },
          input_delay_ms: { type: 'number' },
          processing_ms: { type: 'number' },
          presentation_ms: { type: 'number' },
          top_scripts: { type: 'string', description: 'LoAF script attribution: sourceURL/function/invoker -> ms, forcedStyleAndLayoutDuration' },
          style_layout_ms: { type: 'number' },
        },
        required: ['label', 'profile', 'duration_ms'],
      },
    },
    worst_interactions: { type: 'string' },
    third_party_effect: { type: 'string' },
    caveats: { type: 'string' },
  },
  required: ['method', 'interactions', 'worst_interactions', 'caveats'],
}

const MEASURE_PROMPT = `Measure real per-interaction INP on PRODUCTION https://thingsboard.io/pricing/ with a scripted headless Chrome. Do NOT edit repo files; write all scripts and outputs under ${SCRATCH}/inp/ (create it).
${FIELD}
TOOLING: /usr/bin/google-chrome exists, Node v22 (global WebSocket available). No puppeteer/playwright package in the repo — drive Chrome directly over CDP: launch \`google-chrome --headless=new --remote-debugging-port=<port> --user-data-dir=${SCRATCH}/inp/profile-<n> --no-first-run\` in the background, read /json/version or /json/list for the websocket URL, speak CDP JSON-RPC over WebSocket. Kill Chrome when done.
HOW:
1. For each profile — (a) "mobile-4x": Emulation.setDeviceMetricsOverride 412x823 dpr 1.75 mobile:true + Emulation.setCPUThrottlingRate 4; (b) "desktop-1x": 1350x940 no throttle; (c) "desktop-4x": 1350x940 + CPU throttle 4 (desktop field users are slower than this machine); (d) repeat the worst profile with third parties blocked via Network.setBlockedURLs (googletagmanager, google-analytics, yourgpt / chat widget hosts, any other 3P you see in the network log) to isolate 1P vs 3P cost.
2. Before navigating, inject (Page.addScriptToEvaluateOnNewDocument) observers: PerformanceObserver type 'event' with durationThreshold 16 (buffered), type 'first-input', and type 'long-animation-frame' (buffered) storing entries with scripts[] attribution (sourceURL, sourceFunctionName, invoker, invokerType, duration, forcedStyleAndLayoutDuration) plus each LoAF's renderStart/styleAndLayoutStart so you can split script vs style/layout time. Keep them on window.__inp.
3. Navigate, wait for load + 5s idle. Capture DOM stats: document.querySelectorAll('*').length, max depth, count of elements inside hidden ([hidden], display:none) containers, number of stylesheets/rules, number of elements with :has()-dependent rules if easy.
4. Discover interactive targets in the live DOM (read the repo's src/components/Pricing/*.astro and src/pages/pricing/index.astro to learn selectors). Interactions to measure, each 3 times with a settle pause between: every product/sub tab switch (incl. switching back), billing toggle, region toggle, opening each calculator (if it opens a modal/inline panel) and changing a calculator input/slider (use Input.dispatchKeyEvent / Input.insertText on number inputs, and dispatchMouseEvent drag or keyboard ArrowRight on range inputs), FAQ category tab + expanding an FAQ item + "Load more", comparison table expand toggles, a feature tooltip hover/click, opening/closing the header mega-menu, the theme toggle, and a plain click on empty page background (baseline). Use TRUSTED input: scroll element into view (DOM.scrollIntoViewIfNeeded or Runtime evaluate), wait 300ms, get its center via getBoundingClientRect, then Input.dispatchMouseEvent mouseMoved/mousePressed/mouseReleased. Match each interaction to its Event Timing entries via interactionId and report max duration per interaction plus the inputDelay (processingStart-startTime), processing (processingEnd-processingStart), presentation (startTime+duration-processingEnd) split, plus the overlapping LoAF's script attribution.
5. Idle activity: with Tracing (categories devtools.timeline, disabled-by-default-devtools.timeline) or simply a rAF counter + LoAF, measure for 5s of idle after load whether frames/style recalcs keep firing continuously (e.g. from infinite animations like chat-hues / promo-collapse) and how much main-thread time per second that costs at 4x throttle. Do the same with the chat launcher/promo animations disabled via injected CSS (animation:none !important on html and #chat-launcher) to quantify their effect on interaction durations.
SAFETY RULES (mandatory): never click links that navigate away, "Contact us"/"Buy"/"Get started"/"Sign up"/checkout buttons, never submit any form, never type personal data (calculator numbers only), never send chat messages (do not open the chat widget at all), and do NOT click accept on any cookie/consent banner — measure in the default consent state (you may note whether a banner was shown). Only target thingsboard.io/pricing/.
Return numbers, not impressions. Report the 3 worst interactions per profile and what dominated them (input delay vs processing vs presentation; which script/function). Note caveats (lab machine vs field devices, consent state, headless differences).`

const CAND_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          mechanism: { type: 'string' },
          files: { type: 'array', items: { type: 'string' }, description: 'file:line refs' },
          code_evidence: { type: 'string' },
          measured_evidence: { type: 'string' },
          affects: { type: 'string', description: 'mobile, desktop, both; which interactions' },
          est_impact: { type: 'string', enum: ['high', 'medium', 'low'] },
          explains_timeline: { type: 'string', description: 'does it explain the May 2026 step and/or the Jul–Aug rise?' },
          proposed_fix: { type: 'string' },
          fix_risk: { type: 'string' },
        },
        required: ['id', 'title', 'mechanism', 'files', 'code_evidence', 'measured_evidence', 'est_impact', 'proposed_fix'],
      },
    },
    unexplained: { type: 'string', description: 'parts of the field data no candidate explains' },
  },
  required: ['candidates', 'unexplained'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'partially', 'refuted'] },
    reasoning: { type: 'string' },
    corrected_claim: { type: 'string', description: 'the claim as it actually holds, with corrected numbers/lines' },
    corrected_fix: { type: 'string' },
    est_impact_after_review: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
  },
  required: ['id', 'verdict', 'reasoning', 'corrected_claim', 'est_impact_after_review'],
}

// Map + Measure run concurrently; synthesis genuinely needs all of them together.
const results = await parallel([
  ...AREAS.map(a => () => agent(MAP_COMMON + a.prompt, { label: `map:${a.key}`, phase: 'Map', schema: MAP_SCHEMA })
    .then(r => r && { area: a.key, ...r })),
  () => agent(MEASURE_PROMPT, { label: 'measure:prod-cdp', phase: 'Measure', schema: MEASURE_SCHEMA })
    .then(r => r && { area: 'measure', ...r }),
])

const maps = results.filter(r => r && r.area !== 'measure')
const measure = results.find(r => r && r.area === 'measure') || null
log(`mapped ${maps.length}/4 areas; measurement ${measure ? 'ok' : 'MISSING'}`)

phase('Synthesize')
const synth = await agent(
  `You are ranking root causes of the failing field INP on https://thingsboard.io/pricing/. Repo: ${REPO} (read-only; you may open files to check claims).
${FIELD}
CODE MAP (4 areas):
${JSON.stringify(maps, null, 1)}

PROD MEASUREMENTS (scripted headless Chrome, trusted input, Event Timing + LoAF):
${JSON.stringify(measure, null, 1)}

Produce 3–7 distinct candidate root causes, ranked by expected field-INP impact. Prefer causes supported by BOTH code and measurement; mark code-only or measurement-only ones as such. Each must name the exact mechanism (which interaction, which phase: input delay / processing / presentation, which code at file:line), state whether it explains the May 2026 step (new Astro pricing page launch) and the Jul 10–Aug 10 2026 rise, and propose a concrete minimal fix that keeps behavior identical. Merge duplicates across areas. Note what the data cannot explain (e.g. phone 319ms vs desktop 166ms gap).`,
  { label: 'synthesize', phase: 'Synthesize', schema: CAND_SCHEMA }
)

const candidates = (synth?.candidates || []).slice(0, 6)
if ((synth?.candidates || []).length > 6) log(`verifying top 6 of ${synth.candidates.length} candidates; rest reported unverified`)

const verdicts = await parallel(candidates.map(c => () => agent(
  `Adversarially verify this claimed root cause of poor field INP on https://thingsboard.io/pricing/. Default to skepticism: try to REFUTE it. Repo ${REPO} is read-only for you. You may re-run quick targeted measurements against prod with headless Chrome over CDP (/usr/bin/google-chrome, Node 22 global WebSocket; scripts from the measurement agent are in ${SCRATCH}/inp/ — reuse them; write new files only under ${SCRATCH}/inp/verify-${c.id}/). Same safety rules: no navigating links, no form submits, no consent accept, no chat widget, calculator numbers only.
${FIELD}
CLAIM:
${JSON.stringify(c, null, 1)}

Check: (1) does the code at the cited lines really do this (quote it)? (2) does the mechanism actually cost what is claimed at INP time (e.g. is a custom-property animation really forcing per-frame style recalc of a large subtree, or is it registered/contained/short-lived; does a hidden subtree really get restyled)? (3) do the measurements support the magnitude, and would the proposed fix actually remove it without behavior change? (4) does it fit the CrUX timeline? Return confirmed / partially / refuted with the corrected claim and fix.`,
  { label: `verify:${c.id}`, phase: 'Verify', schema: VERDICT_SCHEMA }
)))

return {
  measure,
  maps,
  candidates: synth?.candidates || [],
  unexplained: synth?.unexplained || '',
  verdicts: verdicts.filter(Boolean),
}
