# /pricing/ INP investigation — handoff (2026-10-12)

Research branch only, not meant to be merged. Code refs are against `upstream/main` @ `e9cbd6dc4`.

## TL;DR

- **Load performance is solved.** PSI lab: mobile 99 / desktop 100 (TBT 10 / 0 ms). It was 95 / 77 on Jul 7.
- **Field INP is the only failing metric.** CrUX phone INP p75 is **319 ms** (fails). Desktop is 166 ms (passes), but that is about 2× the origin's 77 ms. About 86 % of /pricing/ traffic is desktop.
- **The regression started with the Astro launch.** Pricing desktop INP was 93–98 ms through April, stepped up in late May, and rose again through July–August (~177 ms since).
- **Six root causes were checked by a measure → adversarial-verify workflow** (C1–C6 below). Four are worth fixing in the repo (C4, C1, C2, C6). C5 is a GTM container change. C3 was already mitigated on Oct 6.
- **Functional bug found on prod, unrelated to INP.** The PAYG calculator slider can no longer stop anywhere between 1,000 and 150,000 devices (see [Functional bug](#functional-bug-found-on-prod)).
- **The site has no INP attribution in the field.** Adding a consent-gated `web-vitals/attribution` `onINP` push is the prerequisite for confirming the ranking with real users.

## Data

- [data/pricing-field-2026-10-12.md](data/pricing-field-2026-10-12.md): today's PSI lab and CrUX field data, plus the CrUX Vis p75 history for desktop, phone and origin.
- [data/psi-baseline-2026-07-07.md](data/psi-baseline-2026-07-07.md): the July PSI baseline for 5 URLs, captured before PR #536.
- PSI report: https://pagespeed.web.dev/analysis/https-thingsboard-io-pricing/213hxpm9ij
- CrUX Vis: https://cruxvis.withgoogle.com/#/?view=allmetrics&url=https%3A%2F%2Fthingsboard.io%2Fpricing%2F&identifier=url&device=DESKTOP&periodStart=0&periodEnd=-1&display=p75s
  - Switch `device=PHONE`, or use `identifier=origin&url=https%3A%2F%2Fthingsboard.io` for the whole site.
  - Charts render only while the tab is in the foreground.
  - Exact values are in each point's `aria-label`.

Key field facts:

| CrUX, 28d to Oct 9 | LCP | INP p75 | good / NI / poor | CLS |
|---|---|---|---|---|
| /pricing/ phone | 0.8 s | **319 ms** | 46 / 46 / 8 % | 0.01 |
| /pricing/ desktop | 0.5 s | 166 ms | 81 / 16 / 2 % | 0.01 |
| origin phone | 1.0 s | 182 ms | 78 / 18 / 4 % | 0.01 |
| origin desktop | 0.6 s | 77 ms | 96 / 3 / 1 % | 0.01 |

Desktop /pricing/ INP history: 93–98 ms (Dec–Apr) → 101 (window ending May 23) → 120 (Jun 6) → 132 (Jun 20) → 150 (Jul 18) → 164 (Aug 1) → 176–181 (Aug) → 177 (Oct 3).

## Root causes (verified)

Measured on prod with headless Chrome over raw CDP, with the real GPU on and trusted input, reading Event Timing and LoAF. Profiles: desktop 1x, desktop 4x CPU, and mobile 4x CPU (412 px, touch). The consent banner was left untouched, so GTM and YourGPT never loaded except in the C5 A/B. Full per-candidate text: `workflow/workflow-result.json` → `candidates[]` and `verdicts[]`.

| # | Cause | Verdict / impact | Measured effect | Since |
|---|---|---|---|---|
| **C4** | Calculator layout thrashing. `calculate()` reads `scrollTop` and writes `innerHTML`, then writes `scrollTop` again: 2 forced full style+layout passes. On top of that, the same frame runs duplicate `calculate()` calls (sync slider `change` after the rAF one; `blur` of the previous input billed to the next tap). | partially → **medium**, the largest measured deltas | Calculator interactions at 4x: desktop −40…185 ms (ArrowRight 276→92), mobile −90…175 ms (Edge after typing 348→192, PC add-on 328→160) | launch (May) |
| **C1** | Starlight ≥0.39 `markdown.css` list rule `.sl-markdown-content :is(ol,ul):has(…) > li > :is(…, :not(script):has(~ script:last-child)…)`. It ships on /pricing/ although nothing matches. The `:has()` is not in subject position, so **every DOM insertion/removal restyles the whole document** (~1,141 elements instead of ~60). | partially → **medium** | About 2× slower calculator interactions on slow CPUs (desktop-4x PAYG slider 264→150, PC add-on 216→115). Billing toggles 0–30 ms. No effect on sub-tab / region / FAQ or at desktop 1x. | merge `5d146b2f2` (Jun 30: Starlight 0.38→0.39 + pricing on StarlightPage) |
| **C2** | 4 infinite SMIL `<animateTransform>` waves in `PricingBackground.astro:57/71/85/99`. They are never composited, so every frame costs SVG style + layout + a GPU re-raster of the wave layer (GPU-main 560–900 ms/s at idle). Lighthouse and `getAnimations()` cannot see them. | partially → **medium** | Desktop-1x +8–25 ms per interaction (presentation). Mobile-4x +24–40 ms (~18 ms of it input delay). Real phone GPUs are probably worse, because CDP throttling does not slow the GPU. | launch (May) |
| **C6** | (a) Since Oct 6, `chat-hues` animates infinitely on `#chat-launcher`. Under 432 px every frame re-matches `:root:has(#cc-main .cm:not([hidden])) .chat-launcher` (`YourGptWidget.astro:120`), a whole-document `:has` walk of 6–9 ms per frame at 4x. This hits every phone page view site-wide. (b) `promo-collapse` animates the inherited `--promo-cur` on `<html>`, so it restyles ~1,000 elements per scroll frame in the first 40–52 px. | partially → **low** for INP (forward risk on phones; (b) is scroll jank) | (a) +8–24 ms per light tap and +25–35 ms input delay on mobile-4x. Even while hidden, chat-hues costs ~770 ms/s of renderer main at idle on mobile-4x. | (a) Oct 6 `609e2c086`, (b) Jun 30 |
| **C5** | GTM-TGBNQXN v60 adds a capture-phase `gtm.click` listener and fires the GA4 "Buttons" tag synchronously on every `gtm_button` tap. Pricing code also pushes `PriceOpen` / `faq_node_interaction` / `calculator_open` within the interaction task. | partially → **medium** for consented visitors | GTM: median 12 ms per tap at 1x, 41–44 ms at 4x (max ~79). `faq_node_interaction` 9 ms at 1x / 28–33 ms at 4x. GTM scroll-depth trigger 50–65 ms at 4x on scrollend. | per-click cost is not new (old site had it); boot timing changed May 13 |
| C3 | YourGPT bundle: leaked MutationObservers plus history monkeypatches. | **refuted** as a regression cause → low | <1 ms at 1x, 3–4 ms at 4x after 5 min of dwell. The old site had the same leak at 93–98 ms INP. | mitigated Oct 6 (loads on launcher click only) |

Combined lab effect of the confirmed fixes:

- Mobile-4x, with the C1 rule removed and motion off (≈ C2 + C6a fixed): per-interaction median 104 → 48 ms, max 216 → 120 ms.
- Desktop-4x, with the C1 rule removed only: median 80 → 64 ms, max 184 → 96 ms.
- The C4 fixes stack on top of that for the calculators.

Third parties had no effect in the default consent state (nothing third-party loads): blocked and unblocked runs differ only within ±16 ms of noise.

## Fix plan (priority order)

1. **Calculators (C4) + slider bug.** In `src/scripts/pricing/calc-tb-payg.ts` and `calc-tb-pc.ts`:
   - At `calc-tb-payg.ts:239,303` and `calc-tb-pc.ts:624,675`, replace the `scrollTop` save → `innerHTML` → restore line with just `results.innerHTML = html;`. Optionally add `overflow-anchor: none` on `.calc-panel-scroll`. The scroll position was verified to be kept natively. Don't use the "read `scrollTop` first" variant, because the setter still forces layout.
   - Route the handler-triggered recalcs (slider `change`, number and stepper `blur`, add-on toggles, steppers) through the existing rAF coalescer `scheduleCalculate()`. At minimum, use `if (!_calcQueued) calculate();` in the PAYG `change` handler.
   - Fix the guard at `calc-tb-payg.ts:324` to `v <= SM_LAST_TICK`. This is the functional bug below.
   - A/B scripts: `measure/verify-C4/ab.mjs` (`base|fix`) and `behavior.mjs`.
2. **Starlight `:has` rule (C1).**
   - Run `pnpm patch @astrojs/starlight` against **0.42.4**. In `dist/style/markdown.css:46-58`, replace the list block with the 0.38.4 selector (both versions are in `measure/verify-C4/sl/`): `.sl-markdown-content li > :is(:last-child:not(li, ul, ol, a, strong, em, del, span, input, code, br, script, :where(.not-content *)), :not(script):has(~ script:last-child):not(:has(~ :not(script)))) { margin-bottom: 1.25rem; }`.
   - Then visually check list spacing on docs pages and on the BaseLayout pages that render `.sl-markdown-content` (IoT Hub item pages, partners hardware samples, ce-vs-pe-diff).
   - Longer term: stop `markdown.css` reaching BaseLayout bundles (static import chain `MarkdownContent.astro:2` → `DocMarkdownContent.astro` → `markdown.css`), and report the invalidation cost upstream.
   - Cheap extra: use `Text.data` instead of `textContent=` for the On-prem heading and price swaps.
3. **SMIL background (C2).**
   - Keep the motion but move it to the compositor. Make `.pricing-bg-svg` a wrapper div that keeps the box, transform and mask. Put one static `<svg>` (defs plus glow rects) inside it, and one absolutely positioned `<svg>` per wave with the same viewBox and `preserveAspectRatio="xMaxYMid slice"`.
   - Animate each wave with a CSS keyframe `translateY` using the same distances and durations (40/28/18/50 s, linear, infinite) and `will-change: transform`. Use `container-type: size` on the wrapper and express 900 user units as `calc(max(100cqw, 100cqh) * -1)`, because the slice scale is `max(w,h)/900`.
   - Keep the reduced-motion rule.
   - A prototype matched pixels within 5/255 at 1350 and 412 px, with interaction latency equal to the fully paused case (`measure/verify-C2/`).
   - This also helps the homepage, /products/thingsboard-pe/ and /products/paas/, which render the background `contained` since Sep 29.
   - Removing the mask or `rotateY` does **not** help.
4. **chat-hues on phones (C6a).**
   - Inside `@media (width < 432px)` in `YourGptWidget.astro`, replace `:global(:root:has(#cc-main .cm:not([hidden]))) &` with `:global(#cc-main:has(> .cm:not([hidden]))) ~ & { visibility: hidden; animation-play-state: paused; }`. This relies on CookieConsent rendering before YourGptWidget in `starlight/SkipLink.astro`.
   - Alternative: toggle `data-cc-open` on `<html>` at `CookieConsent.astro:35` and `:141` and use `:root[data-cc-open] .chat-launcher {…}`.
   - Either way, stop chat-hues while the launcher is hidden, or make it finite.
5. **GTM (C5), mostly outside the repo.**
   - In the container: replace the auto "Click – All Elements" listener (19 `__cl` triggers) with a custom `gtm_button_click` event. The site pushes it after paint from one delegated passive listener. This saves ~40–80 ms per tap at 4x for consented visitors. Also consider dropping or reducing the scroll-depth trigger.
   - In the site: defer `PriceOpen`, `faq_node_interaction` and `calculator_open` with `requestAnimationFrame(() => setTimeout(fn, 0))`. Keep `reportPriceLink` synchronous or beacon-based, because navigation follows it.
6. **Field attribution.** Add a consent-gated `web-vitals/attribution` `onINP` push to `dataLayer`, with interactionTarget, the inputDelay / processingDuration / presentationDelay split, and LoAF scripts. Nothing on the site reports INP today.
7. Low priority:
   - `promo-collapse`: register `--promo-cur` with `inherits: false` on its consumers, or use a compositor `transform`. This is scroll jank, not INP.
   - Same-tab early return in `activateSubTab` (`index.astro:675`). It only fixes the duplicate `PriceOpen` and `replaceState` on (i)-icon → FAQ jumps, not INP.
   - Removing `void el.offsetWidth` (`index.astro:682`) does **not** improve sub-tab INP; that cost is the inherent first layout of the shown section.

## Functional bug found on prod

The PAYG slider's `change` guard is wrong. `calc-tb-payg.ts:324` has `if (v <= 4)`, but `#sm-slider` has `max="3"` (`TbPaygCalculator.astro:21`; `SM_LAST_TICK` = 2), so the guard is always true. Releasing the slider anywhere in the continuous 1,000 → 150,000 ramp therefore rounds it to tick 2 (1,000) or tick 3 (150,000 / Enterprise). For example, 2.19 → 1,000 and 2.75 → 150,000.

It was introduced by `72563afc5` (ThingsBoard 4.4, Sep 29). The fix is `v <= SM_LAST_TICK`.

## Still unexplained / open questions

1. **Phone 319 ms vs lab.** Lab mobile-4x estimates INP at ~200, max 216. Likely reasons for the gap:
   - Real phones are slower than a throttled Ryzen.
   - GPU work isn't throttled in the lab, which understates C2.
   - The 14 % phone sample is noisy: the dip to 250 at the window ending Jul 25 and the Aug jump to 329–339 match no commit.
2. **Desktop field 166 vs lab 56 at 1x.** Desktop-4x gives 176. The remaining factors are unmeasured: consented GTM, pre-Oct-6 YourGPT, slower laptops.
3. **Jun 30 merge `5d146b2f2` bundled several changes:** the C1 rule, `promo-collapse`, and ~50 KiB of extra CSS including 31 `header.header:has(…)` rules. Only C1 was ablated. About +15 ms of the desktop rise came after 28-day windows were fully post-Jun-30, so the **Jul 14 merges** are worth checking next.
4. **`target=_blank` CTAs.** There are 10 Cloud "Get started" anchors plus 3 `window.open` getLicense CTAs (`index.astro:1046-1053`). If the next paint lands after the tab is backgrounded, they could inflate INP. This can't be confirmed without field attribution.
5. **The current CrUX window barely includes recent changes.** It has ~11 days of the 4.4 page, ~3 days of the Oct 6–7 YourGPT and GTM mitigations, and ~3 days of the new chat-hues regression. **Re-read CrUX for windows ending ~Oct 27 and ~Nov 3–10** before judging the current build.
6. **Side finding (unverified on a real device).** With the Private Cloud tab on a 412 px viewport, `documentElement.scrollWidth` is 485, causing horizontal overflow. The candidates are the off-screen `.sub-tab-tooltip` elements and the 500 px `.pc-comparison-table`.
7. **PSI lab leftovers.** 4 award badges are 521 px images shown at 80 px (~93 KiB), plus 12 KiB of unused CSS.

## Reproducing the measurements

Requirements: Node ≥22 (global `WebSocket`) and `google-chrome`. No npm packages are needed; the scripts speak CDP directly.

```bash
bash research/pricing-inp/measure/relocate.sh   # rewrites the hardcoded output dir to this checkout
cd research/pricing-inp/measure
node run.mjs desktop-1x --gpu                    # profiles: mobile-4x, mobile-1x, desktop-1x, desktop-4x, desktop-6x
node run.mjs mobile-4x --gpu --block3p           # flags: --noanim --nosmil --reducedmotion --dropscriptrule --droprule=<re> --dpr=N --trace --quick
python3 summarize.py out-mobile-4x-gpu.json
python3 compare.py out-mobile-4x-gpu.json out-mobile-4x-noanim-nosmil-gpu.json
```

- **Always pass `--gpu`.** Headless Chrome otherwise uses SwiftShader, which inflates presentation delay roughly 2×. Compare `out-desktop-1x.json` (software GL) with `out-desktop-1x-gpu.json`.
- **Safety:** the harness refuses hits on links, the chat launcher, iframes or the consent banner. It never submits forms, never accepts consent, and types only calculator numbers.
- **What's in `measure/`:**
  - `itrace.mjs` traces one click with invalidation tracking; `idletrace.mjs` traces idle activity with SelectorStats.
  - `verify-C*/` contains each verifier's A/B scripts, logs and JSON.
  - `prod.html` is the Oct 12 prod HTML snapshot.
- **Not committed:**
  - Chrome profile dirs, which are regenerated per run.
  - `verify-C3/vendor/`: dated YourGPT bundles from the Wayback Machine, used to show the observer leak predates May.
  - `verify-C4/dl/`.

## Files

- `workflow/workflow-result.json`: full workflow output, with keys:
  - `maps[]`: 4 code maps with every handler on /pricing/ at file:line, cost estimates and continuous work.
  - `measure`: method, per-interaction numbers, idle activity, DOM stats and caveats.
  - `candidates[]` and `verdicts[]`: the C1–C6 claims and their adversarial verification.
  - `unexplained`.
- `workflow/pricing-inp-investigation.workflow.js`: the orchestration script (Map → Measure → Synthesize → Verify), so the run can be repeated.
- `measure/interactions-final.json` and `measure/interactions-compact.txt`: the headline per-interaction tables.
- **DOM facts:** ~6,000 elements, of which ~3,900 sit in `display:none` containers. Hidden DOM was shown **not** to drive style cost; the cost comes from C1's whole-document invalidation over ~1,100 rendered elements.
