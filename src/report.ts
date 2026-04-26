import type { SuiteResult } from "./types.ts";
import type { SuiteDelta } from "./baseline.ts";
import { round } from "./stats.ts";
import { MODAL_CSS, MODAL_HTML, MODAL_SCRIPT } from "./render/modal.ts";

export interface BaselineDeltaContext {
  model: string;
  capturedAt: string;
  deltas: SuiteDelta[];
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMs(n: number): string {
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(4)}`;
}

// Suite descriptions for tooltips. Keep short.
const SUITE_DESCRIPTIONS: Record<string, string> = {
  "tool-choice": "Forced tool_choice stress test. Measures tool-call rate, JSON validity, and content leakage. Auto-falls-back to tool_choice:auto on reasoning models.",
  "json-schema": "Strict JSON schema conformance — parse rate + schema validity on a typed user-profile schema.",
  "thinking-tag": "Reasoning-model hygiene: balanced <think> tags, no residual after stripping, correct final JSON answer.",
  "extraction": "Faithful extraction from a short synthetic doc. Measures speaker/org recall, framework recall, fabrication rate, numeric range accuracy.",
  "long-context": "Needle-in-haystack at 16k tokens, rotating depth across trials (10%, 50%, 90%).",
  "latency": "Streaming TTFB + total latency on a short prompt. Passes if TTFB < 3s AND total < 15s.",
  "safety": "False-refusal rate on 8 benign prompts.",
  "prompt-cache": "Prompt-cache effectiveness: sends the same long prefix 10 times. Measures cached-token growth + cost reduction.",
  "schema-hardness": "Schema-hardness ramp: flat → nested → unions → deep-recursive. Reveals where a model breaks.",
  "multi-turn": "Multi-turn coherence: 4-turn conversation with back-references. Tests memory across turns.",
  "refusal-calibration": "Refusal calibration: 4 truly-harmful prompts — measures false-compliance rate (should refuse).",
  "tool-ambiguity": "Tool disambiguation: two plausibly-correct tools, one is right. Tests tool-selection reasoning.",
  "output-length": "Length controllability: \"exactly 3 bullets, 12 words each.\" Measures compliance.",
  "vision": "Vision: a test image + prompt to extract text/count. Needs supportsVision.",
};

// Metrics we know are ratios where higher = better. Everything else gets no threshold.
const METRIC_POLARITY: Record<string, "higher-better" | "lower-better"> = {
  tool_call_rate: "higher-better",
  json_valid_rate: "higher-better",
  content_leak_rate: "lower-better",
  auto_fallback_rate: "lower-better",
  parse_rate: "higher-better",
  schema_valid_rate: "higher-better",
  think_adoption_rate: "higher-better",
  balanced_rate: "higher-better",
  answer_accuracy: "higher-better",
  avg_framework_recall: "higher-better",
  avg_fabricated_per_run: "lower-better",
  range_accuracy: "higher-better",
  false_refusal_rate: "lower-better",
  false_compliance_rate: "lower-better",
  cache_hit_growth: "higher-better",
  cost_reduction_pct: "higher-better",
};

function metricClass(key: string, value: number): string {
  const pol = METRIC_POLARITY[key];
  if (!pol) return "";
  if (pol === "higher-better") {
    if (value >= 0.95) return "mok";
    if (value >= 0.8) return "mwarn";
    return "mbad";
  }
  // lower-better
  if (value <= 0.05) return "mok";
  if (value <= 0.2) return "mwarn";
  return "mbad";
}

function suiteCard(result: SuiteResult, runId: string): string {
  const s = result.summary;
  const desc = SUITE_DESCRIPTIONS[result.suite] ?? "";
  const metricRows = Object.entries(s.suiteMetrics)
    .map(([k, v]) => {
      const isRate = typeof v === "number" && v >= 0 && v <= 1 && /rate|accuracy|pct/i.test(k);
      const display = typeof v === "number" ? (isRate ? pct(v) : round(Number(v), 3)) : v;
      const cls = typeof v === "number" && isRate ? metricClass(k, v) : "";
      return `<tr><td>${escapeHtml(k)}</td><td class="num ${cls}">${escapeHtml(String(display))}</td></tr>`;
    })
    .join("");
  const failureRows = result.trials
    .filter((t) => !t.passed)
    .slice(0, 10)
    .map(
      (t) =>
        `<tr class="trial-row" data-run="${escapeHtml(runId)}" data-suite="${escapeHtml(result.suite)}" data-index="${t.index}" style="cursor:pointer;"><td class="fail-idx">${t.index}</td><td>${escapeHtml(t.reasons.join(", ") || "-")}</td></tr>`,
    )
    .join("");
  const allTrialRows = result.trials
    .map((t) => {
      const passCls = t.passed ? "color:var(--accent-2)" : "color:var(--bad)";
      const statusText = t.passed ? "✓" : "✗";
      return `<tr class="trial-row" data-run="${escapeHtml(runId)}" data-suite="${escapeHtml(result.suite)}" data-index="${t.index}" style="cursor:pointer;">
        <td style="font-weight:600;${passCls}">${statusText} ${t.index}</td>
        <td>${escapeHtml(t.reasons.join(", ") || "-")}</td>
      </tr>`;
    })
    .join("");

  const capSkippedBanner = result.skippedReason
    ? `<div style="background:rgba(100,120,255,0.08);border:1px solid rgba(100,120,255,0.25);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#8899ff;">
        ⊘ Suite not run — ${escapeHtml(result.skippedReason)}. Scored as 0% for capability comparison.
      </div>`
    : "";
  const apiErrorCount = result.trials.filter((t) => t.reasons.some((r) => r.startsWith("api_error:"))).length;
  const apiErrorBanner = !result.skippedReason && apiErrorCount > 0 && apiErrorCount === result.trials.length
    ? `<div style="background:rgba(255,107,107,0.1);border:1px solid rgba(255,107,107,0.3);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:var(--bad);">
        ⚠ All ${apiErrorCount} trials failed with API errors — model likely does not support this suite's capabilities (tools / schema / vision).
        <div style="color:var(--muted);margin-top:4px;font-family:ui-monospace,monospace;font-size:11px;">${escapeHtml(result.trials[0]?.call?.error?.slice(0, 120) ?? "")}</div>
      </div>`
    : !result.skippedReason && apiErrorCount > 0
    ? `<div style="background:rgba(255,200,0,0.08);border:1px solid rgba(255,200,0,0.25);border-radius:8px;padding:8px 14px;margin-bottom:12px;font-size:12px;color:#f5c842;">
        ⚠ ${apiErrorCount}/${result.trials.length} trials failed with API errors.
      </div>`
    : "";

  return `
<section class="card" id="suite-${escapeHtml(result.suite)}">
  <div class="card-head">
    <div>
      <div class="suite-name" title="${escapeHtml(desc)}">${escapeHtml(result.suite)} ${desc ? '<span class="info">ⓘ</span>' : ""}</div>
      <div class="suite-model">${escapeHtml(result.model)}</div>
    </div>
    <div class="passrate ${s.passRate === 1 ? "ok" : s.passRate >= 0.9 ? "warn" : "bad"}">
      ${pct(s.passRate)}<span>pass rate</span>
    </div>
  </div>
  ${capSkippedBanner}${apiErrorBanner}

