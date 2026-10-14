export const meta = {
  name: 'review-pricing-inp',
  description: 'Code-review the 7 commits on perf/pricing-inp: 5 area reviewers find issues, each finding is adversarially verified by 3 independent skeptics',
  phases: [
    { title: 'Review', detail: '5 reviewers, one per change area + one cross-cutting conventions pass' },
    { title: 'Verify', detail: '3 skeptics per finding try to refute it' },
  ],
}

const REPO = '/home/thingsboard095/tb/thingsboard.io'
const BASE = 'e9cbd6dc4'
const HEAD = 'perf/pricing-inp'

const COMMON = `You are reviewing a branch in ${REPO} (Astro 7 + Starlight marketing/docs site). READ-ONLY: never edit, commit, stash or check out anything; the working tree is on ${HEAD} and must stay untouched. Do not run builds (pnpm build) or pnpm check; eslint on single files and node one-liners are fine.
Branch ${HEAD} = 7 commits on top of ${BASE}. See them with: git -C ${REPO} log --format='%h %s' ${BASE}..${HEAD}; full diff: git -C ${REPO} diff ${BASE}..${HEAD} -- <paths>; per commit: git -C ${REPO} show <sha>.
Purpose of the branch (context, already measured and verified, do not re-litigate the performance claims): /pricing/ had a failing field INP. Fixes: (1) PAYG slider guard bug, (2) calculators render once per frame with no forced layout, (3) chat launcher hides beside the cookie card via html[data-cc-open] instead of a root :has(), (4) Starlight markdown.css no longer ships on marketing/BaseLayout pages, inlined by Head.astro only where .sl-markdown-content renders, (5) PricingBackground SMIL waves became compositor CSS transform animations, (6) component renamed/moved to Landing/WaveBackground.astro, (7) pricing page imports converted to @ aliases.
Project rules that apply (from CLAUDE.md): @-alias imports for TS/Astro (SCSS @use stays relative); tabs in code files; comments describe the code only (no tickets/people/process/Figma refs), keep them short; HTML <!-- --> comments and is:inline scripts ship to the built HTML; never hardcode versions; dark theme uses CSS custom properties not SCSS colour vars; window globals typed in src/global.d.ts; scoped Astro styles have :where() zero specificity.
Report only real defects or risks you can point at with file:line in the HEAD tree, each with a concrete failure scenario (inputs/state -> wrong result). Also report anything that changes behaviour the commit message claims is unchanged. Do not pad: zero findings is a valid answer. Rate each finding's confidence honestly.
YOUR AREA:
`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['bug', 'behaviour-change', 'risk', 'convention', 'nit'] },
          confidence: { type: 'number', description: '0-1' },
          claim: { type: 'string', description: 'what is wrong, quoting the code' },
          failure_scenario: { type: 'string', description: 'concrete inputs/state -> wrong outcome' },
          suggested_fix: { type: 'string' },
        },
        required: ['title', 'file', 'line', 'severity', 'confidence', 'claim', 'failure_scenario'],
      },
    },
    what_looks_right: { type: 'string', description: 'brief: what you checked that holds up, so the final report can say so' },
  },
  required: ['findings', 'what_looks_right'],
}

