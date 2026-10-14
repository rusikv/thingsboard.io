Third of three PRs from the `/pricing/` INP investigation (first: calculators and chat launcher; second: Starlight's `markdown.css`). This one moves the animated wave background to the GPU compositor, renames the component to what it is, and tidies the pricing page's imports.

**The problem.** `PricingBackground` drove its four waves with SMIL `<animateTransform>`, looping forever. Chromium never composites SMIL: every frame, 60 times a second, it re-ran SVG style and layout on the main thread and re-rastered the whole masked, 3D-rotated field on the GPU process (~650 ms of GPU-main time per second at idle on desktop). Every tap's next paint queued behind that. Lighthouse cannot see it: its non-composited-animation audit and `getAnimations()` ignore SMIL. The component also renders twice each on the homepage and the PE and Cloud product pages.

**The rework.** Same paths, opacities, speeds and directions; each wave is now its own `<svg>` inside an HTML wrapper `<div>`, moved by a CSS `translateY` keyframe animation that the compositor runs alone:
- One layer per wave, because the waves move at different speeds and elements inside one SVG cannot get their own compositor layer.
- A `<div>` wrapper rather than animating the `<svg>`: Chromium does not composite transform animations on SVG elements whose zoom is not 1, and device pixel ratio counts as zoom, so on phones it would have fallen back to the main thread.
- Distances in container-query units, `max(100cqw, 100cqh) × k / 900`, since `preserveAspectRatio: slice` scales the 900-unit viewBox to the larger side of the box; a `%` would follow the height alone and be wrong on wide or phone boxes. Where those units are unsupported (Safari 15 and older) the waves render but stand still.
- Rotation, mask, reduced-motion rule, `print:hidden` and `aria-hidden` unchanged. Template comments became `{/* */}`, so they no longer ship in the HTML.

**Rename.** It backs four pages now, so it is `Landing/WaveBackground.astro` with Landing's BEM naming (`wave-bg`, `wave-bg__field`, `wave-bg__wave--a`…, `--wave-bg-color`), and the pricing page imports it, and everything else, through the `@` aliases.

**Two small fixes on top.** The dark-theme colour rule was scoped onto the theme attribute, which sits on `<html>` outside the component's scope, so it never matched; it does now (`#6b9aff` in dark). `will-change: transform` was redundant, a running transform animation is composited on its own, and it pinned four field-sized layers per instance.

**Measured** (base vs fix, local production builds, `research/pricing-inp/fixes-ab/` on the fork): idle renderer main thread at mobile 4× on `/pricing/` 996 → **7 ms/s**, on the PE and Cloud pages 990 → 0.8 ms/s; GPU-main on desktop `/pricing/` 992 → 332 ms/s; the homepage went from 20 to 49 fps on a throttled phone. All 28 wave animations across the seven placements report as composited in Chrome at phone DPR, with zero main-thread paints while they run. Combined with the other two PRs, median interaction latency on `/pricing/` went 128 → 56 ms on desktop and 232 → 112 ms on a throttled phone.

For a reviewer:

- **Visuals:** 125 screenshot pairs (4 pages × desktop/wide/mobile × light/dark, at three points in the loop) match within 5/255 per pixel. Each section's colour override still applies (green on PE, light blue in the dark sections). The one intended visual change is the dark-theme colour on `/pricing/`, which the original rule meant to apply.
- **Pre-existing, left for follow-ups:** the two glow gradients have fixed ids, so on pages with two instances the second instance's glow takes the first one's colour; and the chat launcher's hue animation still restyles ~18 elements per frame on desktop.
- `pnpm check` and ESLint are clean.
