import { TABLE_SORT_SCRIPT, escape, fmtDateTime, htmlDoc, listRuns, passClass } from "./shared.ts";
import { MODAL_CSS, MODAL_HTML, MODAL_SCRIPT } from "./modal.ts";

const MAX_ROWS = 500;

const INSPECT_CSS = `
  ${MODAL_CSS}
  .panel { border: 1px solid var(--line); border-radius: 14px; padding: 16px 20px; margin-bottom: 18px;
           background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0)); }
  .filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
  .filters label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-right: 2px; }
  .filters input[type="text"], .filters select {
    background: rgba(0,0,0,0.3); color: var(--fg); border: 1px solid var(--line);
    border-radius: 6px; padding: 4px 8px; font: inherit; font-size: 12px;
  }
  .count-note { font-size: 11px; color: var(--muted); margin-left: auto; font-family: ui-monospace, monospace; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted);
       font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  td { padding: 6px 10px; border-bottom: 1px solid rgba(31,42,90,0.4); vertical-align: middle; font-size: 12px; }
  td.num { text-align: right; font-family: ui-monospace, monospace; }
  td.mono { font-family: ui-monospace, monospace; }
  tr.trial-row { cursor: pointer; }
  tr.trial-row:hover { background: rgba(0,229,199,0.05); }
  .pass-badge { padding: 2px 7px; border-radius: 10px; font-size: 10px; font-family: ui-monospace, monospace; font-weight: 600; }
  .pass-badge.ok { background: rgba(93,255,154,0.12); color: var(--accent-2); }
  .pass-badge.bad { background: rgba(255,107,107,0.12); color: var(--bad); }
  .reasons-cell { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                  color: var(--muted); font-size: 11px; font-family: ui-monospace, monospace; }
  .empty { padding: 40px 20px; text-align: center; color: var(--muted); }
  footer { color: var(--muted); font-size: 11px; margin-top: 24px; text-align: center; }
`;

interface FlatTrial {
  runId: string;
  model: string;
  suite: string;
  index: number;
  passed: boolean;
  latencyMs: number;
  reasons: string;
  capturedAt: string;
}

