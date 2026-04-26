#!/usr/bin/env bash
# Reruns the 2 latency pairs that died on HTTP 429 with no retry.
# 60s pre-warm idle + 90s gap between models so neither catches backoff fallout.

set -u
cd "$(dirname "$0")/.."
mkdir -p logs

LOG="logs/rerun-latency-isolated-$(date +%Y%m%dT%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

echo "===== rerun-latency-isolated start: $(date) ====="
echo "Pre-warm idle 60s to clear any residual Venice throttle..."
sleep 60

PAIRS=(
  "qwen3-5-397b-a17b|latency|5"
  "kimi-k2-thinking|latency|5"
)

declare -a RESULTS
first=1

for pair in "${PAIRS[@]}"; do
  IFS='|' read -r MODEL SUITE N <<<"$pair"
  if [[ $first -eq 0 ]]; then
    echo
    echo "----- inter-pair gap 90s -----"
    sleep 90
  fi
  first=0
  echo
  echo "----- $(date +%H:%M:%S)  $MODEL  ·  $SUITE  ·  n=$N -----"
  if ./bin/venice-bench.mjs run -s "$SUITE" -m "$MODEL" -n "$N" -c 1 --timeout 240000; then
    RESULTS+=("OK    $MODEL · $SUITE")
  else
    RESULTS+=("FAIL  $MODEL · $SUITE  (exit $?)")
  fi
done

echo
echo "===== summary ($(date)) ====="
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo "===== rerun-latency-isolated end ====="
