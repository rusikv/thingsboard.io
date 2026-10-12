#!/bin/bash
cd /tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp/verify-C5
for prof in desktop-1x desktop-4x mobile-4x; do
  for mode in nogtm gtm; do
    timeout 600 node gtm-ab.mjs $prof $mode 3 > log-$prof-$mode.txt 2>&1
  done
done
echo ALLDONE > done.txt
