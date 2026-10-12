# /pricing/ — PSI + CrUX snapshot, 2026-10-12

PSI analysis: https://pagespeed.web.dev/analysis/https-thingsboard-io-pricing/213hxpm9ij (Lighthouse 13.5.0, 5:18 PM GMT+3)

## Lab
| | Perf | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|
| mobile | 99 | 1.5s | 1.8s | 10ms | 0 | 1.5s |
| desktop | 100 | 0.4s | 0.4s | 0ms | 0 | 0.6s |
July 7 baseline: mobile 95 (TBT 230) / desktop 77 (TBT 530).

Leftovers: forced reflow (unattributed 49-79ms), non-composited animations (html --promo-cur "promo-collapse", #chat-launcher --chat-hue "chat-hues"), 4 award badges 521px shown at 80px (~93 KiB), 12 KiB unused CSS, LCP element render delay 380/530ms.

## Field (CrUX, Sep 12 – Oct 9)
| | LCP | INP | CLS | FCP | TTFB | CWV |
|---|---|---|---|---|---|---|
| URL phone | 0.8s | **319ms** (46/46/8) | 0.01 | 0.7s | 0.3s | FAILED |
| URL desktop | 0.5s | 166ms (81/16/2) | 0.01 | 0.5s | 0.2s | passed |
| origin phone | 1.0s | 182ms (78/18/4) | 0.01 | 0.8s | 0.5s | passed |
| origin desktop | 0.6s | 77ms (96/3/1) | 0.01 | 0.4s | 0.2s | passed |
URL traffic: ~86% desktop, ~14% phone.

## CrUX Vis history (p75, 28-day windows)
Desktop INP /pricing/: 93–98 (Dec–Apr) → 101 (→May 23) → 120 (→Jun 6) → 132 (→Jun 20) → 150 (→Jul 18) → 164 (→Aug 1) → 176–181 (Aug) → 177 (→Oct 3)
Phone INP /pricing/: 197–256 (Dec–May) → 267 (→Jun 6) → 306 (→Jun 20) → 250 (→Jul 25) → 272 (→Aug 1) → 329 (→Aug 8) → 339 peak (→Sep 5) → 302 (→Oct 3)
Origin desktop INP: 64–67 until mid-July → 72–76 since.
Desktop /pricing/ TTFB 370 → 177 ms, LCP 750 → 550 ms, FCP 650 → 495 ms in the May window = new site launch.
