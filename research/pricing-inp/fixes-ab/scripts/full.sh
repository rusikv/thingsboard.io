#!/usr/bin/env bash
# Everything CPU-sensitive, one after another: timing A/B, work counts, wave screenshots.
set -uo pipefail
. ~/.nvm/nvm.sh >/dev/null
S=$(cd "$(dirname "$0")" && pwd)
M=$(cd "$(dirname "$0")/../../measure" && pwd)
cap() { systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 "$@"; }
origin() { [[ $1 == fix ]] && echo http://localhost:4332 || echo http://localhost:4331; }

echo "## timing A/B $(date +%T)"
bash "$S/runall.sh" 2 desktop-1x desktop-4x mobile-4x

echo "## restyle counts per DOM mutation $(date +%T)"
for v in base fix; do
	TB_ORIGIN=$(origin $v) cap node "$M/verify-C1/micro.mjs" 4 > "$S/micro-$v.txt" 2>&1
	echo "   micro $v exit $?"
done

echo "## idle traces $(date +%T)"
for page in /pricing/ / /products/thingsboard-pe/ /products/paas/; do
	slug=$(echo "$page" | tr '/' '_')
	for kind in "mobile 4" "desktop 1"; do
		set -- $kind
		for v in base fix; do
			TB_ORIGIN=$(origin $v) TB_PATH=$page TB_TAG="$v$slug" cap node "$M/idletrace.mjs" $1 $2 > "$S/idle-$v-$1$2$slug.txt" 2>&1
			echo "   idle $v $1-$2x $page exit $?"
		done
	done
done
rm -f "$M"/idletrace-*.json

echo "## wave screenshots $(date +%T)"
for v in base fix; do
	cap node "$S/vis-waves.mjs" "$(origin $v)" $v "$S/vis-$v" > "$S/vis-$v.log" 2>&1
	echo "   vis $v exit $?"
done
python3 "$S/diff-vis.py" "$S/vis-base" "$S/vis-fix" > "$S/vis-diff.txt" 2>&1
echo "## done $(date +%T)"