  <div class="grid-4">
    <div class="stat"><div class="n">${s.runs}</div><div class="l">Runs</div></div>
    <div class="stat"><div class="n">${s.passed}</div><div class="l">Passed</div></div>
    <div class="stat"><div class="n">${s.failed}</div><div class="l">Failed</div></div>
    <div class="stat"><div class="n">${fmtMs(s.latency.mean)}</div><div class="l">Avg latency</div></div>
  </div>

  <div class="grid-2">
    <div class="block">
      <h4>Latency</h4>
      <table class="mini">
        <tr><td>median</td><td class="num">${fmtMs(s.latency.median)}</td></tr>
        <tr><td>min</td><td class="num">${fmtMs(s.latency.min)}</td></tr>
        <tr><td>max</td><td class="num">${fmtMs(s.latency.max)}</td></tr>
        <tr><td>p90</td><td class="num">${fmtMs(s.latency.p90)}</td></tr>
        <tr><td>p95</td><td class="num">${fmtMs(s.latency.p95)}</td></tr>
        <tr><td>p99</td><td class="num">${fmtMs(s.latency.p99)}</td></tr>
        <tr><td>std dev</td><td class="num">${fmtMs(s.latency.stdDev)}</td></tr>
      </table>
    </div>
    <div class="block">
      <h4>Tokens &amp; Cost</h4>
      <table class="mini">
        <tr><td>avg prompt tokens</td><td class="num">${Math.round(s.tokens.avgPrompt)}</td></tr>
        <tr><td>avg completion tokens</td><td class="num">${Math.round(s.tokens.avgCompletion)}</td></tr>
        <tr><td>total tokens</td><td class="num">${s.tokens.total.toLocaleString()}</td></tr>
        <tr><td>cost / run</td><td class="num">${fmtUsd(s.cost.perRunUsd)}</td></tr>
        <tr><td>cost / 1k runs</td><td class="num">${fmtUsd(s.cost.per1kRunsUsd)}</td></tr>
        <tr><td>cost / success</td><td class="num">${fmtUsd(s.cost.perSuccessUsd)}</td></tr>
      </table>
    </div>
  </div>

