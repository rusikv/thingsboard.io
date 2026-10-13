# /pricing/ INP fixes — handoff (2026-10-13)

This continues the investigation in [../README.md](../README.md).

The fixes are on branch **`perf/pricing-inp`** (on the fork, based on upstream `main` @ `e9cbd6dc4`). This folder holds the base-vs-fix A/B that verified them. Like the rest of `research/`, it is not meant to be merged.

## State

`perf/pricing-inp` has five commits, grouped by the PR they will go to:

| PR | Commit | Change | Files |
|---|---|---|---|
| 1 | `35ea9a2ff` | PAYG slider stops between 1,000 and 150,000 again (`v <= SM_LAST_TICK`) | `calc-tb-payg.ts` |
| 1 | `9be7c697b` | Calculators: no `scrollTop` round-trip, one render per frame (C4) | `calc-tb-payg.ts`, `calc-tb-pc.ts` |
| 1 | `be1a40c1b` | Chat launcher hides beside the cookie card via `html[data-cc-open]`, not a root `:has()` (C6a) | `YourGptWidget.astro`, `CookieConsent.astro` |
| 2 | `b08264a0c` | `markdown.css` is kept off marketing pages; `Head.astro` inlines it where `.sl-markdown-content` renders (C1) | `starlight/Head.astro`, `MarkdownContent.astro`, `DocMarkdownContent.astro`, `IotHubMarkdown.astro`, `iot-hub/[category]/[slug].astro` |
| 3 | `7c14bd09d` | Pricing waves run as CSS transform animations on the compositor, not SMIL (C2) | `Pricing/PricingBackground.astro` |

Decided with the user:

- Ship 3 PRs. Cut each one fresh from `main` and cherry-pick its commits; they touch disjoint files. `perf/pricing-inp` itself is the test bed and never becomes a PR.
- C1 is fixed on our side (Starlight is not patched).
- GTM (C5) and the field INP reporting (fix-plan item 6) are out of scope for now.

Next steps:

1. The user tests `perf/pricing-inp`.
2. Cut `perf/pricing-calculators` (PR 1), `perf/markdown-css-scope` (PR 2) and `perf/pricing-waves` (PR 3) from `main`, then cherry-pick.
3. Run `pnpm lint:linkcheck` before review. It was not run: no links changed, but CI requires it.
4. Write the PR descriptions from the numbers below, then push and open the PRs. Each push needs the user's go-ahead.

### Changes beyond the original fix plan

- **IoT Hub leaked `markdown.css` too.** `IotHubMarkdown.astro` imported `markdown.css`, and its CSS chunk is shared with Starlight's `LinkButton`, so the rule reached every StarlightPage. The import is gone. The IoT Hub item page now sets `Astro.locals.bslMarkdownCss = true`, and `Head.astro` inlines the sheet for it.
- **Layer order is hand-copied.** `Head.astro` declares Starlight's layer order before the inlined sheet, copied from `node_modules/@astrojs/starlight/dist/style/layers.css`. That file is not in the package exports, so it can't be imported. Re-check the copy on Starlight upgrades.
- **Blurs commit through `commitCalculate(changed)`.** The calculators render on blur only when the state changed or a frame is queued. On touch, the blur and the next tap run in the same task, and that tap can read the rendered results. PC's Edge handlers call `renderedPlan()` first, which flushes a queued render.
- **Edge total in the PC message fixed.** In the PC calculator, the clipboard and Contact Us Edge total now follow the count after it is raised to the plan's included instances. This was a pre-existing bug.
- **Waves use HTML wrappers.** Each wave `<svg>` sits inside an HTML wrapper `<div>` that carries the animation. Chromium does not composite transform animations on SVG elements at zoom ≠ 1, and zoom includes DPR.
- **Comment syntax.** The HTML comments in `PricingBackground.astro` became `{/* */}`, so they no longer ship.

## Results (lab, this laptop: i7-10510U, integrated GPU)

Base is `main` and fix is `perf/pricing-inp`. Both were run with `pnpm build:fast` + `astro preview` and measured with `../measure/run.mjs --gpu`. Base and fix alternate within each round. Every /pricing/ interaction is included:

| Profile | Median | p75 | p98 | Rounds |
|---|---|---|---|---|
| desktop-1x | 128 → **56** ms | 144 → **64** | 184 → **88** | 2 |
| desktop-4x | 248 → **192** ms | 344 → **312** | 720 → **656** | 4 |
| mobile-4x | 232 → **112** ms | 304 → **144** | 424 → **296** | 2 |

`python3 scripts/summarize-ab.py runs` reproduces these numbers and lists the labels that got slower.

Absolute values are about 2.5× the research's prod numbers. On this laptop, presentation delay (GPU) dominates. With the user's desktop Chrome busy (its GPU process at ~80 % CPU), base came out about 6× slower. Close Chrome before timing.

What the work counts show:

