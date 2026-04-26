import { sbClient } from "./supabase.ts";

export interface DriftRow {
  model: string;
  suite: string;
  latestPassRate: number;
  latestStartedAt: string;
  medianPrior: number;
  samplesPrior: number;
  deltaPct: number;
  direction: "up" | "down" | "flat";
  flagged: boolean;
}

export interface DriftOptions {
  model?: string;
  days: number;
  thresholdPct: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function computeDrift(opts: DriftOptions): Promise<DriftRow[]> {
  const client = sbClient();
  if (!client) {
    throw new Error(
      "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.",
    );
  }
  const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000).toISOString();

  let q = client
    .from("venice_bench_results")
    .select("model,suite,started_at,pass_rate")
    .gte("started_at", since)
    .order("started_at", { ascending: false });
  if (opts.model) q = q.eq("model", opts.model);

  const { data, error } = await q;
  if (error) throw new Error(`Supabase query: ${error.message}`);
  const rows = (data ?? []) as {
    model: string;
    suite: string;
    started_at: string;
    pass_rate: number;
  }[];

  // Group by (model, suite); latest is the first element (DESC order).
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.model}::${r.suite}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const out: DriftRow[] = [];
  for (const [key, arr] of groups) {
    if (arr.length < 2) continue; // need prior samples to compare
    const latest = arr[0];
    const prior = arr.slice(1);
    const med = median(prior.map((r) => r.pass_rate));
    const deltaPct = (latest.pass_rate - med) * 100;
    const flagged = Math.abs(deltaPct) >= opts.thresholdPct;
    const [model, suite] = key.split("::");
    out.push({
      model,
      suite,
      latestPassRate: latest.pass_rate,
      latestStartedAt: latest.started_at,
      medianPrior: med,
      samplesPrior: prior.length,
      deltaPct,
      direction: deltaPct > 0.5 ? "up" : deltaPct < -0.5 ? "down" : "flat",
      flagged,
    });
  }
  return out.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
}

export function formatDrift(rows: DriftRow[], opts: DriftOptions): string {
  if (rows.length === 0) {
    return "(no comparable runs in the last " + opts.days + " days — need ≥2 runs per model/suite)";
  }
  const header = [
    "FLAG",
    "MODEL".padEnd(32),
    "SUITE".padEnd(14),
    "LATEST",
    "MEDIAN",
    "DELTA",
    "PRIOR_N",
  ].join("  ");
  const lines = rows.map((r) => {
    const flag = r.flagged ? (r.direction === "down" ? "🔻" : "🔺") : " ·";
    const delta =
      (r.deltaPct >= 0 ? "+" : "") + r.deltaPct.toFixed(1) + "pp";
    return [
      flag,
      r.model.padEnd(32),
      r.suite.padEnd(14),
      (r.latestPassRate * 100).toFixed(1).padStart(5) + "%",
      (r.medianPrior * 100).toFixed(1).padStart(5) + "%",
      delta.padStart(7),
      String(r.samplesPrior).padStart(5),
    ].join("  ");
  });
  return [header, "".padEnd(header.length, "─"), ...lines].join("\n");
}