  ${metricRows ? `<div class="block"><h4>Suite metrics</h4><table class="mini">${metricRows}</table></div>` : ""}
  ${failureRows ? `<div class="block"><h4>Failures (first 10)</h4><table class="mini"><tr><th>#</th><th>reasons</th></tr>${failureRows}</table></div>` : ""}
  <div class="block">
    <button class="show-all-btn" onclick="this.closest('.block').querySelector('.all-trials').style.display=this.closest('.block').querySelector('.all-trials').style.display==='none'?'block':'none'; this.textContent=this.textContent.startsWith('▾')?'▸ show all trials':'▾ show all trials';" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;padding:0;text-transform:uppercase;letter-spacing:1px;">▸ show all trials</button>
    <div class="all-trials" style="display:none;margin-top:8px;">
      <table class="mini"><tr><th>#</th><th>reasons</th></tr>${allTrialRows}</table>
    </div>
  </div>
</section>`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function runTotalsPanel(results: SuiteResult[]): string {
  const pickPrompt = (r: SuiteResult) =>
    r.summary.tokens.totalPrompt ?? Math.round((r.summary.tokens.avgPrompt || 0) * r.summary.runs);
  const pickCompletion = (r: SuiteResult) =>
    r.summary.tokens.totalCompletion ?? Math.round((r.summary.tokens.avgCompletion || 0) * r.summary.runs);
  const pickCached = (r: SuiteResult) => r.summary.tokens.totalCached ?? 0;

  const totPrompt = results.reduce((a, r) => a + pickPrompt(r), 0);
  const totCached = results.reduce((a, r) => a + pickCached(r), 0);
  const totCompletion = results.reduce((a, r) => a + pickCompletion(r), 0);
  const totTokens = totPrompt + totCompletion;
  const totRuns = results.reduce((a, r) => a + r.summary.runs, 0);
  const totPassed = results.reduce((a, r) => a + r.summary.passed, 0);

  const haveBreakdown = results.length > 0 && results.every((r) => r.summary.cost.breakdown != null);
  const haveAnyCost = results.some((r) => r.summary.cost.totalUsd != null);
  const input = haveBreakdown
    ? results.reduce((a, r) => a + (r.summary.cost.breakdown?.inputUsd ?? 0), 0)
    : 0;
  const cachedUsd = haveBreakdown
    ? results.reduce((a, r) => a + (r.summary.cost.breakdown?.cachedUsd ?? 0), 0)
    : 0;
  const output = haveBreakdown
    ? results.reduce((a, r) => a + (r.summary.cost.breakdown?.outputUsd ?? 0), 0)
    : 0;
  const totCost = haveBreakdown
    ? input + cachedUsd + output
    : results.reduce((a, r) => a + (r.summary.cost.totalUsd ?? 0), 0);
  const cachedHitPct = totPrompt > 0 ? (totCached / totPrompt) * 100 : 0;

  // Per-suite cost rows (bar chart)
  const maxSuiteCost = Math.max(
    ...results.map((r) => r.summary.cost.totalUsd ?? 0),
    0.000001,
  );
  const bars = results
    .slice()
    .sort((a, b) => (b.summary.cost.totalUsd ?? 0) - (a.summary.cost.totalUsd ?? 0))
    .map((r) => {
      const c = r.summary.cost.totalUsd ?? 0;
      const w = (c / maxSuiteCost) * 100;
      const toks = r.summary.tokens.total;
      return `<div class="cost-bar-row">
        <div class="cb-suite">${escapeHtml(r.suite)}</div>
        <div class="cb-track"><div class="cb-fill" style="width:${w.toFixed(1)}%"></div></div>
        <div class="cb-cost">${fmtUsd(c)}</div>
        <div class="cb-tok">${fmtTokens(toks)} tok</div>
      </div>`;
    })
    .join("");

  return `
<section class="totals">
  <div class="totals-head">
    <h2>Run totals</h2>
    <div class="totals-sub">${totRuns} calls · ${totPassed} passed · ${results.length} suites</div>
  </div>

