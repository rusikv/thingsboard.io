#!/bin/bash
cd /home/ruru/projects/thingsboard.io-research/research/pricing-inp/measure/verify-C4
for round in 1 2; do
  for prof in desktop-4x mobile-4x; do
    for v in base fix; do
      timeout 420 node ab.mjs $prof $v --reps=4 > log-$prof-$v-r$round.txt 2>&1
    done
  done
done
echo ALLDONE
