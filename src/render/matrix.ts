import { ALL_SUITES } from "../suites/index.ts";
import {
  TABLE_SORT_SCRIPT,
  escape,
  fmtPct,
  htmlDoc,
  listRuns,
  passClass,
  uniqueModels,
} from "./shared.ts";
import type { RunSummary } from "./shared.ts";
import type { SuiteName } from "../types.ts";

const SUITE_DESCRIPTIONS: Record<string, string> = {
  "tool-choice":         "Forced tool-choice stress test. Measures tool-call rate, JSON validity, and whether the model leaks prose content alongside tool_calls.",
  "json-schema":         "Strict JSON schema conformance — all required fields present, correct types, enum adherence, no extra keys. Seed values rotate per trial to prevent memorisation.",
  "thinking-tag":        "Reasoning correctness + tag hygiene. Model must answer a numeric question correctly. If it uses <think> tags they must be balanced and stripped — tag use is optional, but if used it must be clean.",
  "extraction":          "Faithful extraction from a synthetic document: speaker, org, named frameworks, and a numeric range. Checks recall against a gold set and flags any fabricated frameworks.",
  "long-context":        "Needle-in-haystack retrieval across 16k / 32k / 64k context windows at 6 insertion depths. Shows where a model's context recall degrades.",
  "latency":             "Streaming latency. Trial passes if TTFB (time to first byte) < 3s and total response time < 15s.",
  "safety":              "False-refusal rate on 8 benign everyday prompts. A good model answers helpfully — passing means it did NOT refuse.",
  "prompt-cache":        "Prompt-cache effectiveness. Sends the same ~3k-token prefix repeatedly and measures how many tokens are served from cache vs re-computed.",
  "schema-hardness":     "Schema difficulty ramp across 4 tiers: flat object → nested → union types → recursive. Shows the exact tier where a model starts failing.",
  "multi-turn":          "Multi-turn memory. A 4-turn conversation plants a number and a city in early turns, then asks for both at the end as JSON. Tests context retention across turns.",
  "refusal-calibration": "Refusal calibration — 8 prompts that SHOULD be refused (harmful requests). Measures false-compliance rate. Pair with the safety suite to get a full calibration picture.",
  "tool-ambiguity":      "Tool disambiguation. Two plausible tools are available but only one is correct for each prompt. Tests whether the model reasons about tool semantics, not just formats JSON.",
  "output-length":       "Output length control. Asks for exactly 3 bullets × 12 words each. Measures whether the model follows precise formatting constraints.",
  "vision":              "Vision OCR. A test image contains the string 'VB-42' — the model must read it. Rotates 3 prompt phrasings. Skipped automatically for non-vision models.",
  "podcast-triage":      "Podcast episode triage rubric. Given episode metadata, the model must output the correct RED / YELLOW / GREEN priority decision and an accurate count of prioritise-triggers.",
  "podcast-analysis":    "Full crypto podcast analysis. Given a transcript, the model must produce a 13-section investment brief, capture planted signals, and output a portfolio action table.",
};

const MATRIX_CSS = `
  header.hero { border: 1px solid var(--line); border-radius: 14px; padding: 20px 24px; margin-bottom: 18px;
                background: linear-gradient(180deg, rgba(0,229,199,0.08), rgba(0,0,0,0)); }
  h1 { margin: 0 0 4px; font-size: 24px;
       background: linear-gradient(90deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { color: var(--muted); font-size: 13px; }
  .panel { border: 1px solid var(--line); border-radius: 14px; padding: 16px 20px; margin-bottom: 18px;
           background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0)); }

  table.matrix { border-collapse: separate; border-spacing: 3px; }
  table.matrix th { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px;
                    font-weight: 500; padding: 6px 8px; text-align: left; white-space: nowrap; }
  table.matrix th.suite { transform: rotate(-40deg); transform-origin: bottom left; height: 140px; vertical-align: bottom; }
  table.matrix td.model { font-family: ui-monospace, monospace; font-size: 12px; padding: 6px 12px 6px 0; white-space: nowrap; color: var(--fg); }
  table.matrix td.cell {
    width: 72px; height: 40px; text-align: center; border-radius: 6px;
    font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: transform .1s ease;
  }
  table.matrix td.cell:hover { transform: scale(1.07); outline: 1px solid var(--accent); }
  table.matrix td.cell a { color: inherit; display: block; }
  .legend { display: flex; gap: 10px; align-items: center; font-size: 11px; color: var(--muted); margin-top: 10px; }
  .legend .chip { display: inline-block; width: 16px; height: 16px; border-radius: 4px; }
  .tip-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 13px; height: 13px; border-radius: 50%;
    background: rgba(0,229,199,0.15); color: var(--accent);
    font-size: 8px; font-weight: 700; font-style: normal;
    cursor: help; margin-left: 3px; vertical-align: middle;
    user-select: none; flex-shrink: 0; line-height: 1;
  }
  .tip-icon:hover { background: rgba(0,229,199,0.32); }
  #suite-tip {
    position: fixed; z-index: 9999;
    background: #0d1526; border: 1px solid var(--line);
    border-radius: 8px; padding: 10px 14px;
    max-width: 280px; font-size: 12px; color: var(--fg);
    line-height: 1.55; pointer-events: none;
    box-shadow: 0 6px 24px rgba(0,0,0,0.6);
    display: none;
  }
`;

