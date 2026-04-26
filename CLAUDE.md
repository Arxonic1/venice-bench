# venice-bench — Claude context

## Venice integration
This is a Venice model benchmarking harness. It hits `https://api.venice.ai/api/v1` heavily across multiple models (see `src/venice.ts`, `src/config.ts`).

When working on Venice client code, load these skills from `~/.claude/skills/` (official Venice repo, swagger-synced):
- **venice-chat** — `/chat/completions` shape, `venice_parameters`, streaming, tool calls, prompt caching, structured output
- **venice-models** — `/models`, `/models/traits`, `/models/compatibility_mapping` — for model roster, capabilities, pricing
- **venice-errors** — 402 / 422 / 429 handling, retry strategy, rate-limit headers (matters here because benchmarks bursty-call)
- **venice-billing** — `/billing/balance`, `/billing/usage` — relevant for cost telemetry across runs

## Known gotchas (from agentic-os memory)
- Venice thinking models wrap output in `<think>` tags — strip before JSON parsing.
- Don't add expensive tier models (Opus-fast, GPT-pro, output ≥$50/M) to `data/pricing.json` — too pricey across 15 suites.
- Never assume Venice capabilities — verify against the swagger-synced skill files or `/models` API before asserting.
