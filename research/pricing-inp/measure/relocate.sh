#!/usr/bin/env bash
# Point the harness scripts at this checkout instead of the original scratch directory.
# Run once after cloning: bash research/pricing-inp/measure/relocate.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OLD='/tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp'
grep -rIl "$OLD" "$HERE" --include='*.mjs' --include='*.py' --include='*.sh' --include='*.cjs' \
	| grep -v '/relocate.sh$' \
	| xargs -r sed -i "s#$OLD#$HERE#g"
echo "Scripts now write under $HERE"
