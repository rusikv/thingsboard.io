#!/usr/bin/env bash
# A/B the local base (4331) and fix (4332) builds with the research harness.
# Rounds alternate which side goes first so drift (heat, background load) hits both.
# Usage: bash runall.sh <rounds> <profile...>
set -uo pipefail
. ~/.nvm/nvm.sh >/dev/null
M=$(cd "$(dirname "$0")/../../measure" && pwd)
rounds=$1; shift
cap() { systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 "$@"; }
for r in $(seq 1 "$rounds"); do
	if (( r % 2 )); then order="base fix"; else order="fix base"; fi
	for prof in "$@"; do
		for v in $order; do
			port=4331; [[ $v == fix ]] && port=4332
			echo "== round $r $prof $v $(date +%T)"
			TB_ORIGIN=http://localhost:$port cap node "$M/run.mjs" "$prof" --gpu --tag="$v-r$r" > "$M/ab-log-$prof-$v-r$r.txt" 2>&1
			echo "   exit $? $(date +%T)"
		done
	done
done
