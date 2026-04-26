import type { LatencyStats } from "./types.ts";

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

export function latencyStats(values: number[]): LatencyStats {
  if (values.length === 0) {
    return { mean: 0, median: 0, min: 0, max: 0, stdDev: 0, p90: 0, p95: 0, p99: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const variance =
    sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / sorted.length;
  return {
    mean,
    median: percentile(sorted, 50),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stdDev: Math.sqrt(variance),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

export function round(n: number, digits = 3): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
