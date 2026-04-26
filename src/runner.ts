import pLimit from "p-limit";
import { pricingFor } from "./config.ts";
import { latencyStats } from "./stats.ts";
import type {
  RunOptions,
  SuiteName,
  SuiteResult,
  SuiteSummary,
  TrialResult,
} from "./types.ts";

export interface Suite {
  name: SuiteName;
  description: string;
  runTrial: (opts: RunOptions, index: number) => Promise<TrialResult>;
  computeMetrics?: (trials: TrialResult[]) => Record<string, number | string>;
}

export async function runSuite(
  suite: Suite,
  opts: RunOptions,
): Promise<SuiteResult> {
  const startedAt = new Date().toISOString();
  const limit = pLimit(opts.concurrency);
  const trials: TrialResult[] = await Promise.all(
    Array.from({ length: opts.runs }, (_, i) =>
      limit(() => suite.runTrial(opts, i)),
    ),
  );
  const finishedAt = new Date().toISOString();
  const summary = buildSummary(trials, opts.model, suite.computeMetrics);
  return {
    suite: suite.name,
    model: opts.model,
    startedAt,
    finishedAt,
    trials,
    summary,
  };
}

function buildSummary(
  trials: TrialResult[],
  model: string,
  computeMetrics?: (trials: TrialResult[]) => Record<string, number | string>,
): SuiteSummary {
  const latencies = trials.filter((t) => t.call.latencyMs > 0).map((t) => t.call.latencyMs);
  const passed = trials.filter((t) => t.passed).length;
  const promptTokens = trials.reduce((a, t) => a + t.call.promptTokens, 0);
  const cachedTokens = trials.reduce(
    (a, t) => a + (t.call.cachedTokens || 0),
    0,
  );
  const completionTokens = trials.reduce(
    (a, t) => a + t.call.completionTokens,
    0,
  );
  const totalTokens = promptTokens + completionTokens;
  const n = trials.length || 1;

  const pricing = pricingFor(model);
  let totalUsd: number | null = null;
  let perRunUsd: number | null = null;
  let perSuccessUsd: number | null = null;
  let breakdown: { inputUsd: number; cachedUsd: number; outputUsd: number } | null = null;
  if (pricing) {
    const uncachedPrompt = Math.max(promptTokens - cachedTokens, 0);
    const cachedRate = pricing.cachedReadPerMillion ?? pricing.inputPerMillion;
    const inputUsd = (uncachedPrompt / 1_000_000) * pricing.inputPerMillion;
    const cachedUsd = (cachedTokens / 1_000_000) * cachedRate;
    const outputUsd = (completionTokens / 1_000_000) * pricing.outputPerMillion;
    totalUsd = inputUsd + cachedUsd + outputUsd;
    perRunUsd = totalUsd / n;
    perSuccessUsd = passed > 0 ? totalUsd / passed : null;
    breakdown = { inputUsd, cachedUsd, outputUsd };
  }

  return {
    runs: trials.length,
    passed,
    failed: trials.length - passed,
    passRate: trials.length ? passed / trials.length : 0,
    latency: latencyStats(latencies),
    tokens: {
      avgPrompt: promptTokens / n,
      avgCached: cachedTokens / n,
      avgCompletion: completionTokens / n,
      totalPrompt: promptTokens,
      totalCached: cachedTokens,
      totalCompletion: completionTokens,
      total: totalTokens,
    },
    cost: {
      perRunUsd,
      per1kRunsUsd: perRunUsd != null ? perRunUsd * 1000 : null,
      perSuccessUsd,
      totalUsd,
      breakdown,
    },
    suiteMetrics: computeMetrics ? computeMetrics(trials) : {},
  };
}

export function makeTrial(
  index: number,
  call: TrialResult["call"],
  passed: boolean,
  reasons: string[],
  metrics: Record<string, number | string | boolean> = {},
): TrialResult {
  return { index, call, passed, reasons, metrics };
}