const AREAS = [
  {
    key: 'calculators',
    prompt: `Commits 35ea9a2ff and 9be7c697b: src/scripts/pricing/calc-tb-payg.ts and calc-tb-pc.ts (also read the Astro components that render them: src/components/Pricing/TbPaygCalculator.astro, TbPrivateCloudCalculator.astro, CalculatorModal.astro, CalculatorInline.astro, src/scripts/pricing/modal-controller.ts, calc-analytics.ts; these calculators push debounced calculator_interaction events).
Check: the new rAF coalescing (scheduleCalculate/_calcFrame/cancel in calculate()) - can a queued frame fire after the modal closes or after the calculator is torn down/re-opened? Can state read by a handler be stale because the render is now deferred (e.g. a handler that reads DOM the previous render would have written: results innerHTML, clipboard text, Contact Us message, plan name, enterprise CTA)? commitCalculate(changed) on blur: enumerate every blur path and confirm the 'changed' flag is computed correctly (normalisation, clamping, threshold snapping) - is there a case where the input value is rewritten by blur but changed=false so the panel shows stale numbers? renderedPlan() in PC: does it flush correctly, can it recurse? The PAYG slider: guard v <= SM_LAST_TICK - confirm SM_LAST_TICK semantics vs max="3" step 0.01 and the devicesToSlider/sliderToDevices round-trip at the tick boundaries (exactly 2, 2.0, 2.01, 3). Removing the scrollTop save/restore: is there a path where the results container is replaced/re-created so the browser cannot preserve scroll (e.g. innerHTML on the scroller itself rather than a child)? Keyboard: ArrowRight 'input' then 'change' ordering. Analytics payload identity (the handoff claims final analytics payloads are identical) - check calc-analytics usage. Any removed behaviour not mentioned in the commit message.`,
  },
  {
    key: 'chat-launcher',
    prompt: `Commit be1a40c1b: src/components/CookieConsent.astro and src/components/YourGptWidget.astro (also read src/util/chat-widget.ts, src/data/chat-widget.ts, src/global.d.ts, src/components/starlight/SkipLink.astro or wherever CookieConsent/YourGptWidget are mounted, and GtmHead.astro for tbConsent).
Check: html[data-cc-open] lifecycle - every code path that shows or hides the consent card (first visit, choice made, 'Manage preferences' dialog, consent revoked/reset, returning visitor with tbConsent set, pages where CookieConsent is not rendered) must set/clear the attribute consistently; any path where the card is hidden but data-cc-open stays (launcher invisible forever on phones) or vice versa. The is:inline script uses document.currentScript.previousElementSibling and documentElement.dataset.ccOpen - ordering/availability, and does it match the project's inline-script style (const/let, modern JS)? 'animation-name: none' inside @media (width < 432px) while hidden: interaction with syncHues/startTime in util/chat-widget.ts (the comment says pausing would restart the cycle) - confirm that setting animation-name none and then restoring does not itself restart the hue cycle or throw in syncHues (getAnimations() empty?). Does prefers-reduced-motion still work? Does the :global(:root[data-cc-open]) & selector compile to the intended specificity inside the scoped style (Astro :where)? Comment length/content vs CLAUDE.md. Anything else on the site that relied on the old :root:has(#cc-main .cm:not([hidden])) selector.`,
  },
  {
    key: 'markdown-css',
    prompt: `Commit b08264a0c: src/components/starlight/Head.astro, MarkdownContent.astro, DocMarkdownContent.astro, src/components/IotHub/IotHubMarkdown.astro, src/pages/iot-hub/[category]/[slug].astro (also read src/layouts/BaseLayout.astro, src/components/starlight/*.astro that reference bsl/Astro.locals, src/env.d.ts or wherever App.Locals is declared, astro.config.ts, and node_modules/@astrojs/starlight/dist/style/layers.css + markdown.css + the Starlight package.json version).
Check: how Head.astro decides to inline markdown.css (which flag, who sets it, default for docs pages vs StarlightPage-without-bsl pages such as partners/hardware/*/samples) - enumerate page types and confirm each that renders .sl-markdown-content still gets the CSS and nothing else does: docs, partner hardware samples, IoT Hub item pages, ce-vs-pe-diff, blog, legal, landings. Cascade/layer order: the commit hand-copies Starlight's @layer order into Head.astro - compare with node_modules/@astrojs/starlight/dist/style/layers.css exactly; does inlining the sheet in <head> change its order relative to the bundled Starlight CSS and component styles (an inlined <style> early in head vs bundled <link> later -> different winner for same-specificity rules, e.g. .sl-markdown-content overrides in src/styles/*.scss)? Is the inlined CSS read at build time via ?raw/fs (path stable across pnpm hoisting?) and is it included once per page? Astro.locals.bslMarkdownCss typing (App.Locals declaration) - pnpm check passes, but is it declared or any-cast? Static import of DocMarkdownContent removed from MarkdownContent - how is the component chosen now, and does the choice still work for docs pages in dev (HMR) and build? Does IotHubMarkdown still style the readme correctly without its own import, incl. dark theme? Any duplicate CSS now (both inlined and bundled on docs pages)? Starlight upgrade hazard: which copied strings need re-checking. Comments vs CLAUDE.md.`,
  },
  {
    key: 'waves',
    prompt: `Commits 7c14bd09d and daaad15cb: src/components/Landing/WaveBackground.astro (renamed from Pricing/PricingBackground.astro; use git show 7c14bd09d for the SMIL-to-CSS diff and git show -M daaad15cb for the rename), plus consumers src/components/Landing/ChoiceBand.astro, ClosingCta.astro, ProductsSection.astro and src/pages/pricing/index.astro.
Check: keyframe maths - original SMIL moved each wave by k viewBox units (900/600/450/900) with preserveAspectRatio xMaxYMid slice on a viewBox 0 0 900 900; the CSS uses translateY(calc(max(100cqw,100cqh) * -k / 900)) with container-type: size on .wave-bg__field. Is max(w,h)/900 the correct slice scale for ALL aspect ratios of the field box (desktop 110%x180% of viewport, mobile 220%x110%)? Does translateY of the wrapper in CSS px equal the SMIL translate in user units after the field's rotate(-28deg) rotateY(-6deg) (the wrapper is INSIDE the rotated field, so its translate is in the field's local space - confirm). Wave B and D run from negative to 0 while A and C run 0 to negative - matches the original from/to? Directions/durations/opacities/paths byte-identical? The glow SVG keeps the gradient ids wave-bg-glow-1/2 - with two instances on a page the ids duplicate (pre-existing) but confirm rename did not make it worse. container-type: size on an absolutely positioned 110%/180% box: does size containment change the field's own layout (a size container cannot size from its contents; the field has explicit width/height so fine?) and does it break the mask-image or perspective? will-change: transform on 4 layers x up to 2 instances: memory on mobile (layer size = field box, 220%x110% of viewport at DPR 3?) - estimate the GPU memory per layer and flag if it is large. overflow: visible on the layers + inset:0 wrappers - do waves paint outside the field and get clipped by .wave-bg overflow:hidden as before? Browser support: cqw/cqh units (Chrome 105, Safari 16, Firefox 110) - fallback behaviour where unsupported: does the whole translateY become invalid (waves frozen) and is that acceptable/was it noted? Firefox: does it composite transform animations on a div wrapping an svg? prefers-reduced-motion still hides the field. print:hidden still present. aria-hidden. Rename: every selector/variable/id/keyframe name consistent, no leftover 'pricing' naming inside the component, BEM consistent with sibling Landing components (check 2-3 of them), consumers' :global(.wave-bg) overrides still match, the dark-theme [data-theme='dark'] .wave-bg rule scoping (pre-existing bug: Astro scopes it to :where(.astro-x)[data-theme=dark] - did the rename keep or fix it; say which). Comments: any that name process/tools; any HTML <!-- --> comments that would ship.`,
  },
  {
    key: 'conventions',
    prompt: `Cross-cutting pass over the WHOLE diff ${BASE}..${HEAD} (all 15 files) plus commit cd0ea3b0b (import alias conversion in src/pages/pricing/index.astro).
Check: (a) cd0ea3b0b - every import resolves (compare with tsconfig.json paths); the two inline import('@data/pricing/types') type references work in Astro frontmatter; nothing left relative except SCSS @use; the import order/grouping still reads like the surrounding file. (b) CLAUDE.md conventions across all files: tabs vs spaces, Prettier style of surrounding code (files are hand-wrapped ~100 cols, do not flag width alone), comments that mention tickets/people/process/'research'/'measured'/'verified'/'the handoff' (process refs are forbidden) or are long multi-line explanations where surrounding code keeps them short; HTML comments or is:inline script comments that would ship to built HTML; hardcoded version strings; 'var' in inline scripts (project wants const/let); window globals needing src/global.d.ts typing; dark-theme colours via SCSS vars instead of CSS custom properties in changed styles. (c) The recurring Copilot-reviewer flags on this user's PRs: unused imports; silently removed prop defaults; inline onclick in HTML strings; unguarded global listeners (document/window listeners added without cleanup or without a guard against double-binding); awkward user-facing copy in any changed string; a11y attributes lost (aria-hidden, aria-label, roles) in the rewritten markup; link text/target mismatches. (d) Commit hygiene: each commit message describes the change (no ticket ids, no AI attribution), each commit builds on its own conceptually (e.g. does daaad15cb leave any reference to the old path that only cd0ea3b0b fixes, or vice versa), and whether the 7 commits split cleanly into the planned 3 PRs: PR1 = 35ea9a2ff 9be7c697b be1a40c1b, PR2 = b08264a0c, PR3 = 7c14bd09d daaad15cb cd0ea3b0b - any file touched by two PR groups (cherry-pick conflict risk)? (e) Anything in the diff that is dead code, a leftover debug line, or a TODO.`,
  },
]

