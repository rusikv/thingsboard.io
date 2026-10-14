First of three PRs from the `/pricing/` INP investigation. CrUX for the page: phone INP p75 **319 ms** (failing), desktop 166 ms against 77 ms for the origin. Lab load scores are already 99/100, so all of this is about what happens *after* a tap. This PR takes the calculators and the chat launcher; the other two take Starlight's `markdown.css` and the wave background.

**PAYG slider bug (since the 4.4 release).** The release snap's guard was `v <= 4` on a slider whose max is 3, so it was always true and every release in the continuous 1,000–150,000 range snapped to 1,000 or 150,000. Now `v <= SM_LAST_TICK`: releases at 72 / 80 / 90 % of the track keep 29,310 / 66,560 / 112,750 devices.

**Keyboard on the slider.** A key press moves the range by one 0.01 step, which the release snap rounded straight back onto the current tick, so the keyboard could never reach the next plan tick. On the ticks a key now moves a whole tick; past the last tick the default step applies.

**Calculators render once per frame, with no forced layout.** Every render read the results panel's `scrollTop`, replaced `innerHTML`, then wrote `scrollTop` back: two forced style+layout passes per render, and some interactions rendered twice in one frame (a slider key press fires `input` and `change`; on touch, the previous input's `blur` and the next tap run in one task). Now:
- The `scrollTop` round-trip is gone. The panel keeps its scroll position on its own (the scroller is the results element's parent; only children are swapped). Verified identical to before, including the clamp when content shrinks.
- All click and change handlers queue through the existing rAF coalescer; a direct `calculate()` cancels the queued frame, so the latest state always wins.
- A blur renders right away only when normalising changed the state or a frame is queued. On touch the next tap's click runs in the same task and can read the rendered results, so it can't be deferred. A blur that changes nothing no longer pushes a `calculator_interaction`; the payloads of the events that are pushed are unchanged.
- Private Cloud: the Edge handlers flush a queued render first, since the render may switch the plan that sizes the Edge count. The Edge total in the clipboard and Contact Us message now follows the count after it is raised to the plan's included instances (it reported the old count before).

**Chat launcher beside the cookie card.** Under 432 px the launcher hid itself with `:root:has(#cc-main .cm:not([hidden]))`. Its hue animation restyles it every frame, and each restyle re-ran that `:has()` over the whole document: 6–9 ms per frame at 4× CPU on every phone page view, card or no card. The cookie card now sets `data-cc-open` on `<html>` where it shows itself and removes it where a choice hides it; the rule is `:root[data-cc-open] .chat-launcher`, and the hidden launcher drops its hue animation (dropped, not paused: `syncHues` sets `startTime`, which would restart a paused one).

**Measured** (base vs fix, local production builds, `research/pricing-inp/fixes-ab/` on the fork): forced layouts per calculator render 2 → 0; calculator interactions at 4× CPU 40–185 ms faster on desktop (slider ArrowRight 276 → 92, PC add-on switch 216 → 140) and 90–175 ms on mobile (Edge switch after typing 348 → 192, PC add-on 328 → 160). The launcher rule alone kept the throttled phone main thread 57–78 % busy at idle; it is now ~25–40 %, the rest being the waves (PR 3).

For a reviewer:

- **No visual change.** Results-panel scrolling, the sub-tab fade and every calculator value were compared against base with the same inputs.
- **One analytics change, intentional:** the dropped no-op event on a blur that changed nothing. Everything else that pushes to `dataLayer` pushes the same payload.
- **The launcher's 432 px threshold is pre-existing** and assumes the desktop card width; the card is full-width under 750 px since #735, so between 432 and 749 px the launcher sits under the card. Left for a follow-up.
- `pnpm check` and ESLint are clean.
