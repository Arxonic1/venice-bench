import { createClient } from "@supabase/supabase-js";
import {
  SUPABASE_ENABLED,
  SUPABASE_SERVICE_KEY,
  SUPABASE_URL,
} from "./config.ts";
import type { SuiteResult } from "./types.ts";

export function sbClient() {
  if (!SUPABASE_ENABLED) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

export async function writeSuiteResult(
  runId: string,
  result: SuiteResult,
): Promise<void> {
  const client = sbClient();
  if (!client) return;
  const row = {
    run_id: runId,
    suite: result.suite,
    model: result.model,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
    runs: result.summary.runs,
    passed: result.summary.passed,
    failed: result.summary.failed,
    pass_rate: result.summary.passRate,
    latency: result.summary.latency,
    tokens: result.summary.tokens,
    cost: result.summary.cost,
    suite_metrics: result.summary.suiteMetrics,
    trials: result.trials.map((t) => ({
      index: t.index,
      passed: t.passed,
      reasons: t.reasons,
      metrics: t.metrics,
      latency_ms: t.call.latencyMs,
      prompt_tokens: t.call.promptTokens,
      completion_tokens: t.call.completionTokens,
      error: t.call.error ?? null,
    })),
  };
  const { error } = await client.from("venice_bench_results").insert(row);
  if (error) {
    console.error(`[supabase] insert failed: ${error.message}`);
  }
}