const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'partially', 'refuted'] },
    reasoning: { type: 'string' },
    corrected: { type: 'string', description: 'the finding as it actually holds (or why it does not), with exact file:line' },
    severity_after: { type: 'string', enum: ['bug', 'behaviour-change', 'risk', 'convention', 'nit', 'none'] },
  },
  required: ['verdict', 'reasoning', 'corrected', 'severity_after'],
}

const reviews = await parallel(AREAS.map(a => () =>
  agent(COMMON + a.prompt, { label: `review:${a.key}`, phase: 'Review', schema: FINDINGS })
    .then(r => r && { area: a.key, ...r })))

const found = reviews.filter(Boolean).flatMap(r => r.findings.map(f => ({ ...f, area: r.area })))
log(`${found.length} findings from ${reviews.filter(Boolean).length}/5 reviewers`)

const LENSES = ['correctness: does the code at the cited line really do this, trace it', 'reproduce: can you demonstrate or disprove the failure scenario (node one-liner, eslint, reading the browser spec, git history)', 'intent: is this actually intended/pre-existing/documented in the commit message or sibling code, or out of scope for this branch']

const verified = await parallel(found.map((f, i) => () =>
  parallel(LENSES.map(lens => () => agent(
    `Adversarially verify ONE code-review finding on branch ${HEAD} in ${REPO} (read-only, same rules: no edits/checkouts/builds). Your lens: ${lens}. Default to 'refuted' unless the evidence holds up; 'partially' if the mechanism is real but the severity, line, or scenario is wrong - then write the corrected version.
Branch context: ${BASE}..${HEAD}, 7 commits (git log --format='%h %s' ${BASE}..${HEAD}).
FINDING #${i + 1} (${f.area}):
${JSON.stringify(f, null, 1)}`,
    { label: `verify:${i + 1}:${lens.split(':')[0]}`, phase: 'Verify', schema: VERDICT })))
    .then(vs => ({ ...f, votes: vs.filter(Boolean) }))))

const out = verified.filter(Boolean).map(f => {
  const c = f.votes.filter(v => v.verdict === 'confirmed').length
  const p = f.votes.filter(v => v.verdict === 'partially').length
  const r = f.votes.filter(v => v.verdict === 'refuted').length
  const status = r >= 2 ? 'refuted' : c >= 2 ? 'confirmed' : 'partially'
  return { ...f, status, tally: { confirmed: c, partially: p, refuted: r } }
})
return { reviews: reviews.filter(Boolean).map(r => ({ area: r.area, what_looks_right: r.what_looks_right })), findings: out }