function cellColor(passRate: number): { bg: string; fg: string } {
  // Gradient from bad (red) → warn (amber) → ok (green) with saturation by pass rate.
  if (passRate === 1) return { bg: "rgba(93,255,154,0.26)", fg: "#5dff9a" };
  if (passRate >= 0.9) return { bg: "rgba(255,207,74,0.22)", fg: "#ffcf4a" };
  if (passRate >= 0.5) return { bg: "rgba(255,107,107,0.2)", fg: "#ff8a8a" };
  return { bg: "rgba(255,107,107,0.32)", fg: "#ff6b6b" };
}

// A trial is "rate-limited" if its reasons contain a hard 429 OR an api_error:timeout.
// Timeouts during sustained 429 backoff are indistinguishable from genuine slow inference
// at the trial level, but in this benchmark's experience the dominant cause is throttling.
const RL_THRESHOLD = 0.5;
function rateLimitRatio(trials: { reasons: string[] }[]): number {
  if (trials.length === 0) return 0;
  let hit = 0;
  for (const t of trials) {
    for (const r of t.reasons || []) {
      if (r.includes("HTTP 429") || r === "api_error:timeout" || r.startsWith("api_error:HTTP 429")) {
        hit++;
        break;
      }
    }
  }
  return hit / trials.length;
}

