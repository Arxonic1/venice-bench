export type SuiteName =
  | "tool-choice"
  | "json-schema"
  | "thinking-tag"
  | "extraction"
  | "long-context"
  | "latency"
  | "safety"
  | "prompt-cache"
  | "schema-hardness"
  | "multi-turn"
  | "refusal-calibration"
  | "tool-ambiguity"
  | "output-length"
  | "vision"
  | "podcast-triage"
  | "podcast-analysis";

export interface RunOptions {
  model: string;
  runs: number;
  concurrency: number;
  timeoutMs: number;
}

export interface CallResult {
  ok: boolean;
  latencyMs: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  totalTokens: number;
  content: string;
  toolCalls?: { name: string; args: unknown }[];
  finishReason?: string;
  error?: string;
  raw?: unknown;
}

export interface TrialResult {
  index: number;
  call: CallResult;
  passed: boolean;
  reasons: string[];
  metrics: Record<string, number | string | boolean>;
}

export interface SuiteResult {
  suite: SuiteName;
  model: string;
  startedAt: string;
  finishedAt: string;
  trials: TrialResult[];
  summary: SuiteSummary;
  skippedReason?: string;
}

export interface SuiteSummary {
  runs: number;
  passed: number;
  failed: number;
  passRate: number;
  latency: LatencyStats;
  tokens: {
    avgPrompt: number;
    avgCached: number;
    avgCompletion: number;
    totalPrompt: number;
    totalCached: number;
    totalCompletion: number;
    total: number;
  };
  cost: {
    perRunUsd: number | null;
    per1kRunsUsd: number | null;
    perSuccessUsd: number | null;
    totalUsd: number | null;
    breakdown: {
      inputUsd: number;
      cachedUsd: number;
      outputUsd: number;
    } | null;
  };
  suiteMetrics: Record<string, number | string>;
}

export interface LatencyStats {
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface Pricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedReadPerMillion?: number;
}