- **C1:** restyled elements per DOM insertion on /pricing/ went from 1,141 to **60**, and forced style per mutation from ~50–80 ms to ~28 ms at 4×. Measured with `scripts/micro-served.mjs 4`; the output was not saved and is summarized here.
- **C1 build check:** 424 non-docs pages no longer carry the `:has(>li>…)` rule. No docs page lost it. Every page whose HTML has `class="…sl-markdown-content…"` still has it: docs, partner hardware samples and IoT Hub items.
- **C2:** the idle renderer main thread at mobile-4x went from 996 to **7** ms/s on /pricing/, and from 990 to **0.8** ms/s on /products/thingsboard-pe/ and /products/paas/. GPU main on /pricing/ desktop-1x went from 992 to 332 ms/s. See `idle/`.
- **C2 visuals:** 125 screenshot pairs cover 4 pages, desktop / wide / mobile and light / dark, at t = 0, 7.3 and 21.1 s. No pixel is off by more than 5/255, except one base capture taken before its SMIL field had finished rastering (`vis/outlier-…png`) and one capture whose width differs by a 15 px scrollbar. See `vis/vis-diff.txt`.
- **C4 behaviour:** releasing the slider at 72 / 80 / 90 % of the track now keeps 29,310 / 66,560 / 112,750; base gives 1,000 / 1,000 / 150,000. Results-panel scrolling matches base exactly. See `behavior/`.
- `pnpm check` and ESLint are clean on the fix branch.

### Not improved, or slower in some rounds (desktop-4x)

Sub-tab switches, the region switch, the upsell tab switch and calculator open are level or worse in some rounds. Desktop-4x drifted a lot between rounds: base region switch was ~200 ms in round 1 and ~400 ms in round 4.

A single traced PAYG calculator open is faster with the fix: the click task went from 197 to 104 ms, and the recalc after the click from 837 to 51 elements. Command:

```bash
node ../measure/itrace.mjs 4 '.pricing-section[data-section="thingsboard-pe"] .upsell-card-btn[onclick]' '--pre=.sub-tab[data-subtab="thingsboard-pe"]'
```

The higher style totals in those windows come from frames that now run at full rate. Every frame also pays for chat-hues on desktop (next section).

## Follow-ups found during the A/B

1. **chat-hues on desktop.** The launcher's infinite hue animation restyles ~18 elements every frame: about 2.3 ms per frame at 1× and about 6 ms at 4×, on every page while the launcher is visible. The C6a fix only covers phones while the cookie card is up. Make it compositor-only, finite, or paused when off-screen or idle.
2. **Homepage animations on mobile.** The homepage keeps the main thread ~89 % busy on mobile-4x through its own animations (logo marquee, terminal carets), with per-frame `Layerize` ≈ 10 ms. This is not caused by these fixes: base ran at 20 fps, the fix runs at 49 fps.
3. **Dark-theme wave colour never applies** (pre-existing). Astro scopes `[data-theme='dark'] .pricing-bg` to `:where(.astro-x)[data-theme=dark] …`, and `<html>` does not carry the scope class.
4. **Duplicate gradient ids** (pre-existing). The second background instance on a page resolves `url(#pbg-glow-*)` to the first instance's gradient.
5. **No waves on iOS 15 Safari.** The keyframes use container-query units, so where they aren't supported (iOS 15 Safari) the waves stand still at offset 0.

## Reproducing on another machine

```bash
git fetch origin
git switch perf/pricing-inp
git worktree add ../thingsboard.io-research origin/research/pricing-inp   # harness + base build (its src/ == main)
(cd ../thingsboard.io-research && pnpm install --frozen-lockfile && bash research/pricing-inp/measure/relocate.sh)
(cd ../thingsboard.io-research && pnpm build:fast)   # base; the first build with a cold image cache took ~1 h here
pnpm build:fast                                       # fix
```

To serve both builds, add these entries to `.claude/launch.json`, which is excluded locally. Then `preview_start` each one and close the pane tab so it doesn't compete for CPU:

```json
{ "name": "preview-base", "runtimeExecutable": "bash", "runtimeArgs": ["-c", "cd ../thingsboard.io-research && . \"$HOME/.nvm/nvm.sh\" && nvm use --silent && exec ./node_modules/.bin/astro preview --port 4331"], "port": 4331 },
{ "name": "preview-fix", "runtimeExecutable": "bash", "runtimeArgs": ["-c", ". \"$HOME/.nvm/nvm.sh\" && nvm use --silent && exec ./node_modules/.bin/astro preview --port 4332"], "port": 4332 }
```

Then:

```bash
bash research/pricing-inp/fixes-ab/scripts/full.sh   # timing A/B (2 rounds), C1 micro, idle traces, wave screenshots; ~75 min
python3 research/pricing-inp/fixes-ab/scripts/summarize-ab.py research/pricing-inp/measure
```

The harness scripts read `TB_ORIGIN` (default `https://thingsboard.io`), and `idletrace.mjs` also reads `TB_PATH` and `TB_TAG`. Run outputs land in `../measure/`; move them into `runs/` to keep them.

Run heavy node work under `systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0`. An OOM kill inside the desktop app's scope closes the whole app.
