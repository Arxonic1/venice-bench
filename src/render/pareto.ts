import {
  escape,
  fmtPct,
  fmtUsd,
  htmlDoc,
  listRuns,
} from "./shared.ts";

const PARETO_CSS = `
  header.hero { border: 1px solid var(--line); border-radius: 14px; padding: 20px 24px; margin-bottom: 18px;
                background: linear-gradient(180deg, rgba(0,229,199,0.08), rgba(0,0,0,0)); }
  h1 { margin: 0 0 4px; font-size: 24px;
       background: linear-gradient(90deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { color: var(--muted); font-size: 13px; }
  .panel { border: 1px solid var(--line); border-radius: 14px; padding: 16px 20px; margin-bottom: 18px;
           background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0)); }
  .scatter-wrap { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items: start; }
  @media (max-width: 900px) { .scatter-wrap { grid-template-columns: 1fr; } }
  .scatter { width: 100%; max-width: 640px; aspect-ratio: 1.3; }
  table.frontier { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.frontier th, table.frontier td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: left; }
  table.frontier th { color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: 1px; font-size: 10px; }
  table.frontier td.num { text-align: right; font-family: ui-monospace, monospace; }
  table.frontier tr.efficient td { color: var(--accent-2); }
  table.frontier tr.dominated td { color: var(--muted); }
`;

interface Point {
  model: string;
  cost: number;   // $ per 100 calls, for readable units
  passRate: number;
  runs: number;
  tokens: number;
}

function computeFrontier(points: Point[]): Set<string> {
  // A point is on the frontier if no other point has (cost ≤ AND passRate ≥), at least one strict.
  const frontier = new Set<string>();
  for (const p of points) {
    const dominated = points.some(
      (q) =>
        q !== p &&
        q.cost <= p.cost &&
        q.passRate >= p.passRate &&
        (q.cost < p.cost || q.passRate > p.passRate),
    );
    if (!dominated) frontier.add(p.model);
  }
  return frontier;
}