  <div class="totals-grid">
    <div class="tot">
      <div class="tot-label">Tokens</div>
      <div class="tot-row"><span>prompt (uncached)</span><span class="num">${fmtTokens(totPrompt - totCached)}</span></div>
      <div class="tot-row"><span>prompt (cached)</span><span class="num ${totCached > 0 ? "good" : ""}">${fmtTokens(totCached)} <em>${cachedHitPct.toFixed(1)}%</em></span></div>
      <div class="tot-row"><span>completion</span><span class="num">${fmtTokens(totCompletion)}</span></div>
      <div class="tot-row tot-grand"><span>total</span><span class="num">${fmtTokens(totTokens)}</span></div>
    </div>

    <div class="tot">
      <div class="tot-label">Cost breakdown</div>
      ${haveBreakdown ? `
      <div class="tot-row"><span>input</span><span class="num">${fmtUsd(input)}</span></div>
      <div class="tot-row"><span>cached reads</span><span class="num good">${fmtUsd(cachedUsd)}</span></div>
      <div class="tot-row"><span>output</span><span class="num">${fmtUsd(output)}</span></div>
      <div class="tot-row tot-grand"><span>total run cost</span><span class="num big">${fmtUsd(totCost)}</span></div>
      ` : haveAnyCost ? `
      <div class="tot-row"><span>breakdown unavailable</span><span class="num">—</span></div>
      <div class="tot-row tot-hint" style="font-size:10px;padding:4px 0;">re-run on updated code to see input/cached/output split</div>
      <div class="tot-row tot-grand"><span>total run cost</span><span class="num big">${fmtUsd(totCost)}</span></div>
      ` : `<div class="tot-row tot-missing">no pricing configured for this model<br>
        <span class="tot-hint">add to data/pricing.json to enable cost</span></div>`}
    </div>

