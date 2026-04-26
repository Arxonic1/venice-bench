import { escape, fmtDateTime, fmtPct, htmlDoc, listRuns } from "./shared.ts";

const TREND_COLORS = [
  "#00e5c7", "#5dff9a", "#ffcf4a", "#ff6b6b", "#82b4ff",
  "#d4a0ff", "#ff9e6b", "#6bffd8", "#ffd06b", "#b4ff82",
];

const TRENDS_CSS = `
  .trends-wrap { margin-bottom: 24px; }
  .chart-title { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.4px;
                 font-weight: 500; margin-bottom: 12px; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 14px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; font-family: ui-monospace, monospace; }
  .legend-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
  .single-run-list { margin-top: 14px; font-size: 12px; color: var(--muted); }
  .single-run-list li { margin: 4px 0; font-family: ui-monospace, monospace; }
  .empty-state { text-align: center; padding: 60px 20px; color: var(--muted); font-size: 14px; }
  .empty-state code { display: block; margin-top: 12px; color: var(--fg); }
  .panel { border: 1px solid var(--line); border-radius: 14px; padding: 20px 24px; margin-bottom: 20px;
           background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0)); }
`;

export function renderTrends(): string {
  const runs = listRuns().filter((r) => !r.isBaselineRun);

  // Group runs by model, sorted oldest to newest per model
  const byModel = new Map<string, typeof runs>();
  for (const r of runs) {
    const arr = byModel.get(r.model) ?? [];
    arr.push(r);
    byModel.set(r.model, arr);
  }
  for (const [, arr] of byModel) {
    arr.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  }

  const multiRun: [string, typeof runs][] = [];
  const singleRun: string[] = [];
  for (const [model, arr] of byModel) {
    if (arr.length >= 2) multiRun.push([model, arr]);
    else singleRun.push(model);
  }

  if (multiRun.length === 0 && singleRun.length === 0) {
    const body = `<div class="panel"><div class="empty-state">No benchmark runs yet.<br><code>./bin/venice-bench.mjs run-all -m &lt;model&gt;</code></div></div>`;
    return htmlDoc("venice-bench · trends", "trends", body, TRENDS_CSS);
  }

  if (multiRun.length === 0) {
    const items = singleRun.map((m) => `<li>${escape(m)}</li>`).join("");
    const body = `<div class="panel">
      <div class="empty-state">No models with 2+ runs yet — run a model a second time to see trends.</div>
      <div class="single-run-list"><strong style="color:var(--fg);">Single-run models:</strong><ul>${items}</ul></div>
    </div>`;
    return htmlDoc("venice-bench · trends", "trends", body, TRENDS_CSS);
  }

  // Collect all unique run timestamps for the x-axis (union of all model runs).
  // For the SVG we'll use per-model data points connected by lines.
  const SVG_W = 900;
  const SVG_H = 320;
  const PAD_L = 52;
  const PAD_R = 20;
  const PAD_T = 20;
  const PAD_B = 60;
  const PLOT_W = SVG_W - PAD_L - PAD_R;
  const PLOT_H = SVG_H - PAD_T - PAD_B;

  // Collect all data points for x-axis range
  const allPoints: { ts: number; passRate: number; model: string; runId: string; capturedAt: string }[] = [];
  for (const [model, arr] of multiRun) {
    for (const r of arr) {
      allPoints.push({ ts: new Date(r.capturedAt).getTime(), passRate: r.passRate, model, runId: r.id, capturedAt: r.capturedAt });
    }
  }
  const minTs = Math.min(...allPoints.map((p) => p.ts));
  const maxTs = Math.max(...allPoints.map((p) => p.ts));
  const tsRange = maxTs - minTs || 1;

  function toX(ts: number): number {
    return PAD_L + ((ts - minTs) / tsRange) * PLOT_W;
  }
  function toY(rate: number): number {
    return PAD_T + (1 - rate) * PLOT_H;
  }

  // Grid lines for y-axis (0%, 25%, 50%, 75%, 100%)
  const yGridLines = [0, 0.25, 0.5, 0.75, 1.0]
    .map((v) => {
      const y = toY(v);
      return `<line x1="${PAD_L}" y1="${y}" x2="${SVG_W - PAD_R}" y2="${y}" stroke="rgba(31,42,90,0.8)" stroke-width="1" stroke-dasharray="${v === 0 || v === 1 ? "0" : "4,4"}"/>
        <text x="${PAD_L - 6}" y="${y + 4}" text-anchor="end" fill="#8aa0c8" font-size="10" font-family="ui-monospace,monospace">${Math.round(v * 100)}%</text>`;
    })
    .join("");

  // X-axis tick marks: show at run capture times, deduplicated by ~proximity
  const xTicks = allPoints
    .map((p) => p.ts)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b);
  const xTickMarks = xTicks
    .map((ts) => {
      const x = toX(ts);
      const label = new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      return `<line x1="${x}" y1="${PAD_T}" x2="${x}" y2="${PAD_T + PLOT_H + 5}" stroke="#1f2a5a" stroke-width="1"/>
        <text x="${x}" y="${PAD_T + PLOT_H + 20}" text-anchor="middle" fill="#8aa0c8" font-size="9" font-family="ui-monospace,monospace" transform="rotate(-30 ${x} ${PAD_T + PLOT_H + 20})">${escape(label)}</text>`;
    })
    .join("");

  // Lines and dots per model
  let colorIdx = 0;
  const modelPaths: string[] = [];
  const legendItems: string[] = [];

  for (const [model, arr] of multiRun) {
    const color = TREND_COLORS[colorIdx % TREND_COLORS.length];
    colorIdx++;

    const pts = arr.map((r) => ({ x: toX(new Date(r.capturedAt).getTime()), y: toY(r.passRate), passRate: r.passRate, capturedAt: r.capturedAt, runId: r.id }));
    const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

    const dots = pts
      .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${color}" stroke="var(--bg)" stroke-width="2">
        <title>${escape(model)} · ${escape(fmtDateTime(p.capturedAt))} · ${fmtPct(p.passRate)}</title>
      </circle>`)
      .join("");

    modelPaths.push(
      `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>` + dots,
    );
    legendItems.push(
      `<div class="legend-item"><div class="legend-dot" style="background:${color}"></div>${escape(model)}</div>`,
    );
  }

  const svg = `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;max-width:${SVG_W}px;">
    <!-- background -->
    <rect x="${PAD_L}" y="${PAD_T}" width="${PLOT_W}" height="${PLOT_H}" fill="rgba(0,0,0,0.2)" rx="4"/>
    <!-- grid -->
    ${yGridLines}
    ${xTickMarks}
    <!-- data -->
    ${modelPaths.join("\n")}
    <!-- axes labels -->
    <text x="${PAD_L}" y="${PAD_T - 6}" fill="#8aa0c8" font-size="10" font-family="ui-monospace,monospace">Pass rate</text>
    <text x="${SVG_W - PAD_R}" y="${PAD_T - 6}" fill="#8aa0c8" font-size="10" font-family="ui-monospace,monospace" text-anchor="end">Newest →</text>
  </svg>`;

  const singleRunSection = singleRun.length > 0
    ? `<div class="panel">
        <div class="chart-title">Single-run models (need 2+ runs to appear in chart)</div>
        <ul class="single-run-list">${singleRun.map((m) => `<li>${escape(m)}</li>`).join("")}</ul>
      </div>`
    : "";

  const body = `
    <header style="border:1px solid var(--line);border-radius:14px;padding:20px 24px;margin-bottom:20px;background:linear-gradient(180deg,rgba(0,229,199,0.08),rgba(0,0,0,0));">
      <h1 style="margin:0 0 4px;font-size:26px;background:linear-gradient(90deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent;">Pass Rate Trends</h1>
      <div style="color:var(--muted);font-size:13px;">${multiRun.length} model${multiRun.length === 1 ? "" : "s"} with 2+ runs</div>
    </header>

    <div class="panel trends-wrap">
      <div class="chart-title">Pass rate over time · per model</div>
      ${svg}
      <div class="legend">${legendItems.join("")}</div>
    </div>

    ${singleRunSection}
  `;

  return htmlDoc("venice-bench · trends", "trends", body, TRENDS_CSS);
}
