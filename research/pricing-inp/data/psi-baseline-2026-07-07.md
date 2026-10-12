# Official PSI baseline (pagespeed.web.dev, mobile) — BEFORE PR #536 deploy
Captured via user-shared analysis links, extracted with headless Chrome.

## /pricing/ — Jul 7 2026, 5:10 PM GMT+3, Lighthouse 13.4.0
link: https://pagespeed.web.dev/analysis/https-thingsboard-io-pricing/0obfy0yug1?form_factor=mobile
Lab (mobile, Moto G Power emulation, 1.2x CPU slowdown simulated):
- Performance: 95 | A11y: 96 | Best Practices: 81 | SEO: 100
- FCP 1.7s | LCP 1.8s | TBT 230ms | CLS 0 | SI 1.7s
Field (CrUX 28d, Jun 8–Jul 5): LCP 1.0s (95% good) | INP 301ms (FAILING, 48% good) | CLS 0 | FCP 0.8s | TTFB 0.4s
CWV assessment: FAILED (because of INP)
Lab DESKTOP (same analysis link, ?form_factor=desktop, captured 5:11 PM):
- Performance: 77 | A11y: 100 | Best Practices: 81 | SEO: 100
- FCP 0.4s | LCP 0.6s | TBT 530ms | CLS 0.024 | SI 0.8s
NOTE: one pagespeed.web.dev analysis link contains BOTH form factors — extract both per link.

## /iot-hub/devices/ — Jul 7 2026, 5:28 PM GMT+3, Lighthouse 13.4.0
link: https://pagespeed.web.dev/analysis/https-thingsboard-io-iot-hub-devices/df6wb131ft?form_factor=mobile
Lab MOBILE: Performance 88 | FCP 1.3s | LCP 2.0s | TBT 450ms | CLS 0 | SI 1.4s (a11y 89, BP 81, SEO 100)
Lab DESKTOP: Performance 84 | FCP 0.3s | LCP 0.6s | TBT 360ms | CLS 0 | SI 0.5s (a11y 97, BP 81, SEO 100)
Field (CrUX): LCP 1.1s | INP 163ms (good) | CLS 0.01
## /iot-hub/devices/m5stack-timer-camera-x/ — Jul 7 2026, 5:35 PM GMT+3, Lighthouse 13.4.0
link: https://pagespeed.web.dev/analysis/https-thingsboard-io-iot-hub-devices-m5stack-timer-camera-x/25ig4qxz3j?form_factor=mobile
Lab MOBILE: Performance 88 | FCP 1.3s | LCP 2.9s | TBT 340ms | CLS 0.006 | SI 1.3s (a11y 100, BP 81, SEO 100)
Lab DESKTOP: Performance 99 | FCP 0.3s | LCP 0.4s | TBT 120ms | CLS 0 | SI 0.4s (a11y 100, BP 81, SEO 100)
Field: LCP 1.1s | INP 163ms | CLS 0.01 (same values as /iot-hub/devices/ — likely origin-level fallback, page has too little URL traffic)
## /iot-hub/solution-templates/smart-irrigation/ — Jul 7 2026, 5:41 PM GMT+3, Lighthouse 13.4.0
link: https://pagespeed.web.dev/analysis/https-thingsboard-io-iot-hub-solution-templates-smart-irrigation/yq9szi8ng0?form_factor=mobile
Lab MOBILE: Performance 66 | FCP 1.2s | LCP 6.5s | TBT 450ms | CLS 0 | SI 1.2s (a11y 93, BP 81, SEO 100)
Lab DESKTOP: Performance 88 | FCP 0.3s | LCP 2.1s | TBT 120ms | CLS 0 | SI 0.6s (a11y 93, BP 81, SEO 100)
Field: origin-level fallback (same as above). Confirms local baseline (63/7201ms) — LCP fix is the PARKED remote-images branch, not #536.
## /blog/thingsboard-4-2-release-reporting-2-0-.../ — Jul 7 2026, 5:42 PM GMT+3, Lighthouse 13.4.0
link: https://pagespeed.web.dev/analysis/https-thingsboard-io-blog-thingsboard-4-2-release-reporting-2-0-ai-integration-secrets-management-and-more/9d3f11z2lr?form_factor=mobile
Lab MOBILE: Performance 97 | FCP 1.4s | LCP 2.5s | TBT 0ms | CLS 0 | SI 1.4s (a11y 100, BP 100, SEO 100)
Lab DESKTOP: Performance 100 | FCP 0.3s | LCP 0.5s | TBT 70ms | CLS 0.006 | SI 0.4s (a11y 100, BP 81, SEO 100)
Field: origin-level fallback. NOTE: ticket's 11.1s LCP claim NOT reproduced by PSI — page already scores 97/100; the 863KB image sits below the fold so it isn't the LCP element here.

## Summary table (lab Performance, mobile / desktop) — BEFORE #536 deploy
| route | mobile | desktop | binding constraint |
|---|---|---|---|
| /pricing/ | 95 | 77 | desktop TBT 530ms; field INP 301ms FAILING |
| /iot-hub/devices/ | 88 | 84 | TBT 450/360ms |
| /iot-hub/devices/m5stack-timer-camera-x/ | 88 | 99 | mobile TBT 340ms + LCP 2.9s (remote img) |
| /iot-hub/solution-templates/smart-irrigation/ | 66 | 88 | mobile LCP 6.5s (remote img — parked branch) |
| /blog/…4-2-release…/ | 97 | 100 | none — already healthy |
