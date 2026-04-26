import { ALL_SUITES } from "../suites/index.ts";
import {
  escape,
  fmtPct,
  htmlDoc,
  listRuns,
  uniqueModels,
} from "./shared.ts";
import type { RunSummary } from "./shared.ts";

const RADAR_CSS = `
  header.hero { border: 1px solid var(--line); border-radius: 14px; padding: 20px 24px; margin-bottom: 18px;
                background: linear-gradient(180deg, rgba(0,229,199,0.08), rgba(0,0,0,0)); }
  h1 { margin: 0 0 4px; font-size: 24px;
       background: linear-gradient(90deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { color: var(--muted); font-size: 13px; }
  .panel { border: 1px solid var(--line); border-radius: 14px; padding: 16px 20px; margin-bottom: 18px;
           background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0)); }

  .model-picker { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .model-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
                border: 1px solid var(--line); border-radius: 20px; cursor: pointer;
                font-family: ui-monospace, monospace; font-size: 12px; color: var(--muted); user-select: none;
                transition: background .1s ease, border-color .1s ease, color .1s ease; }
  .model-chip:hover { border-color: var(--accent); color: var(--fg); }
  .model-chip.on { border-color: var(--chip); background: var(--chip); color: #0a1030; font-weight: 600; }
  .model-chip input { display: none; }

  .radar-wrap { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items: start; }
  @media (max-width: 900px) { .radar-wrap { grid-template-columns: 1fr; } }
  .radar-svg { width: 100%; max-width: 600px; aspect-ratio: 1; }
  .legend-table { width: 100%; border-collapse: collapse; }
  .legend-table th, .legend-table td { padding: 6px 8px; font-size: 12px; border-bottom: 1px solid var(--line); text-align: left; }
  .legend-table th { color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: 1px; font-size: 10px; }
  .legend-table td.num { text-align: right; font-family: ui-monospace, monospace; }
  .legend-color { display: inline-block; width: 12px; height: 12px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
`;

const PALETTE = ["#00e5c7", "#5dff9a", "#ffcf4a", "#ff6b6b", "#8a9dff", "#ff9a5d", "#b86bff", "#5dffff"];

function polygonPoints(values: number[], cx: number, cy: number, r: number): string {
  const n = values.length;
  return values
    .map((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const rr = r * v;
      return `${(cx + Math.cos(angle) * rr).toFixed(1)},${(cy + Math.sin(angle) * rr).toFixed(1)}`;
    })
    .join(" ");
}

