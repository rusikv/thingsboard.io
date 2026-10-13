#!/usr/bin/env bash
# Point the harness scripts at this checkout, wherever earlier runs had them write.
# Run once after cloning: bash research/pricing-inp/measure/relocate.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AB="$(cd "$HERE/../fixes-ab/scripts" 2>/dev/null && pwd || true)"
grep -rIlE "'[^']*/research/pricing-inp/measure" "$HERE" ${AB:+"$AB"} --include='*.mjs' --include='*.py' --include='*.sh' --include='*.cjs' \
	| grep -v '/relocate.sh$' \
	| xargs -r sed -i -E "s#'[^']*/research/pricing-inp/measure#'$HERE#g"
echo "Scripts now write under $HERE"
