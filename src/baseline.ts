import fs from "node:fs";
import path from "node:path";
import { BASELINE_DIR, BENCHMARK_MODEL } from "./config.ts";
import type { SuiteResult } from "./types.ts";

export interface BaselineSnapshot {
  model: string;
  capturedAt: string;
  results: SuiteResult[];
}

export function baselineExists(): boolean {
  return fs.existsSync(path.join(BASELINE_DIR, "manifest.json"));
}

export function loadBaseline(): BaselineSnapshot | null {
  if (!baselineExists()) return null;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(BASELINE_DIR, "manifest.json"), "utf8"),
  );
  const files = fs
    .readdirSync(BASELINE_DIR)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json");
  const results = files.map(
    (f) =>
      JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, f), "utf8")) as SuiteResult,
  );
  return {
    model: manifest.model,
    capturedAt: manifest.capturedAt,
    results,
  };
}

export function saveBaseline(results: SuiteResult[]): void {
  fs.rmSync(BASELINE_DIR, { recursive: true, force: true });
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  for (const r of results) {
    fs.writeFileSync(
      path.join(BASELINE_DIR, `${r.suite}.json`),
      JSON.stringify(r, null, 2),
    );
  }
  fs.writeFileSync(
    path.join(BASELINE_DIR, "manifest.json"),
    JSON.stringify(
      {
        model: results[0]?.model ?? BENCHMARK_MODEL,
        capturedAt: new Date().toISOString(),
        suites: results.map((r) => r.suite),
      },
      null,
      2,
    ),
  );
}

export interface SuiteDelta {
  suite: string;
  target: {
    passRate: number;
    latencyMean: number;
    costPerRun: number | null;
    costPerSuccess: number | null;
  };
  baseline: {
    passRate: number;
    latencyMean: number;
    costPerRun: number | null;
    costPerSuccess: number | null;
  };
  passRateDeltaPp: number;
  latencyDeltaMs: number;
  costPerRunDelta: number | null;
  costPerSuccessDelta: number | null;
  missingInBaseline: boolean;
}

function snap(r: SuiteResult) {
  return {
    passRate: r.summary.passRate,
    latencyMean: r.summary.latency.mean,
    costPerRun: r.summary.cost.perRunUsd,
    costPerSuccess: r.summary.cost.perSuccessUsd,
  };
}

export function computeDeltas(
  target: SuiteResult[],
  baseline: SuiteResult[],
): SuiteDelta[] {
  const byName = new Map(baseline.map((r) => [r.suite, r]));
  return target.map((t) => {
    const b = byName.get(t.suite);
    const tSnap = snap(t);
    if (!b) {
      return {
        suite: t.suite,
        target: tSnap,
        baseline: { passRate: 0, latencyMean: 0, costPerRun: null, costPerSuccess: null },
        passRateDeltaPp: 0,
        latencyDeltaMs: 0,
        costPerRunDelta: null,
        costPerSuccessDelta: null,
        missingInBaseline: true,
      };
    }
    const bSnap = snap(b);
    return {
      suite: t.suite,
      target: tSnap,
      baseline: bSnap,
      passRateDeltaPp: (tSnap.passRate - bSnap.passRate) * 100,
      latencyDeltaMs: tSnap.latencyMean - bSnap.latencyMean,
      costPerRunDelta:
        tSnap.costPerRun != null && bSnap.costPerRun != null
          ? tSnap.costPerRun - bSnap.costPerRun
          : null,
      costPerSuccessDelta:
        tSnap.costPerSuccess != null && bSnap.costPerSuccess != null
          ? tSnap.costPerSuccess - bSnap.costPerSuccess
          : null,
      missingInBaseline: false,
    };
  });
}
