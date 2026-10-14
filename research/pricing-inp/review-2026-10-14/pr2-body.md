Second of three PRs from the `/pricing/` INP investigation (first: the calculators and chat launcher; third: the wave background). This one is a scoping fix for a Starlight stylesheet, and the situation deserves a full description, because the fix is deliberately not at the root.

**The root cause is in Starlight.** Starlight 0.39.0 ([#3862](https://github.com/withastro/starlight/pull/3862), merged May 6) rewrote the list-spacing rule in `markdown.css` as

```css
.sl-markdown-content :is(ol, ul):has(> li > :not(a, strong, …, ol, ul)) > li > :is(…) { margin-bottom: 1.25rem; }
```

The `:has()` sits on an ancestor of the element being styled, not on the element itself. Chrome cannot narrow such a check, so on **every DOM insertion or removal anywhere on a page that has this CSS, it marks the whole document for restyle**. The PR discussion only covers visual correctness; the cost was never raised, and it is not a known issue in Starlight's tracker. The rule is unchanged on their `main`.

**How it reached the pricing page.** Astro ships CSS by what a route *imports*, not by what it *renders*. Our `MarkdownContent` override imports `DocMarkdownContent`, which imported `markdown.css`; `IotHubMarkdown` imported it too and shared a CSS chunk with Starlight's `LinkButton`. So the sheet went to every BaseLayout page, where nothing matches it. On `/pricing/` the calculators replace the results panel's `innerHTML` on every change, and the billing toggles write `textContent`; each of those restyled **1,141 elements instead of 60**, two to three times per interaction. The rule shipped here with the Jun 30 Starlight upgrade, and desktop INP for the page rose from ~132 to ~177 ms over the following CrUX windows.

**The fix.** The two imports are gone. `starlight/Head.astro` now inlines `markdown.css` (via `?inline`) only on pages that render `.sl-markdown-content`: every page that is not BaseLayout (docs, the partner hardware sample pages), plus BaseLayout pages that opt in with `Astro.locals.bslMarkdownCss` (the IoT Hub item page). The inline sheet lands ahead of the bundled CSS, so it declares Starlight's layer order first, read from Starlight's own `layers.css` so an upgrade cannot leave it stale.

**Measured** (prod A/B with only this rule removed, 4 alternating rounds at 4× CPU): calculator interactions roughly halved (PAYG slider 264 → 144 ms, PC add-on switch 224 → 112, PC slider 168 → 96), billing toggles 10–35 ms faster, tab/region/FAQ taps unchanged, no measurable change on a fast desktop. On the fixed build: 1,141 → 60 restyled elements per DOM insertion; forced style per mutation ~50–80 ms → ~28 ms at 4×.

**Why not fix the rule itself.** It lives in `node_modules`. The options were a `pnpm patch` of Starlight (a patched dependency to re-check on every upgrade, and the old 0.38 selector changes docs list spacing in two edge cases) or scoping the sheet to where it is used. This PR does the latter: it is behaviour-neutral everywhere and needs nothing carried across upgrades. It does **not** help docs pages, which still pay the restyle on every DOM change (search typing, tabs); that only an upstream fix can address, and a Starlight issue with the traces and a selector rewrite that keeps the output is the next step. Once that lands, the inlining in `Head.astro` can go back to a plain import.

For a reviewer:

- **Build check:** 424 non-docs pages no longer carry the rule; no docs page lost it; every page whose HTML contains `sl-markdown-content` (docs, partner samples, IoT Hub items) still has it.
- **Cascade is unchanged.** `markdown.css` was already the page's first `starlight.content` block (the bundle's own `@layer` statement is folded away by the minifier), so declaring the order inline reproduces what the browser saw before. IoT Hub readmes, which tie with `markdown.css` on a few properties, resolve identically; dark theme there is intact.
- `bslMarkdownCss` follows the existing `bsl*` convention on `Astro.locals`; it is untyped like the others.
- 8.8 KB of CSS is now inlined per docs page instead of coming from the cached bundle.
- `pnpm check` and ESLint are clean.