export function renderMatrix(): string {
  const runs = listRuns().filter((r) => !r.isBaselineRun);
  const models = uniqueModels(runs);
  // For each (model, suite), pick the latest run's suite result.
  // listRuns() already sorts newest-first (after baseline), so the FIRST time
  // we see a (model, suite) pair is the most recent.
  type Cell = { passRate: number; runId: string; runs: number; rlRatio: number } | null;
  const grid: Record<string, Record<string, Cell>> = {};
  for (const model of models) grid[model] = Object.fromEntries(ALL_SUITES.map((s) => [s, null]));

  for (const r of runs) {
    for (const s of r.suites) {
      if (grid[r.model][s.suite] != null) continue;
      grid[r.model][s.suite] = {
        passRate: s.summary.passRate,
        runId: r.id,
        runs: s.summary.runs,
        rlRatio: rateLimitRatio(s.trials || []),
      };
    }
  }

  const overallTip =
    `Overall score = simple mean of suite pass rates (only counting suites with results). Cells where ≥${Math.round(RL_THRESHOLD * 100)}% of trials hit Venice rate-limits or timeouts are marked "RL" and excluded — they don't reflect model quality.`;
  const header = ALL_SUITES.map((s) => {
    const label = s.length > 14 ? s.slice(0, 13) + "…" : s;
    const desc = SUITE_DESCRIPTIONS[s] ?? s;
    return `<th class="suite" data-sort="num" data-tip="${escape(desc)}" style="cursor:pointer;"><span style="display:inline-flex;align-items:center;gap:3px;">${escape(label)}<i class="tip-icon">i</i></span></th>`;
  }).join("");
  const overallHeader = `<th data-sort="num" data-tip="${escape(overallTip)}" style="cursor:pointer;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:center;padding:6px 8px;"><span style="display:inline-flex;align-items:center;gap:3px;">Overall<i class="tip-icon">i</i></span></th>`;

  type RowData = { model: string; overall: number | null; scoredCount: number; rlCount: number; cells: string };
  const rowData: RowData[] = models.map((model) => {
    const scored: { passRate: number }[] = [];
    let rlCount = 0;
    const cells = ALL_SUITES.map((s) => {
      const c = grid[model][s];
      if (!c) return `<td class="cell" style="background:rgba(255,255,255,0.03);color:var(--muted);">—</td>`;
      // Rate-limited cell: don't count toward Overall, don't pretend the score is meaningful.
      if (c.rlRatio >= RL_THRESHOLD) {
        rlCount++;
        const rlPct = Math.round(c.rlRatio * 100);
        return `<td class="cell" style="background:rgba(138,160,200,0.12);color:var(--muted);font-style:italic;" title="${escape(model)} · ${s} · ${fmtPct(c.passRate)} reported, but ${rlPct}% of trials were rate-limited or timed out — score excluded from Overall">
          <a href="/run/${encodeURIComponent(c.runId)}/report.html#suite-${s}">RL</a>
        </td>`;
      }
      scored.push(c);
      const col = cellColor(c.passRate);
      // anchor target: report.ts adds id="suite-{name}" — keep in sync
      return `<td class="cell" style="background:${col.bg};color:${col.fg};" title="${escape(model)} · ${s} · ${fmtPct(c.passRate)} on ${c.runs} runs">
        <a href="/run/${encodeURIComponent(c.runId)}/report.html#suite-${s}">${fmtPct(c.passRate)}</a>
      </td>`;
    }).join("");
    const overall = scored.length === 0 ? null : scored.reduce((a, c) => a + c.passRate, 0) / scored.length;
    return { model, overall, scoredCount: scored.length, rlCount, cells };
  });

  // Pre-sort by Overall descending so the page loads ranked best→worst.
  // Models with no data sink to the bottom. Users can re-sort by clicking any header.
  rowData.sort((a, b) => {
    const av = a.overall ?? -1;
    const bv = b.overall ?? -1;
    if (bv !== av) return bv - av;
    return a.model.localeCompare(b.model);
  });

  const rows = rowData
    .map(({ model, overall, scoredCount, rlCount, cells }) => {
      let overallCell: string;
      if (overall === null) {
        overallCell = `<td class="cell overall" data-val="-1" style="background:rgba(255,255,255,0.03);color:var(--muted);">—</td>`;
      } else {
        const col = cellColor(overall);
        const rlNote = rlCount > 0 ? `, ${rlCount} rate-limited cell${rlCount === 1 ? "" : "s"} excluded` : "";
        overallCell = `<td class="cell overall" data-val="${(overall * 100).toFixed(2)}" style="background:${col.bg};color:${col.fg};box-shadow:inset 0 0 0 1px ${col.fg};font-weight:700;" title="${escape(model)} · overall · ${fmtPct(overall)} across ${scoredCount}/${ALL_SUITES.length} suites${rlNote}">${fmtPct(overall)}</td>`;
      }
      return `<tr><td class="model">${escape(model)}</td>${overallCell}${cells}</tr>`;
    })
    .join("");

  const body = `
    <header class="hero">
      <h1>Model × Suite matrix</h1>
      <div class="sub">${models.length} model${models.length === 1 ? "" : "s"} · ${ALL_SUITES.length} suites · pass rate from latest run per (model, suite).</div>
    </header>
    <section class="panel">
      ${models.length === 0 ? `<div style="color:var(--muted);padding:20px 0;">No runs yet. Kick one off: <code>./bin/venice-bench.mjs run-all -m &lt;model&gt;</code></div>` : `
      <div class="scroll-x">
        <table class="matrix" data-sortable>
          <thead><tr><th data-sort="str" style="cursor:pointer;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;">Model</th>${overallHeader}${header}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="legend">
        <span class="chip" style="background:rgba(93,255,154,0.26);"></span> 100%
        <span class="chip" style="background:rgba(255,207,74,0.22);"></span> ≥ 90%
        <span class="chip" style="background:rgba(255,107,107,0.2);"></span> ≥ 50%
        <span class="chip" style="background:rgba(255,107,107,0.32);"></span> &lt; 50%
        <span class="chip" style="background:rgba(138,160,200,0.12);"></span> RL — rate-limited (excluded from Overall)
        <span style="margin-left:auto;">click any cell to jump to that suite in the report</span>
      </div>
      `}
    </section>
    <div id="suite-tip"></div>
    <script>
    (() => {
      const tip = document.getElementById('suite-tip');
      document.querySelectorAll('th[data-tip]').forEach(el => {
        el.addEventListener('mouseenter', e => {
          tip.textContent = el.dataset.tip;
          tip.style.display = 'block';
        });
        el.addEventListener('mousemove', e => {
          const tw = tip.offsetWidth, th = tip.offsetHeight;
          let x = e.clientX + 14, y = e.clientY + 14;
          if (x + tw > window.innerWidth)  x = e.clientX - tw - 10;
          if (y + th > window.innerHeight) y = e.clientY - th - 10;
          tip.style.left = x + 'px';
          tip.style.top  = y + 'px';
        });
        el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      });
    })();
    </script>
    ${TABLE_SORT_SCRIPT}
  `;
  return htmlDoc("venice-bench · matrix", "matrix", body, MATRIX_CSS);
}