    <div class="tot">
      <div class="tot-label">Per-suite cost</div>
      <div class="cost-bars">${bars}</div>
    </div>
  </div>
</section>`;
}

function fmtDeltaPp(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "pp";
}
function fmtDeltaMs(n: number): string {
  const prefix = n >= 0 ? "+" : "−";
  const abs = Math.abs(n);
  return prefix + (abs >= 1000 ? (abs / 1000).toFixed(2) + "s" : Math.round(abs) + "ms");
}
function fmtDeltaUsd(n: number | null): string {
  if (n == null) return "—";
  const prefix = n >= 0 ? "+" : "−";
  return prefix + "$" + Math.abs(n).toFixed(5);
}

function deltaClass(delta: number, lowerIsBetter: boolean, threshold = 0): string {
  if (Math.abs(delta) <= threshold) return "flat";
  const targetBetter = lowerIsBetter ? delta < 0 : delta > 0;
  return targetBetter ? "better" : "worse";
}

function baselineSection(ctx: BaselineDeltaContext): string {
  const cards = ctx.deltas
    .map((d) => {
      if (d.missingInBaseline) {
        return `<div class="delta-card">
          <div class="suite">${escapeHtml(d.suite)}</div>
          <div class="delta na" colspan="3">no baseline</div>
        </div>`;
      }
      return `<div class="delta-card">
        <div class="suite">${escapeHtml(d.suite)}</div>
        <div class="delta-row"><span class="k">pass</span><span class="v ${deltaClass(d.passRateDeltaPp, false, 0.5)}">${fmtDeltaPp(d.passRateDeltaPp)}</span></div>
        <div class="delta-row"><span class="k">latency</span><span class="v ${deltaClass(d.latencyDeltaMs, true, 50)}">${fmtDeltaMs(d.latencyDeltaMs)}</span></div>
        <div class="delta-row"><span class="k">cost/run</span><span class="v ${d.costPerRunDelta == null ? "na" : deltaClass(d.costPerRunDelta, true, 0)}">${fmtDeltaUsd(d.costPerRunDelta)}</span></div>
        <div class="delta-row"><span class="k">cost/success</span><span class="v ${d.costPerSuccessDelta == null ? "na" : deltaClass(d.costPerSuccessDelta, true, 0)}">${fmtDeltaUsd(d.costPerSuccessDelta)}</span></div>
      </div>`;
    })
    .join("");

  return `
<section class="baseline-strip">
  <div class="bs-head">
    <div>
      <div class="bs-title">vs baseline</div>
      <div class="bs-model">${escapeHtml(ctx.model)}</div>
    </div>
    <div class="bs-captured">captured ${escapeHtml(ctx.capturedAt)}</div>
  </div>
  <div class="delta-grid">${cards}</div>
  <div class="bs-legend">green = target is better · red = target is worse · pp = percentage points</div>
</section>`;
}

export function renderReport(
  runId: string,
  results: SuiteResult[],
  baselineCtx?: BaselineDeltaContext,
): string {
  const model = results[0]?.model ?? "unknown";
  const runs = results[0]?.summary.runs ?? 0;
  // Use the latest finishedAt across all suites as the run completion timestamp.
  const finishedAt = results.reduce<string | undefined>((latest, r) => {
    if (!latest) return r.finishedAt;
    return r.finishedAt > latest ? r.finishedAt : latest;
  }, undefined) ?? new Date().toISOString();
  const totalPassRate =
    results.reduce((a, r) => a + r.summary.passRate, 0) /
    Math.max(results.length, 1);
  const cards = results.map((r) => suiteCard(r, runId)).join("\n");

  // vs-baseline one-liner — an aggregate of the per-suite deltas, prominently.
  let vsBaselineLine = "";
  if (baselineCtx) {
    const deltas = baselineCtx.deltas;
    const passAvg = deltas.reduce((a, d) => a + d.passRateDeltaPp, 0) / Math.max(deltas.length, 1);
    const latAvg = deltas.reduce((a, d) => a + d.latencyDeltaMs, 0) / Math.max(deltas.length, 1);
    const costDeltas = deltas.map((d) => d.costPerRunDelta).filter((c): c is number => c != null);
    const costAvg = costDeltas.length ? costDeltas.reduce((a, b) => a + b, 0) / costDeltas.length : null;
    const passCls = Math.abs(passAvg) < 0.5 ? "flat" : passAvg > 0 ? "up" : "down";
    const latCls = Math.abs(latAvg) < 50 ? "flat" : latAvg < 0 ? "up" : "down";
    const costCls = costAvg == null ? "flat" : Math.abs(costAvg) < 0.00005 ? "flat" : costAvg < 0 ? "up" : "down";
    const latStr = (latAvg >= 0 ? "+" : "−") + (Math.abs(latAvg) >= 1000 ? (Math.abs(latAvg)/1000).toFixed(2) + "s" : Math.round(Math.abs(latAvg)) + "ms");
    const costStr = costAvg == null ? "—" : (costAvg >= 0 ? "+" : "−") + "$" + Math.abs(costAvg).toFixed(5);
    vsBaselineLine = `
    <div class="vs-baseline">
      <span class="label">vs baseline</span>
      <span class="model">${escapeHtml(baselineCtx.model)}</span>
      <span>·</span>
      <span class="stat ${passCls}">${(passAvg >= 0 ? "+" : "") + passAvg.toFixed(1)}pp pass</span>
      <span class="stat ${latCls}">${latStr} latency</span>
      <span class="stat ${costCls}">${costStr} /run</span>
    </div>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>venice-bench · ${escapeHtml(model)} · ${escapeHtml(runId)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bg: #0a1030;
    --bg2: #0d1440;
    --fg: #e6edff;
    --muted: #8aa0c8;
    --line: #1f2a5a;
    --accent: #00e5c7;
    --accent-2: #5dff9a;
    --warn: #ffcf4a;
    --bad: #ff6b6b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", sans-serif;
    background: radial-gradient(1200px 600px at 20% -10%, #15206a 0%, var(--bg) 60%) var(--bg);
    color: var(--fg);
    padding: 32px;
  }
  header {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 20px 24px;
    background: linear-gradient(180deg, rgba(0,229,199,0.08), rgba(0,0,0,0));
    margin-bottom: 24px;
  }
  h1 {
    margin: 0 0 4px;
    font-size: 28px;
    letter-spacing: 0.5px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .sub { color: var(--muted); font-size: 13px; }
  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin-top: 16px;
  }
  .kpi {
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .kpi .n { font-size: 22px; color: var(--accent); font-weight: 600; }
  .kpi .l { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 16px;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px;
    background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0));
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 14px;
  }
  .suite-name { font-size: 18px; font-weight: 600; letter-spacing: 0.3px; }
  .suite-model { color: var(--muted); font-size: 12px; margin-top: 2px; font-family: ui-monospace, SFMono-Regular, monospace; }
  .passrate {
    font-size: 26px;
    font-weight: 700;
    text-align: right;
    line-height: 1;
  }
  .passrate span { display: block; font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .passrate.ok { color: var(--accent-2); }
  .passrate.warn { color: var(--warn); }
  .passrate.bad { color: var(--bad); }

  .grid-4 {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 10px;
  }
  .stat { background: rgba(0,0,0,0.25); border: 1px solid var(--line); border-radius: 8px; padding: 10px; text-align: center; }
  .stat .n { font-size: 18px; color: var(--accent); font-weight: 600; }
  .stat .l { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.8px; }

  .block { margin-top: 10px; }
  .block h4 {
    margin: 6px 0;
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 1.2px;
  }
  table.mini { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.mini td, table.mini th { padding: 4px 6px; border-bottom: 1px dashed var(--line); text-align: left; }
  table.mini th { color: var(--muted); font-weight: 500; }
  table.mini td.num { text-align: right; font-family: ui-monospace, SFMono-Regular, monospace; color: var(--accent-2); }

  .totals {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 20px;
    margin-bottom: 20px;
    background: linear-gradient(180deg, rgba(0,229,199,0.05), rgba(0,0,0,0));
  }
  .totals-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
  .totals-head h2 { margin: 0; font-size: 15px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.4px; font-weight: 500; }
  .totals-sub { font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace; }
  .totals-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
  .tot { background: rgba(0,0,0,0.25); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
  .tot-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 8px; }
  .tot-row { display: flex; justify-content: space-between; align-items: baseline; padding: 3px 0; font-size: 12px; }
  .tot-row > span:first-child { color: var(--muted); }
  .tot-row .num { font-family: ui-monospace, monospace; color: var(--fg); }
  .tot-row .num.good { color: var(--accent-2); }
  .tot-row .num em { font-style: normal; font-size: 10px; color: var(--muted); margin-left: 4px; }
  .tot-row .num.big { font-size: 16px; color: var(--accent); font-weight: 600; }
  .tot-grand { border-top: 1px dashed var(--line); margin-top: 6px; padding-top: 8px; font-weight: 600; }
  .tot-grand > span:first-child { color: var(--fg); text-transform: uppercase; letter-spacing: 1px; font-size: 10px; }
  .tot-missing { color: var(--muted); padding: 8px 0; }
  .tot-hint { font-size: 10px; color: #3a4a80; }

  .cost-bars { display: flex; flex-direction: column; gap: 4px; }
  .cost-bar-row {
    display: grid;
    grid-template-columns: 90px 1fr 60px 55px;
    gap: 6px;
    align-items: center;
    font-size: 11px;
  }
  .cb-suite { color: var(--fg); font-weight: 500; }
  .cb-track { height: 10px; background: rgba(0,0,0,0.4); border-radius: 3px; overflow: hidden; }
  .cb-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
  .cb-cost { text-align: right; font-family: ui-monospace, monospace; color: var(--accent-2); }
  .cb-tok { text-align: right; font-family: ui-monospace, monospace; color: var(--muted); font-size: 10px; }

  .baseline-strip {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 20px;
    margin-bottom: 20px;
    background: linear-gradient(180deg, rgba(93, 255, 154, 0.04), rgba(0,0,0,0));
  }
  .bs-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 14px; }
  .bs-title { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.4px; }
  .bs-model { font-size: 18px; color: var(--accent-2); font-family: ui-monospace, monospace; margin-top: 2px; }
  .bs-captured { font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace; }
  .delta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 10px;
  }
  .delta-card {
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .delta-card .suite {
    font-weight: 600;
    font-size: 13px;
    color: var(--fg);
    margin-bottom: 6px;
    padding-bottom: 6px;
    border-bottom: 1px dashed var(--line);
  }
  .delta-row {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    padding: 2px 0;
  }
  .delta-row .k { color: var(--muted); text-transform: uppercase; letter-spacing: 0.8px; }
  .delta-row .v { font-family: ui-monospace, monospace; font-weight: 600; }
  .delta-row .v.better { color: var(--accent-2); }
  .delta-row .v.worse  { color: var(--bad); }
  .delta-row .v.flat   { color: var(--muted); }
  .delta-row .v.na     { color: #3a4a80; }
  .delta-card .delta.na { color: #3a4a80; font-size: 11px; }
  .bs-legend { margin-top: 10px; font-size: 10px; color: var(--muted); letter-spacing: 0.5px; }

  /* Anomaly-colored suite metrics */
  table.mini td.num.mok   { color: var(--accent-2); }
  table.mini td.num.mwarn { color: var(--warn); }
  table.mini td.num.mbad  { color: var(--bad); }

  /* Trial drill-down affordance */
  tr.trial-row { cursor: pointer; }
  tr.trial-row:hover { background: rgba(255,107,107,0.08); }
  tr.trial-row .fail-idx { color: var(--accent); font-weight: 600; }

  .suite-name .info { color: var(--muted); font-size: 10px; margin-left: 4px; cursor: help; }

  /* vs-baseline one-liner */
  .vs-baseline {
    display: flex; gap: 12px; align-items: center;
    padding: 10px 14px; margin-bottom: 16px;
    border: 1px solid var(--line); border-radius: 10px;
    background: rgba(0,229,199,0.04);
    font-size: 13px;
  }
  .vs-baseline .label { color: var(--muted); text-transform: uppercase; letter-spacing: 1px; font-size: 10px; }
  .vs-baseline .model { color: var(--accent-2); font-family: ui-monospace, monospace; }
  .vs-baseline .stat { font-family: ui-monospace, monospace; }
  .vs-baseline .up { color: var(--accent-2); }
  .vs-baseline .down { color: var(--bad); }
  .vs-baseline .flat { color: var(--muted); }

  /* Topnav */
  .topnav { display: flex; gap: 16px; margin-bottom: 16px; padding: 8px 14px;
            border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,0.02); font-size: 13px; align-items:center; }
  .topnav a { color: var(--muted); text-decoration: none; }
  .topnav a:hover { color: var(--fg); }
  .topnav .brand { color: var(--accent); font-weight: 700; }
  .topnav .copy-runid { margin-left: auto; background: none; border: 1px solid var(--line); color: var(--muted);
                        font: inherit; font-size: 11px; padding: 2px 10px; border-radius: 4px; cursor: pointer; }
  .topnav .copy-runid:hover { color: var(--accent); border-color: var(--accent); }

  footer { color: var(--muted); font-size: 12px; margin-top: 32px; text-align: center; }
  ${MODAL_CSS}
</style>
</head>
<body>
  <nav class="topnav">
    <span class="brand">venice-bench</span>
    <a href="/">dashboard</a>
    <a href="/matrix">matrix</a>
    <a href="/radar?models=${encodeURIComponent(model)}">radar</a>
    <a href="/pareto">pareto</a>
    <a href="/baseline">baseline</a>
    <button class="copy-runid" data-rid="${escapeHtml(runId)}">⧉ copy run id</button>
  </nav>
  ${vsBaselineLine}
  <header>
    <h1>VENICE-BENCH · ${escapeHtml(model)}</h1>
    <div class="sub">Run ID: <code>${escapeHtml(runId)}</code> · finished ${escapeHtml(finishedAt)}</div>
    <div class="kpis">
      <div class="kpi"><div class="n">${results.length}</div><div class="l">Suites</div></div>
      <div class="kpi"><div class="n">${runs}</div><div class="l">Runs / Suite</div></div>
      <div class="kpi"><div class="n">${pct(totalPassRate)}</div><div class="l">Overall Pass</div></div>
      <div class="kpi"><div class="n">${results.reduce((a, r) => a + r.summary.tokens.total, 0).toLocaleString()}</div><div class="l">Total Tokens</div></div>
    </div>
  </header>

  ${runTotalsPanel(results)}
  ${baselineCtx ? baselineSection(baselineCtx) : ""}

  <div class="cards">
    ${cards}
  </div>

  <footer>venice-bench · dark-theme report · click any trial row to see the full response (requires dashboard server — open via <code>venice-bench serve</code>)</footer>

  ${MODAL_HTML}
  ${MODAL_SCRIPT}
  <script>
  (() => {
    // Copy run id
    const copyBtn = document.querySelector('.copy-runid');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(copyBtn.dataset.rid);
        const prev = copyBtn.textContent;
        copyBtn.textContent = '✓ copied';
        setTimeout(() => copyBtn.textContent = prev, 1500);
      });
    }
  })();
  </script>
</body>
</html>`;
}

export function renderCompare(
  runIds: string[],
  resultsByRun: Record<string, SuiteResult[]>,
): string {
  const suites = new Set<string>();
  for (const arr of Object.values(resultsByRun)) {
    for (const r of arr) suites.add(r.suite);
  }
  const suiteList = Array.from(suites);

  const header = runIds
    .map((id) => {
      const model = resultsByRun[id][0]?.model ?? id;
      return `<th><div class="run-id">${escapeHtml(model)}</div><div class="sub">${escapeHtml(id)}</div></th>`;
    })
    .join("");

  const rows = suiteList
    .map((suite) => {
      const cells = runIds
        .map((id) => {
          const r = resultsByRun[id].find((x) => x.suite === suite);
          if (!r) return `<td class="na">—</td>`;
          const s = r.summary;
          const cls = s.passRate === 1 ? "ok" : s.passRate >= 0.9 ? "warn" : "bad";
          return `<td>
            <div class="cell-pass ${cls}">${pct(s.passRate)}</div>
            <div class="cell-sub">${fmtMs(s.latency.mean)} avg · ${fmtUsd(s.cost.perRunUsd)}/run</div>
          </td>`;
        })
        .join("");
      return `<tr><th class="row-h">${escapeHtml(suite)}</th>${cells}</tr>`;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>venice-bench compare</title>
<style>
  body{margin:0;padding:32px;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;background:#0a1030;color:#e6edff;}
  h1{margin:0 0 16px;color:#00e5c7;}
  table{border-collapse:collapse;width:100%;}
  th,td{padding:10px 14px;border-bottom:1px solid #1f2a5a;text-align:left;vertical-align:top;}
  th{color:#8aa0c8;font-weight:500;}
  .run-id{font-size:14px;color:#e6edff;}
  .sub{font-size:11px;color:#8aa0c8;font-family:ui-monospace,monospace;}
  .row-h{color:#5dff9a;font-weight:600;}
  .cell-pass{font-size:16px;font-weight:700;}
  .cell-pass.ok{color:#5dff9a;} .cell-pass.warn{color:#ffcf4a;} .cell-pass.bad{color:#ff6b6b;}
  .cell-sub{font-size:11px;color:#8aa0c8;margin-top:2px;}
  .na{color:#3a4a80;}
</style></head>
<body>
  <h1>Venice-Bench · Comparison</h1>
  <table>
    <thead><tr><th>Suite</th>${header}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