export function renderRadar(selectedModels: string[]): string {
  const runs = listRuns().filter((r) => !r.isBaselineRun);
  const models = uniqueModels(runs);

  // For each model, take the latest run's per-suite pass rates.
  const latestByModel = new Map<string, Map<string, number>>();
  const latestRunByModel = new Map<string, RunSummary>();
  for (const model of models) {
    const latest = runs.find((r) => r.model === model);
    if (!latest) continue;
    latestRunByModel.set(model, latest);
    const m = new Map<string, number>();
    for (const s of latest.suites) m.set(s.suite, s.summary.passRate);
    latestByModel.set(model, m);
  }

  // Default to the 3 models whose latest run is most recent.
  const modelsByRecency = [...models].sort((a, b) => {
    const ta = latestRunByModel.get(a)?.capturedAt ?? "";
    const tb = latestRunByModel.get(b)?.capturedAt ?? "";
    return tb.localeCompare(ta);
  });
  const shown = selectedModels.length ? selectedModels : modelsByRecency.slice(0, 3);

  const size = 640;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 110;
  const axes = ALL_SUITES.length;

  const gridCircles = [0.25, 0.5, 0.75, 1.0]
    .map((r) => `<circle cx="${cx}" cy="${cy}" r="${radius * r}" fill="none" stroke="#1f2a5a" stroke-width="1" />`)
    .join("");

  const axisLines = ALL_SUITES.map((_, i) => {
    const angle = (Math.PI * 2 * i) / axes - Math.PI / 2;
    const x2 = cx + Math.cos(angle) * radius;
    const y2 = cy + Math.sin(angle) * radius;
    return `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#1f2a5a" stroke-width="1" />`;
  }).join("");

  const axisLabels = ALL_SUITES.map((name, i) => {
    const angle = (Math.PI * 2 * i) / axes - Math.PI / 2;
    const lx = cx + Math.cos(angle) * (radius + 36);
    const ly = cy + Math.sin(angle) * (radius + 36);
    const anchor = Math.abs(Math.cos(angle)) < 0.1 ? "middle" : Math.cos(angle) > 0 ? "start" : "end";
    return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" fill="#8aa0c8" font-size="10" font-family="ui-monospace,monospace">${name}</text>`;
  }).join("");

  const polygons = shown.map((model, idx) => {
    const m = latestByModel.get(model);
    if (!m) return "";
    const values = ALL_SUITES.map((s) => m.get(s) ?? 0);
    const color = PALETTE[idx % PALETTE.length];
    return `<g>
      <polygon points="${polygonPoints(values, cx, cy, radius)}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="2" />
      ${values.map((v, i) => {
        const angle = (Math.PI * 2 * i) / axes - Math.PI / 2;
        const rr = radius * v;
        const x = cx + Math.cos(angle) * rr;
        const y = cy + Math.sin(angle) * rr;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}"><title>${escape(model)} · ${ALL_SUITES[i]}: ${fmtPct(v)}</title></circle>`;
      }).join("")}
    </g>`;
  }).join("");

  const svg = `<svg class="radar-svg" viewBox="-40 -40 ${size + 80} ${size + 80}" xmlns="http://www.w3.org/2000/svg">
    ${gridCircles}
    ${axisLines}
    ${polygons}
    ${axisLabels}
  </svg>`;

  // Model chips (with color indicator when on)
  const chipHtml = models
    .map((m, i) => {
      const on = shown.includes(m);
      const color = on ? PALETTE[shown.indexOf(m) % PALETTE.length] : "#1f2a5a";
      return `<label class="model-chip ${on ? "on" : ""}" style="--chip:${color};border-color:${on ? color : "var(--line)"};${on ? `background:${color};` : `color:var(--muted);`}">
        <input type="checkbox" class="pick-model" value="${escape(m)}" ${on ? "checked" : ""}>
        ${escape(m)}
      </label>`;
    })
    .join("");

  const legendRows = shown
    .map((model, idx) => {
      const color = PALETTE[idx % PALETTE.length];
      const latestRun = latestRunByModel.get(model);
      const passRate = latestRun?.passRate ?? 0;
      return `<tr><td><span class="legend-color" style="background:${color};"></span>${escape(model)}</td><td class="num">${fmtPct(passRate)}</td></tr>`;
    })
    .join("");

  const body = `
    <header class="hero">
      <h1>Model radar</h1>
      <div class="sub">One axis per suite · latest run per model · pass rate is the outer ring (100%).</div>
    </header>
    <section class="panel">
      <div class="model-picker">${chipHtml}</div>
      ${shown.length === 0 ? `<div style="color:var(--muted);padding:20px 0;">Pick 1–4 models above to overlay.</div>` : `
      <div class="radar-wrap">
        <div class="scroll-x">${svg}</div>
        <table class="legend-table">
          <thead><tr><th>Model</th><th class="num">Pass (latest)</th></tr></thead>
          <tbody>${legendRows}</tbody>
        </table>
      </div>
      `}
    </section>
    <script>
      document.querySelectorAll('.pick-model').forEach(cb => {
        cb.addEventListener('change', () => {
          const models = [...document.querySelectorAll('.pick-model:checked')].map(c => c.value);
          const q = models.length ? '?models=' + encodeURIComponent(models.join(',')) : '';
          location.href = '/radar' + q;
        });
      });
    </script>
  `;
  return htmlDoc("venice-bench · radar", "radar", body, RADAR_CSS);
}
