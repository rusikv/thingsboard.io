# /pricing/ INP fixes — review, PRs and handoff (2026-10-14)

Continues [../fixes-ab/README.md](../fixes-ab/README.md) (the A/B of the fixes) and [../README.md](../README.md) (the investigation).

## State

Three PRs are open against `thingsboard/thingsboard.io` `main`, cut from `main` @ `eb2abc9a0`, reviewer vvlladd28 requested on each:

| PR | Branch (fork) | Commits |
|---|---|---|
| [#764](https://github.com/thingsboard/thingsboard.io/pull/764) Pricing calculators and chat launcher | `perf/pricing-calculators` | slider guard · calculators render once per frame · chat launcher `data-cc-open` · **new:** keyboard steps between the plan ticks |
| [#765](https://github.com/thingsboard/thingsboard.io/pull/765) Keep Starlight's markdown.css off marketing pages | `perf/markdown-css-scope` | one commit; **new:** layer order read from Starlight's `layers.css?inline`, shorter comments |
| [#766](https://github.com/thingsboard/thingsboard.io/pull/766) Pricing wave background on the compositor | `perf/pricing-waves` | waves · rename to `Landing/WaveBackground` · pricing imports via `@` aliases · **new:** dark-theme colour applies, `will-change` dropped |

The PR bodies are saved here as `pr1-body.md`, `pr2-body.md`, `pr3-body.md`. The test-bed branch `perf/pricing-inp` (fork) carries the same code as 9 commits on top of `e9cbd6dc4`; every PR branch was checked to be byte-identical to it on the files it touches.

Checks: `pnpm check` 0 errors, ESLint clean on all changed files, `git diff --check` clean, `pnpm lint:linkcheck` on `perf/pricing-inp` (the union of the three PRs) built and found no link issues.

## What was done on 2026-10-14

1. **Rename** `Pricing/PricingBackground.astro` → `Landing/WaveBackground.astro`, BEM classes `wave-bg*`, `--wave-bg-color`; all 7 placements (pricing, homepage ×2, PE ×2, Cloud ×2) re-checked: 28/28 wave animations composited at phone DPR, 0 main-thread paints while running (`../measure/bgcheck/compcheck.mjs`, results in the two JSON files there; run against a dev server with `TB_ORIGIN`).
2. **Pricing page imports** converted to `@components` / `@root/assets` / `@data` (SCSS `@use` stays relative).
3. **Code review** of the 7 commits: workflow `review.workflow.js` (5 area reviewers → 16 findings → 3 adversarial verifiers each). 17 of 48 verifications died on the account's session limit; the four fixes below were fully verified regardless. Full text: `findings-and-votes.txt`, raw: `review-result.json`.
4. **Fixes applied** (commits `491ab9135`, `119607e1d`, `83055ffd3`, `3f65c2754` on `perf/pricing-inp`, folded into the PR commits as listed above):
   - PAYG slider: a key press moved the range 0.01 and the release snap rounded it back, so the keyboard could never leave a plan tick. A `keydown` handler now steps a whole tick on the ticks; past the last tick the default applies. Verified with real key presses: 1,000 → 2,490 (continuous) → 1,000 → 500 → 100 → 100 → 500.
   - `Head.astro`: the `@layer` order is now `node_modules/@astrojs/starlight/dist/style/layers.css?inline` instead of a pasted string (the minifier strips Starlight's own statement from the bundle, so this inline one is the only one in the document).
   - `WaveBackground`: `:global([data-theme='dark']) .wave-bg` (the old rule compiled to `:where(.astro-x)[data-theme=dark]` and never matched); `will-change: transform` removed (redundant; pinned 4 field-sized layers per instance; Firefox will-change budget).
   - Comments trimmed in `YourGptWidget.astro`, `Head.astro`, `MarkdownContent.astro`, `DocMarkdownContent.astro`, `IotHubMarkdown.astro`. Commit messages note the dropped no-op analytics event (blur with no change) and the container-unit fallback (waves static on Safari ≤15).

## Decisions

- **Keep the `markdown.css` inlining workaround** (user decision), not a Starlight patch and not moving marketing pages off `StarlightPage`. PR #765's body explains the situation: root cause is Starlight PR [#3862](https://github.com/withastro/starlight/pull/3862) (0.39.0) whose list rule has a non-subject `:has()`; in Chrome every DOM insertion then restyles the whole document on any page carrying the sheet. Not a known Starlight issue (searched issues/PRs); the rule is unchanged on their `main` (latest 0.42.6). Docs pages still pay it. Real fix = upstream report with a rewrite that keeps the output (ancestor `:has()` moved to subject position via a custom property) — **not yet filed**.
- Review items deliberately **not** done: launcher hide threshold 432 px → `md` breakpoint (pre-existing since #735; between 432–749 px the launcher sits under the full-width cookie card); `App.Locals` typing for `bslMarkdownCss` (follows the existing untyped `bsl*` convention); per-instance gradient ids (pre-existing; second instance's glow takes the first one's colour).

## Why marketing pages carry Starlight CSS at all (context for the next step)

`BaseLayout` renders every marketing page through `<StarlightPage>` since Jun 5 2026 (`a3a57e30a`, "BaseStarlightLayout"), with `Astro.locals.bsl*` flags that make eight overridden Starlight components swap markup. The commit assumed the proxy split kept "the other variant's CSS bundle" off each route; Astro ships CSS by module graph, so it does not. On the built `/pricing/`: 225 KB CSS, 41 KB of it in Starlight layers, 176 `.sl-markdown-content` rules, 58 Starlight `:has()` rules, 26 `header.header:has()` rules. The old non-Starlight layout is in git at `a911692c4^:src/layouts/BaseLayout.astro`. Moving marketing pages off `StarlightPage` is the structural fix; scoped as a separate project, not started.

## Next steps

1. Watch the three PRs; address review. Each push needs the user's go-ahead.
2. File the Starlight issue (traces in `../measure/`, numbers in PR #765's body, selector rewrite in the Oct 14 session notes). When it ships, revert `Head.astro` to a plain import.
3. Re-read CrUX for `/pricing/` in the windows ending ~Oct 27 and ~Nov 3–10 (CrUX Vis: values are in the chart points' `aria-label`s; the tab must be in the foreground to render).
4. Follow-ups logged, not started: `chat-hues` restyles ~18 elements/frame on desktop (~6 ms/frame at 4×); field INP attribution (`web-vitals/attribution` `onINP`, consent-gated); GTM container click triggers (C5); launcher 432 px threshold; gradient ids; marketing pages off `StarlightPage`.
5. Optional: re-run the 17 failed verifications (`review.workflow.js` with `resumeFromRunId` replays the 36 cached agents).

## Reproducing the compositor check

```bash
# dev server on :4321 serving the branch under test
TB_ORIGIN=http://localhost:4321 node research/pricing-inp/measure/bgcheck/compcheck.mjs mobile 4 / /products/thingsboard-pe/ /products/paas/ /pricing/
```

Reports, per `.wave-bg` instance, whether Chrome composited each wave animation (`compositeFailed` trace events) and the renderer main-thread work with the waves running vs paused. Needs `google-chrome` and Node ≥ 22.