export function renderInspect(): string {
  const runs = listRuns().filter((r) => !r.isBaselineRun);

  // Flatten all trials across all runs (up to MAX_ROWS)
  const allTrials: FlatTrial[] = [];
  let totalCount = 0;

  outer: for (const run of runs) {
    for (const suite of run.suites) {
      for (const trial of suite.trials) {
        totalCount++;
        if (allTrials.length < MAX_ROWS) {
          allTrials.push({
            runId: run.id,
            model: run.model,
            suite: suite.suite,
            index: trial.index,
            passed: trial.passed,
            latencyMs: trial.call.latencyMs,
            reasons: trial.reasons.join("; "),
            capturedAt: run.capturedAt,
          });
        }
      }
    }
  }

  const uniqueModels = Array.from(new Set(allTrials.map((t) => t.model))).sort();
  const uniqueSuites = Array.from(new Set(allTrials.map((t) => t.suite))).sort();
  const modelOptions = uniqueModels.map((m) => `<option value="${escape(m)}">${escape(m)}</option>`).join("");
  const suiteOptions = uniqueSuites.map((s) => `<option value="${escape(s)}">${escape(s)}</option>`).join("");

  const truncNote = totalCount > MAX_ROWS
    ? `<span class="count-note" id="count-note">showing ${MAX_ROWS} of ${totalCount} — use filters to narrow</span>`
    : `<span class="count-note" id="count-note">${totalCount} trials total</span>`;

  const rows = allTrials
    .map((t) => {
      const passBadge = t.passed
        ? `<span class="pass-badge ok">PASS</span>`
        : `<span class="pass-badge bad">FAIL</span>`;
      return `<tr class="trial-row" data-run="${escape(t.runId)}" data-suite="${escape(t.suite)}" data-index="${t.index}"
               data-model="${escape(t.model)}" data-passed="${t.passed}" data-reasons="${escape(t.reasons)}">
        <td class="mono" style="font-size:11px;color:var(--muted);">${escape(t.runId.slice(0, 14))}</td>
        <td class="mono">${escape(t.model)}</td>
        <td class="mono">${escape(t.suite)}</td>
        <td class="num">${t.index}</td>
        <td data-val="${t.passed ? 1 : 0}">${passBadge}</td>
        <td class="num">${Math.round(t.latencyMs)}ms</td>
        <td class="reasons-cell" title="${escape(t.reasons)}">${escape(t.reasons || "—")}</td>
      </tr>`;
    })
    .join("");

  const tableOrEmpty = allTrials.length === 0
    ? `<div class="empty">No trials found.</div>`
    : `<div style="overflow-x:auto;">
        <table id="trials-table" data-sortable>
          <thead>
            <tr>
              <th data-sort="str">Run</th><th data-sort="str">Model</th><th data-sort="str">Suite</th><th class="num" data-sort="num">#</th>
              <th data-sort="num">Pass</th><th class="num" data-sort="num">Latency</th><th data-sort="str">Reasons</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

  const body = `
    <header style="border:1px solid var(--line);border-radius:14px;padding:20px 24px;margin-bottom:20px;background:linear-gradient(180deg,rgba(0,229,199,0.08),rgba(0,0,0,0));">
      <h1 style="margin:0 0 4px;font-size:26px;background:linear-gradient(90deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent;">Trial Inspector</h1>
      <div style="color:var(--muted);font-size:13px;">${runs.length} runs · ${totalCount.toLocaleString()} trials across all suites</div>
    </header>

    <div class="panel">
      <div class="filters">
        <label>model</label>
        <select id="f-model"><option value="">all</option>${modelOptions}</select>
        <label>suite</label>
        <select id="f-suite"><option value="">all</option>${suiteOptions}</select>
        <label>pass</label>
        <select id="f-pass">
          <option value="">all</option>
          <option value="true">pass only</option>
          <option value="false">fail only</option>
        </select>
        <label>search</label>
        <input type="text" id="f-search" placeholder="reasons / suite / model…" style="min-width:200px;">
        ${truncNote}
      </div>
      ${tableOrEmpty}
    </div>

    <footer>Click any row to inspect the full trial response · ${totalCount > MAX_ROWS ? `showing first ${MAX_ROWS} rows server-side — filters narrow further` : `all ${totalCount} trials loaded`}</footer>

    ${MODAL_HTML}
    ${MODAL_SCRIPT}
    ${TABLE_SORT_SCRIPT}

    <script>
    (() => {
      const fModel = document.getElementById('f-model');
      const fSuite = document.getElementById('f-suite');
      const fPass = document.getElementById('f-pass');
      const fSearch = document.getElementById('f-search');
      const countNote = document.getElementById('count-note');
      const rows = [...document.querySelectorAll('#trials-table tbody tr.trial-row')];

      function apply() {
        const model = fModel ? fModel.value : '';
        const suite = fSuite ? fSuite.value : '';
        const pass = fPass ? fPass.value : '';
        const search = fSearch ? fSearch.value.toLowerCase() : '';
        let shown = 0;
        for (const row of rows) {
          const rm = row.dataset.model || '';
          const rs = row.dataset.suite || '';
          const rp = row.dataset.passed || '';
          const rr = (row.dataset.reasons || '').toLowerCase();
          const ok =
            (!model || rm === model) &&
            (!suite || rs === suite) &&
            (!pass || rp === pass) &&
            (!search || rm.toLowerCase().includes(search) || rs.toLowerCase().includes(search) || rr.includes(search));
          row.style.display = ok ? '' : 'none';
          if (ok) shown++;
        }
        if (countNote) {
          const total = ${totalCount};
          countNote.textContent = total > ${MAX_ROWS}
            ? 'showing ' + shown + ' of ' + total + ' — use filters to narrow'
            : shown + ' / ' + total + ' trials';
        }
      }

      if (fModel) fModel.addEventListener('change', apply);
      if (fSuite) fSuite.addEventListener('change', apply);
      if (fPass) fPass.addEventListener('change', apply);
      if (fSearch) fSearch.addEventListener('input', apply);
    })();
    </script>
  `;

  return htmlDoc("venice-bench · inspect", "inspect", body, INSPECT_CSS);
}
