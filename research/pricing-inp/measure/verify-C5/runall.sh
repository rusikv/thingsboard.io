#!/bin/bash
cd /home/ruru/projects/thingsboard.io-research/research/pricing-inp/measure/verify-C5
for prof in desktop-1x desktop-4x mobile-4x; do
  for mode in nogtm gtm; do
    timeout 600 node gtm-ab.mjs $prof $mode 3 > log-$prof-$mode.txt 2>&1
  done
done
echo ALLDONE > done.txt
