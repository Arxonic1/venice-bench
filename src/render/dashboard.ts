import { loadBaseline, computeDeltas } from "../baseline.ts";
import {
  TABLE_SORT_SCRIPT,
  baselineBanner,
  escape,
  fmtDateTime,
  fmtPct,
  fmtRel,
  fmtTokens,
  fmtUsd,
  htmlDoc,
  listRuns,
  passClass,
  uniqueModels,
} from "./shared.ts";
import type { RunSummary } from "./shared.ts";

const DASHBOARD_CSS = `
  header.hero {
    border: 1px solid var(--line); border-radius: 14px;
    padding: 20px 24px; margin-bottom: 20px;
    background: linear-gradient(180deg, rgba(0,229,199,0.08), rgba(0,0,0,0));
  }
  h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: 0.5px;
       background: linear-gradient(90deg, var(--accent), var(--accent-2));
       -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { color: var(--muted); font-size: 13px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap: 12px; margin-top: 16px; }
  .kpi { background: rgba(255,255,255,0.03); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
  .kpi .n { font-size: 22px; color: var(--accent); font-weight: 600; }
  .kpi .l { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }

  h2 { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.4px; font-weight: 500; margin: 0 0 10px; }
  .panel { border: 1px solid var(--line); border-radius: 14px; padding: 16px 20px; margin-bottom: 18px;
           background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0)); }

  .filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
  .filters label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-right: 4px; }
  .filters select, .filters input[type="text"] {
    background: rgba(0,0,0,0.3); color: var(--fg); border: 1px solid var(--line);
    border-radius: 6px; padding: 4px 8px; font: inherit; font-size: 12px;
  }
  .filters .toggle { display: flex; gap: 4px; align-items: center; font-size: 12px; color: var(--muted); cursor: pointer; }
  .filters .count { color: var(--accent-2); font-family: ui-monospace, monospace; font-size: 11px; margin-left: auto; }

  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted);
       font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  td { padding: 8px 10px; border-bottom: 1px solid rgba(31,42,90,0.4); vertical-align: middle; }
  td.num { text-align: right; font-family: ui-monospace, SFMono-Regular, monospace; }
  td.tok { color: var(--fg); }
  td.tok.good { color: var(--accent-2); }
  td.tok.strong { color: var(--accent); font-weight: 600; }
  td.cost { color: var(--accent-2); }
  td.cost.strong { color: var(--accent); font-weight: 600; }
  td.num.ok { color: var(--accent-2); }
  td.num.warn { color: var(--warn); }
  td.num.bad { color: var(--bad); }
  tr.failed-run { opacity: 0.45; }
  tr.failed-run:hover { opacity: 1; }
  tr.run-row.selected { background: rgba(0,229,199,0.08); outline: 1px solid rgba(0,229,199,0.3); }

  .model-cell { font-family: ui-monospace, monospace; font-size: 12px; white-space: nowrap; }
  .date { color: var(--muted); font-size: 11px; font-family: ui-monospace, monospace; white-space: nowrap; }
  .date .rel { display: block; font-size: 10px; color: #5a6ba0; }

  .baseline-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 9px; letter-spacing: 1px;
                    background: rgba(0,229,199,0.15); color: var(--accent); border-radius: 3px; }
  .actions a { margin-right: 10px; font-size: 12px; }
  .actions a.sub { color: var(--muted); }
  .actions button { background: none; border: 1px solid var(--line); color: var(--muted); font: inherit; font-size: 11px;
                    padding: 2px 8px; border-radius: 4px; cursor: pointer; }
  .actions button:hover { color: var(--accent); border-color: var(--accent); }
  .empty { padding: 40px 20px; text-align: center; color: var(--muted); }

  .delta-up   { color: var(--accent-2); }
  .delta-down { color: var(--bad); }
  .delta-flat { color: var(--muted); }

  .bulk-bar { position: sticky; bottom: 16px; display: none; margin-top: 16px; padding: 10px 14px;
              border: 1px solid var(--accent); border-radius: 10px; background: rgba(0,229,199,0.12);
              backdrop-filter: blur(12px); align-items: center; gap: 12px; }
  .bulk-bar.show { display: flex; }
  .bulk-bar button { background: var(--accent); color: #002030; font-weight: 600;
                     border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px; }
  footer { color: var(--muted); font-size: 11px; margin-top: 24px; text-align: center; }
`;

