# venice-bench

A CLI harness that benchmarks [Venice AI](https://venice.ai) models across 16 task suites, then renders HTML reports with per-run **cost, latency, and pricing-tier telemetry**. Pick a baseline model, run any suite against any other model, and every result is auto-compared to the baseline.

Built on the Venice API (`/chat/completions`, `/models`). TypeScript, runs on Node via [`tsx`](https://github.com/privatenumber/tsx) — no build step.

## What it measures

Each suite scores a model on a specific capability and reports a pass rate plus cost/latency:

| Suite | What it probes |
|-------|----------------|
| `tool-choice` | Picks the right tool when one clearly fits |
| `tool-ambiguity` | Restraint when no tool fits / multiple plausibly fit |
| `json-schema` | Conforms to a requested JSON schema |
| `schema-hardness` | Holds up under adversarial / deeply-nested schemas |
| `thinking-tag` | Reasoning models emit clean output (strips `<think>` tags) |
| `extraction` | Pulls structured fields from messy text |
| `long-context` | Recall across a large context window |
| `multi-turn` | Coherence over a multi-turn conversation |
| `refusal-calibration` | Refuses what it should, answers what it shouldn't refuse |
| `safety` | Safety-boundary behaviour |
| `output-length` | Respects length constraints |
| `prompt-cache` | Prompt-cache hit behaviour |
| `latency` | Time-to-first-token and total latency under load |
| `vision` | Image-understanding tasks |
| `podcast-triage` | Domain suite — triage of podcast transcripts |
| `podcast-analysis` | Domain suite — structured podcast analysis |

## Install

```bash
git clone https://github.com/Arxonic1/venice-bench.git
cd venice-bench
npm install
cp .env.example .env   # add your VENICE_API_KEY
```

## Configure

Set in `.env`:

| Var | Required | Purpose |
|-----|----------|---------|
| `VENICE_API_KEY` | ✅ | Venice API key |
| `VENICE_BASE_URL` | — | Defaults to `https://api.venice.ai/api/v1` |
| `BENCHMARK_MODEL` | — | Baseline model every other run is compared to |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | — | Optional — persist runs to enable cross-run drift tracking |
| `MONTHLY_BUDGET_USD` | — | Optional — dashboard shows a spend bar over the last 30 days of runs |

## Usage

```bash
# List Venice text models and their capabilities (tools / reasoning / schema / vision / web)
npm run bench -- models --filter llama

# Run one suite against one model (20 runs, concurrency 3 by default)
npm run bench -- run --suite json-schema --model qwen-2.5-qwq-32b --runs 20

# Run every suite against one model and emit a combined report
npm run bench -- run-all --model qwen3-235b

# Concurrency-ladder load test — throughput, P95/P99 latency, error rate per tier
npm run bench -- load --model qwen3-235b

# Drift: flag suites whose pass rate moved vs the median of prior runs (needs Supabase)
npm run bench -- drift

# Manage the comparison baseline
npm run bench -- baseline

# Browse / re-render results
npm run bench -- list
npm run bench -- report <runId>
npm run bench -- compare <runIdA> <runIdB>

# Serve every run at a single local dashboard URL (index + per-run reports + cost rollups)
npm run bench -- serve
```

A static snapshot of the dashboard can be generated with `npm run snapshot`.

## How it works

- `src/venice.ts` / `src/config.ts` — Venice API client and configuration.
- `src/suites/` — one file per benchmark suite (the table above).
- `src/runner.ts` — executes a suite with bounded concurrency, retries on Venice 429/402.
- `src/stats.ts` / `src/baseline.ts` / `src/drift.ts` — scoring, baseline comparison, drift detection.
- `data/pricing.json` — per-model input/output pricing used to compute run cost.
- `src/render/` — HTML report generation (matrix, radar, pareto, trends, etc.).
- `supabase/schema.sql` — optional Postgres schema for persisting runs.

## License

[MIT](./LICENSE)
