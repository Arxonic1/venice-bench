#!/usr/bin/env bash
# Re-runs the (model, suite) pairs that were rate-limited on prior attempts.
# Sequential, -c 1, --timeout 240000 to dodge Venice per-model RPM caps.
# Logs per-pair stderr + a summary table. Designed for overnight `at` execution.

set -u
cd "$(dirname "$0")/.."
mkdir -p logs

LOG="logs/rerun-rate-limited-$(date +%Y%m%dT%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

echo "===== rerun-rate-limited start: $(date) ====="

PAIRS=(
  "google-gemma-3-27b-it|latency|20"
  "aion-labs-aion-2-0|latency|20"
  "claude-opus-4-6|latency|5"
  "deepseek-v3.2|schema-hardness|5"
  "deepseek-v3.2|thinking-tag|5"
  "deepseek-v3.2|refusal-calibration|5"
  "deepseek-v4-pro|latency|5"
  "deepseek-v4-pro|json-schema|5"
  "qwen3-5-397b-a17b|latency|5"
  "kimi-k2-thinking|latency|5"
  "qwen3-coder-480b-a35b-instruct-turbo|podcast-analysis|10"
  "qwen3-235b-a22b-instruct-2507|podcast-analysis|10"
)

declare -a RESULTS

for pair in "${PAIRS[@]}"; do
  IFS='|' read -r MODEL SUITE N <<<"$pair"
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
echo "===== rerun-rate-limited end ====="