function deltaCell(delta: number | null, type: "pp" | "usd"): string {
  if (delta == null) return `<td class="num delta-flat">—</td>`;
  const cls = Math.abs(delta) < (type === "pp" ? 0.5 : 0.00005) ? "delta-flat" : delta > 0 ? "delta-up" : "delta-down";
  const str =
    type === "pp"
      ? (delta >= 0 ? "+" : "") + delta.toFixed(1) + "pp"
      : (delta >= 0 ? "+" : "−") + "$" + Math.abs(delta).toFixed(4);
  return `<td class="num ${cls}">${str}</td>`;
}

export function renderDashboard(): string {
  const runs = listRuns();
  const baseline = loadBaseline();
  const haveBaseline = !!baseline;
  const models = uniqueModels(runs);

  // Model-level aggregates
  const byModel = new Map<string, { runs: number; tokens: number; cost: number; passRate: number; hasCost: boolean }>();
  for (const r of runs) {
    if (r.isBaselineRun) continue;
    const cur = byModel.get(r.model) ?? { runs: 0, tokens: 0, cost: 0, passRate: 0, hasCost: true };
    cur.runs += 1;
    cur.tokens += r.totalTokens;
    cur.cost += r.totalCost ?? 0;
    cur.passRate += r.passRate;
    if (r.totalCost == null) cur.hasCost = false;
    byModel.set(r.model, cur);
  }
  const modelRows = Array.from(byModel.entries())
    .map(([model, v]) => ({
      model,
      runs: v.runs,
      tokens: v.tokens,
      cost: v.hasCost ? v.cost : null,
      passRate: v.passRate / v.runs,
    }))
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));

  const grandTokens = runs.reduce((a, r) => a + r.totalTokens, 0);
  const grandCost = runs.reduce((a, r) => a + (r.totalCost ?? 0), 0);

  // Per-run delta vs baseline
  const deltaForRun = (r: RunSummary) => {
    if (!baseline || r.model === baseline.model || r.isBaselineRun) {
      return { passDelta: null as number | null, costDelta: null as number | null };
    }
    const deltas = computeDeltas(r.suites, baseline.results);
    const passDelta =
      deltas.reduce((a, d) => a + d.passRateDeltaPp, 0) / (deltas.length || 1);
    const costDeltas = deltas
      .map((d) => d.costPerRunDelta)
      .filter((c): c is number => c != null);
    const costDelta = costDeltas.length
      ? costDeltas.reduce((a, b) => a + b, 0) / costDeltas.length
      : null;
    return { passDelta, costDelta };
  };

  const runRows = runs.map((r) => {
      const cls = r.isBaselineRun ? "baseline" : passClass(r.passRate);
      const label = r.isBaselineRun ? `<span class="baseline-badge">BASELINE</span>` : "";
      const failedCls = r.totalCalls === 0 || r.passRate < 0.5 ? "failed-run" : "";
      const { passDelta, costDelta } = deltaForRun(r);
      const copyCmd = `./bin/venice-bench.mjs run-all -m ${r.model} -n 20`;
      return `<tr class="run-row ${failedCls}" data-model="${escape(r.model)}" data-passrate="${r.passRate}" data-failed="${r.passRate < 0.5}" data-captured="${escape(r.capturedAt)}">
        <td><input type="checkbox" class="row-select" data-id="${escape(r.id)}"></td>
        <td class="model-cell">${escape(r.model)} ${label}</td>
        <td class="date" data-val="${escape(r.capturedAt)}">${escape(fmtDateTime(r.capturedAt))}<span class="rel">${escape(fmtRel(r.capturedAt))}</span></td>
        <td class="num" title="${r.suites.filter(s => s.skippedReason).map(s => `${s.suite}: ${s.skippedReason}`).join("; ") || ""}">${r.suites.length}${r.suites.some(s => s.skippedReason) ? ` <span style="color:#8899ff;font-size:10px;" title="${r.suites.filter(s => s.skippedReason).map(s => s.suite).join(", ")} skipped">⊘</span>` : ""}</td>
        <td class="num ${cls}">${fmtPct(r.passRate)}</td>
        ${haveBaseline ? deltaCell(passDelta, "pp") : ""}
        <td class="num tok">${fmtTokens(r.totalPrompt - r.totalCached)}</td>
        <td class="num tok good">${fmtTokens(r.totalCached)}</td>
        <td class="num tok">${fmtTokens(r.totalCompletion)}</td>
        <td class="num tok strong">${fmtTokens(r.totalTokens)}</td>
        <td class="num cost">${fmtUsd(r.totalCost)}</td>
        ${haveBaseline ? deltaCell(costDelta, "usd") : ""}
        <td class="actions">
          <a href="/run/${encodeURIComponent(r.id)}/report.html">report</a>
          <a href="/run/${encodeURIComponent(r.id)}/" class="sub">files</a>
          <button class="copy-cmd" data-cmd="${escape(copyCmd)}" title="copy run command">⧉ cmd</button>
        </td>
      </tr>`;
    }).join("");

  const modelCostRows = modelRows
    .map((m) => `<tr>
        <td class="model-cell"><a href="/radar?models=${encodeURIComponent(m.model)}">${escape(m.model)}</a></td>
        <td class="num">${m.runs}</td>
        <td class="num ${passClass(m.passRate)}">${fmtPct(m.passRate)}</td>
        <td class="num tok">${fmtTokens(m.tokens)}</td>
        <td class="num cost strong">${fmtUsd(m.cost)}</td>
      </tr>`)
    .join("");

  const modelOptions = models.map((m) => `<option value="${escape(m)}">${escape(m)}</option>`).join("");

  const body = `
    <header class="hero">
      <h1>Dashboard</h1>
      <div class="sub">${runs.length} run${runs.length === 1 ? "" : "s"} · ${byModel.size} model${byModel.size === 1 ? "" : "s"}${baseline ? ` · baseline: <code>${escape(baseline.model)}</code>` : ""}</div>
      <div class="kpis">
        <div class="kpi"><div class="n">${runs.length}</div><div class="l">Runs</div></div>
        <div class="kpi"><div class="n">${fmtTokens(grandTokens)}</div><div class="l">Total tokens</div></div>
        <div class="kpi"><div class="n">${fmtUsd(grandCost)}</div><div class="l">Total cost</div></div>
        <div class="kpi"><div class="n">${byModel.size}</div><div class="l">Models</div></div>
      </div>
    </header>

    ${baselineBanner("dashboard")}

    ${modelRows.length > 0 ? `
    <section class="panel">
      <h2>Cost by model</h2>
      <div class="scroll-x">
        <table data-sortable>
          <thead><tr><th data-sort="str">Model</th><th class="num" data-sort="num">Runs</th><th class="num" data-sort="num">Avg pass</th><th class="num" data-sort="num">Tokens</th><th class="num" data-sort="num">Total cost</th></tr></thead>
          <tbody>${modelCostRows}</tbody>
        </table>
      </div>
    </section>
    ` : ""}

    <section class="panel">
      <h2>All runs</h2>
      <div class="filters">
        <label>model</label>
        <select id="filter-model"><option value="">all</option>${modelOptions}</select>
        <label>min pass</label>
        <select id="filter-pass">
          <option value="0">any</option>
          <option value="0.5">≥ 50%</option>
          <option value="0.9">≥ 90%</option>
          <option value="1">100% only</option>
        </select>
        <label class="toggle"><input type="checkbox" id="filter-hide-failed" checked> hide 0% runs</label>
        <span class="count" id="row-count"></span>
        <button id="csv-export" style="background:none;border:1px solid var(--line);color:var(--muted);font:inherit;font-size:11px;padding:3px 10px;border-radius:5px;cursor:pointer;" title="Download visible rows as CSV">⬇ CSV</button>
      </div>
      ${runs.length === 0 ? `<div class="empty">No runs yet.<br><code>./bin/venice-bench.mjs run-all -m qwen-3-6-max-preview</code></div>` : `
      <div class="scroll-x">
        <table id="runs-table" data-sortable>
          <thead>
            <tr>
              <th></th><th data-sort="str">Model</th><th data-sort="str">Captured</th><th class="num" data-sort="num">Suites</th><th class="num" data-sort="num">Pass</th>
              ${haveBaseline ? `<th class="num" data-sort="num">Δ pass</th>` : ""}
              <th class="num" data-sort="num">Prompt</th><th class="num" data-sort="num">Cached</th><th class="num" data-sort="num">Completion</th><th class="num" data-sort="num">Total tok</th>
              <th class="num" data-sort="num">Cost</th>
              ${haveBaseline ? `<th class="num" data-sort="num">Δ cost</th>` : ""}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${runRows}</tbody>
        </table>
      </div>
      `}
      ${TABLE_SORT_SCRIPT}
    </section>

    <div class="bulk-bar" id="bulk-bar">
      <span id="bulk-count">0 selected</span>
      <button id="bulk-compare">Compare →</button>
      <button id="bulk-clear">Clear</button>
    </div>

    <footer>venice-bench dashboard · auto-refreshes on reload · keyboard: <code>j</code>/<code>k</code> next/prev run, <code>b</code> baseline</footer>

    <script>
    (() => {
      const modelSel = document.getElementById('filter-model');
      const passSel = document.getElementById('filter-pass');
      const hideFail = document.getElementById('filter-hide-failed');
      const count = document.getElementById('row-count');
      const rows = [...document.querySelectorAll('#runs-table tbody tr.run-row')];

      function save(k, v) { localStorage.setItem('vb-filter-' + k, v); }
      function load(k, dflt) { const v = localStorage.getItem('vb-filter-' + k); return v == null ? dflt : v; }

      modelSel.value = load('model', '');
      passSel.value = load('pass', '0');
      hideFail.checked = load('hideFailed', 'true') === 'true';

      // Row selection state (used by j/k keyboard nav and apply())
      let selectedIdx = -1;
      function visibleRows() { return rows.filter(r => r.style.display !== 'none'); }

      function apply() {
        const m = modelSel.value;
        const minPass = parseFloat(passSel.value);
        const hf = hideFail.checked;
        let shown = 0;
        // Track whether the currently-selected row survives the filter
        const prevSelected = rows.find(r => r.classList.contains('selected'));
        for (const r of rows) {
          const rm = r.dataset.model;
          const rp = parseFloat(r.dataset.passrate);
          const fail = r.dataset.failed === 'true';
          const ok = (!m || rm === m) && rp >= minPass && !(hf && fail);
          r.style.display = ok ? '' : 'none';
          if (ok) shown++;
        }
        count.textContent = shown + ' / ' + rows.length + ' runs';
        // If the previously selected row is now hidden, reset selection state
        if (prevSelected && prevSelected.style.display === 'none') {
          prevSelected.classList.remove('selected');
          selectedIdx = -1;
        } else if (prevSelected) {
          // Recalculate index within the new visible set
          selectedIdx = visibleRows().indexOf(prevSelected);
        }
      }
      modelSel.addEventListener('change', () => { save('model', modelSel.value); apply(); });
      passSel.addEventListener('change', () => { save('pass', passSel.value); apply(); });
      hideFail.addEventListener('change', () => { save('hideFailed', hideFail.checked); apply(); });
      apply();

      // Copy-cmd buttons
      document.querySelectorAll('.copy-cmd').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.preventDefault();
          await navigator.clipboard.writeText(btn.dataset.cmd);
          const prev = btn.textContent;
          btn.textContent = '✓ copied';
          setTimeout(() => btn.textContent = prev, 1500);
        });
      });

      // Bulk compare
      const bulkBar = document.getElementById('bulk-bar');
      const bulkCount = document.getElementById('bulk-count');
      const bulkCompare = document.getElementById('bulk-compare');
      const bulkClear = document.getElementById('bulk-clear');
      function updateBulk() {
        const sel = [...document.querySelectorAll('.row-select:checked')].map(c => c.dataset.id);
        bulkCount.textContent = sel.length + ' selected';
        bulkBar.classList.toggle('show', sel.length > 0);
        bulkCompare.disabled = sel.length < 2;
        return sel;
      }
      document.querySelectorAll('.row-select').forEach(c => c.addEventListener('change', updateBulk));
      bulkCompare.addEventListener('click', () => {
        const sel = updateBulk();
        if (sel.length >= 2) location.href = '/compare?runs=' + encodeURIComponent(sel.join(','));
      });
      bulkClear.addEventListener('click', () => {
        document.querySelectorAll('.row-select:checked').forEach(c => c.checked = false);
        updateBulk();
      });

      // Keyboard nav — j/k row selection, b → baseline
      function setSelected(idx) {
        const visible = visibleRows();
        if (!visible.length) return;
        // Clamp
        idx = Math.max(0, Math.min(idx, visible.length - 1));
        // Clear previous
        visible.forEach(r => r.classList.remove('selected'));
        visible[idx].classList.add('selected');
        visible[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        selectedIdx = idx;
      }

      document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.key === 'j') { setSelected(selectedIdx < 0 ? 0 : selectedIdx + 1); return; }
        if (e.key === 'k') { setSelected(selectedIdx < 0 ? 0 : selectedIdx - 1); return; }
        if (e.key === 'b') location.href = '/baseline';
      });

      // CSV export — downloads visible rows
      const csvBtn = document.getElementById('csv-export');
      if (csvBtn) {
        csvBtn.addEventListener('click', () => {
          const visible = rows.filter(r => r.style.display !== 'none');
          const header = 'model,captured_at,suites,pass_rate,total_tokens,total_cost';
          const lines = visible.map(r => {
            const cells = [...r.querySelectorAll('td')];
            // col order: checkbox, model, date, suites, pass, [delta], prompt, cached, completion, total_tok, cost, [delta], actions
            const model = (cells[1] ? cells[1].textContent.trim() : '').replace(/,/g, ' ');
            const captured = (cells[2] ? cells[2].textContent.split('\\n')[0].trim() : '').replace(/,/g, ' ');
            const suites = cells[3] ? cells[3].textContent.trim() : '';
            const passRate = cells[4] ? cells[4].textContent.trim() : '';
            // Find cost cell — it's the one with '$' sign among the numeric cells
            const costCell = [...cells].find(c => c.className.includes('cost') && !c.className.includes('delta'));
            const cost = costCell ? costCell.textContent.trim() : '';
            // total tokens cell — last of the tok cells
            const tokCells = [...cells].filter(c => c.className.includes('tok'));
            const totalTok = tokCells.length ? tokCells[tokCells.length-1].textContent.trim() : '';
            return [model, captured, suites, passRate, totalTok, cost].join(',');
          });
          const csv = [header, ...lines].join('\\n');
          const blob = new Blob([csv], { type: 'text/csv' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'venice-bench-runs.csv';
          a.click();
        });
      }

      // Auto-refresh: reload every 30s (simplest approach — avoids diffing row counts)
      setTimeout(() => location.reload(), 30000);
    })();
    </script>
  `;

  return htmlDoc("venice-bench · dashboard", "dashboard", body, DASHBOARD_CSS);
}
