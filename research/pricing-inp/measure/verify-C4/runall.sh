#!/bin/bash
cd /tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp/verify-C4
for round in 1 2; do
  for prof in desktop-4x mobile-4x; do
    for v in base fix; do
      timeout 420 node ab.mjs $prof $v --reps=4 > log-$prof-$v-r$round.txt 2>&1
    done
  done
done
echo ALLDONE