export function renderPareto(): string {
  const runs = listRuns().filter((r) => !r.isBaselineRun && r.totalCost != null && r.totalCalls > 0);

  // Aggregate by model (mean across runs)
  const byModel = new Map<string, { cost: number; pass: number; runs: number; calls: number; tokens: number }>();
  for (const r of runs) {
    const cur = byModel.get(r.model) ?? { cost: 0, pass: 0, runs: 0, calls: 0, tokens: 0 };
    cur.cost += r.totalCost ?? 0;
    cur.pass += r.passRate;
    cur.runs += 1;
    cur.calls += r.totalCalls;
    cur.tokens += r.totalTokens;
    byModel.set(r.model, cur);
  }
  const points: Point[] = Array.from(byModel.entries()).map(([model, v]) => ({
    model,
    cost: v.calls > 0 ? (v.cost / v.calls) * 100 : 0, // $ per 100 calls
    passRate: v.pass / v.runs,
    runs: v.runs,
    tokens: v.tokens,
  }));

  if (points.length === 0) {
    const body = `<header class="hero"><h1>Cost–quality Pareto</h1><div class="sub">No runs with cost data yet.</div></header>`;
    return htmlDoc("venice-bench · pareto", "pareto", body, PARETO_CSS);
  }

  const frontier = computeFrontier(points);
  const maxCost = Math.max(...points.map((p) => p.cost), 0.001) * 1.1;
  const W = 640, H = 490;
  const PAD = 50;
  const plotW = W - PAD - 20;
  const plotH = H - PAD - 20;

  const xFor = (c: number) => PAD + (c / maxCost) * plotW;
  const yFor = (p: number) => H - PAD - p * plotH;

  // Frontier line (sort efficient points by cost asc)
  const eff = points.filter((p) => frontier.has(p.model)).sort((a, b) => a.cost - b.cost);
  const frontierPath =
    eff.length >= 2
      ? `<polyline points="${eff.map((p) => `${xFor(p.cost).toFixed(1)},${yFor(p.passRate).toFixed(1)}`).join(" ")}"
          fill="none" stroke="var(--accent)" stroke-dasharray="4 4" stroke-width="1.5" />`
      : "";

  // Grid lines
  const gridY = [0, 0.25, 0.5, 0.75, 1.0]
    .map((v) => `<line x1="${PAD}" y1="${yFor(v)}" x2="${W - 20}" y2="${yFor(v)}" stroke="#1f2a5a" stroke-width="1" />
       <text x="${PAD - 8}" y="${yFor(v) + 3}" fill="#8aa0c8" font-size="10" text-anchor="end" font-family="ui-monospace,monospace">${(v * 100).toFixed(0)}%</text>`)
    .join("");

  const gridX = [0, 0.25, 0.5, 0.75, 1.0]
    .map((t) => {
      const c = maxCost * t;
      return `<line x1="${xFor(c)}" y1="${H - PAD}" x2="${xFor(c)}" y2="20" stroke="#1f2a5a" stroke-width="1" />
              <text x="${xFor(c)}" y="${H - PAD + 16}" fill="#8aa0c8" font-size="10" text-anchor="middle" font-family="ui-monospace,monospace">${c === 0 ? "$0" : fmtUsd(c)}</text>`;
    })
    .join("");

  const dots = points
    .map((p) => {
      const isEff = frontier.has(p.model);
      const color = isEff ? "#5dff9a" : "#8aa0c8";
      const r = isEff ? 7 : 5;
      return `<g>
        <circle cx="${xFor(p.cost).toFixed(1)}" cy="${yFor(p.passRate).toFixed(1)}" r="${r}" fill="${color}" fill-opacity="0.7" stroke="${color}" stroke-width="1.5">
          <title>${escape(p.model)} · ${fmtPct(p.passRate)} pass · ${fmtUsd(p.cost)} / 100 calls</title>
        </circle>
        <text x="${(xFor(p.cost) + 9).toFixed(1)}" y="${(yFor(p.passRate) + 4).toFixed(1)}" fill="${color}" font-size="10" font-family="ui-monospace,monospace">${escape(p.model.length > 20 ? p.model.slice(0, 19) + "…" : p.model)}<title>${escape(p.model)}</title></text>
      </g>`;
    })
    .join("");

  const svg = `<svg class="scatter" viewBox="0 0 ${W + 40} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${gridX}${gridY}
    ${frontierPath}
    ${dots}
    <text x="${W / 2}" y="${H - 8}" fill="#8aa0c8" font-size="11" text-anchor="middle">cost per 100 calls →</text>
    <text transform="translate(14,${H / 2}) rotate(-90)" fill="#8aa0c8" font-size="11" text-anchor="middle">pass rate →</text>
  </svg>`;

  const tableRows = points
    .sort((a, b) => b.passRate - a.passRate || a.cost - b.cost)
    .map((p) => {
      const cls = frontier.has(p.model) ? "efficient" : "dominated";
      return `<tr class="${cls}">
        <td>${frontier.has(p.model) ? "★" : " "} ${escape(p.model)}</td>
        <td class="num">${fmtPct(p.passRate)}</td>
        <td class="num">${fmtUsd(p.cost)}</td>
        <td class="num">${p.runs}</td>
      </tr>`;
    })
    .join("");

  const body = `
    <header class="hero">
      <h1>Cost–quality Pareto</h1>
      <div class="sub">${points.length} model${points.length === 1 ? "" : "s"} · ★ on the efficient frontier (no cheaper model has higher pass).</div>
    </header>
    <section class="panel">
      <div class="scatter-wrap">
        <div class="scroll-x">${svg}</div>
        <table class="frontier">
          <thead><tr><th>Model</th><th class="num">Pass</th><th class="num">$/100 calls</th><th class="num">Runs</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </section>
  `;
  return htmlDoc("venice-bench · pareto", "pareto", body, PARETO_CSS);
}
