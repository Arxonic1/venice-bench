import pLimit from "p-limit";
import { chatCall } from "./venice.ts";
import { latencyStats } from "./stats.ts";
import type { LatencyStats } from "./types.ts";

export interface LoadTier {
  concurrency: number;
  requests: number;
  wallMs: number;
  successCount: number;
  errorCount: number;
  throughputPerSec: number;
  latency: LatencyStats;
  errorSamples: string[];
}

export interface LoadResult {
  model: string;
  startedAt: string;
  finishedAt: string;
  tiers: LoadTier[];
}

export interface LoadOptions {
  model: string;
  tiers: number[];
  requestsPerTier: number;
  timeoutMs: number;
}

export async function runLoad(opts: LoadOptions): Promise<LoadResult> {
  const startedAt = new Date().toISOString();
  const tiers: LoadTier[] = [];

  for (const concurrency of opts.tiers) {
    const limit = pLimit(concurrency);
    const wallStart = performance.now();
    const results = await Promise.all(
      Array.from({ length: opts.requestsPerTier }, () =>
        limit(() =>
          chatCall({
            model: opts.model,
            messages: [
              { role: "system", content: "Reply in one short sentence." },
              { role: "user", content: "Say hello." },
            ],
            timeoutMs: opts.timeoutMs,
            temperature: 0.2,
            maxTokens: 64,
          }),
        ),
      ),
    );
    const wallMs = performance.now() - wallStart;
    const success = results.filter((r) => r.ok);
    const errors = results.filter((r) => !r.ok);
    tiers.push({
      concurrency,
      requests: opts.requestsPerTier,
      wallMs,
      successCount: success.length,
      errorCount: errors.length,
      throughputPerSec: (success.length / wallMs) * 1000,
      latency: latencyStats(success.map((r) => r.latencyMs)),
      errorSamples: errors.slice(0, 3).map((r) => r.error || "unknown"),
    });
  }

  return {
    model: opts.model,
    startedAt,
    finishedAt: new Date().toISOString(),
    tiers,
  };
}

function fmtMs(n: number): string {
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

export function renderLoadReport(runId: string, result: LoadResult): string {
  const rows = result.tiers
    .map((t) => {
      const successRate = t.successCount / (t.requests || 1);
      const cls = successRate === 1 ? "ok" : successRate >= 0.9 ? "warn" : "bad";
      return `<tr>
        <td class="c-big">${t.concurrency}</td>
        <td class="num">${t.requests}</td>
        <td class="num ${cls}">${t.successCount}/${t.requests}</td>
        <td class="num">${t.throughputPerSec.toFixed(2)} req/s</td>
        <td class="num">${fmtMs(t.latency.mean)}</td>
        <td class="num">${fmtMs(t.latency.p95)}</td>
        <td class="num">${fmtMs(t.latency.p99)}</td>
        <td class="num">${fmtMs(t.wallMs)}</td>
        <td class="err">${t.errorSamples.map(escapeHtml).join("<br>")}</td>
      </tr>`;
    })
    .join("");

  const maxTp = Math.max(...result.tiers.map((t) => t.throughputPerSec), 0.001);
  const bars = result.tiers
    .map((t) => {
      const w = (t.throughputPerSec / maxTp) * 100;
      return `<div class="bar-row">
        <div class="bar-label">c=${t.concurrency}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${w.toFixed(1)}%"></div></div>
        <div class="bar-val">${t.throughputPerSec.toFixed(2)} req/s</div>
      </div>`;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>venice-bench load · ${escapeHtml(result.model)}</title>
<style>
  body{margin:0;padding:32px;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;background:#0a1030;color:#e6edff;}
  h1{margin:0 0 4px;background:linear-gradient(90deg,#00e5c7,#5dff9a);-webkit-background-clip:text;background-clip:text;color:transparent;}
  .sub{color:#8aa0c8;margin-bottom:24px;font-family:ui-monospace,monospace;font-size:12px;}
  table{border-collapse:collapse;width:100%;margin-top:16px;border:1px solid #1f2a5a;border-radius:10px;overflow:hidden;}
  th,td{padding:10px 14px;border-bottom:1px solid #1f2a5a;text-align:left;}
  th{background:rgba(0,229,199,0.06);color:#8aa0c8;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:1px;}
  .c-big{font-size:18px;color:#00e5c7;font-weight:700;}
  .num{font-family:ui-monospace,monospace;text-align:right;color:#5dff9a;}
  .num.warn{color:#ffcf4a;} .num.bad{color:#ff6b6b;} .num.ok{color:#5dff9a;}
  .err{color:#ff6b6b;font-size:11px;font-family:ui-monospace,monospace;}
  .panel{margin-top:24px;padding:20px;border:1px solid #1f2a5a;border-radius:12px;background:rgba(255,255,255,0.02);}
  .panel h2{margin:0 0 12px;font-size:13px;color:#8aa0c8;text-transform:uppercase;letter-spacing:1.2px;}
  .bar-row{display:grid;grid-template-columns:60px 1fr 120px;gap:12px;align-items:center;padding:6px 0;}
  .bar-label{color:#00e5c7;font-weight:600;}
  .bar-track{height:18px;background:rgba(0,0,0,0.3);border-radius:4px;overflow:hidden;}
  .bar-fill{height:100%;background:linear-gradient(90deg,#00e5c7,#5dff9a);}
  .bar-val{text-align:right;font-family:ui-monospace,monospace;color:#5dff9a;}
</style></head>
<body>
  <h1>VENICE-BENCH LOAD · ${escapeHtml(result.model)}</h1>
  <div class="sub">Run ID: ${escapeHtml(runId)} · ${escapeHtml(result.startedAt)} → ${escapeHtml(result.finishedAt)}</div>

  <div class="panel">
    <h2>Throughput by concurrency</h2>
    ${bars}
  </div>

  <table>
    <thead><tr>
      <th>Concurrency</th><th>Requests</th><th>Success</th><th>Throughput</th>
      <th>Mean latency</th><th>P95</th><th>P99</th><th>Wall</th><th>Errors</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
