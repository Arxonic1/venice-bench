import { listModels, type VeniceModel } from "../venice.ts";
import { loadPricing } from "../config.ts";
import { TABLE_SORT_SCRIPT, escape, fmtPct, fmtRel, fmtUsd, htmlDoc, listRuns, } from "./shared.ts";

const MODELS_CSS = `
  header.hero { border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; margin-bottom: 18px;
                background: linear-gradient(180deg, rgba(0,229,199,0.08), rgba(0,0,0,0)); }
  h1 { margin: 0 0 4px; font-size: 24px;
       background: linear-gradient(90deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { color: var(--muted); font-size: 13px; }
  .panel { border: 1px solid var(--line); border-radius: 14px; padding: 12px 16px; margin-bottom: 16px;
           background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0)); }
  .filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 4px; }
  .filters label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
  .filters select, .filters input[type="text"], .filters input[type="search"] {
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
  td.id { font-family: ui-monospace, monospace; font-size: 12px; white-space: nowrap; }
  td.id .caps { font-size: 10px; color: var(--muted); margin-left: 8px; }
  td.last { color: var(--muted); font-size: 11px; font-family: ui-monospace, monospace; }
  td.last .rel { display: block; font-size: 10px; color: #5a6ba0; }
  .status-chip {
    display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 10px; letter-spacing: 0.5px;
    font-weight: 600; text-transform: uppercase;
  }
  .status-chip.unrun { background: rgba(255,207,74,0.14); color: var(--warn); }
  .status-chip.ok    { background: rgba(93,255,154,0.18); color: var(--accent-2); }
  .status-chip.warn  { background: rgba(255,207,74,0.18); color: var(--warn); }
  .status-chip.bad   { background: rgba(255,107,107,0.18); color: var(--bad); }
  .pricing-chip {
    display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 10px;
    background: rgba(0,229,199,0.10); color: var(--accent); font-family: ui-monospace, monospace;
  }
  .pricing-chip.missing { background: rgba(255,107,107,0.12); color: var(--bad); }
  button.copy-cmd { background: none; border: 1px solid var(--line); color: var(--muted);
                    font: inherit; font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
  button.copy-cmd:hover { color: var(--accent); border-color: var(--accent); }
  .caps-tag { display: inline-block; margin-right: 4px; padding: 1px 5px; background: rgba(255,255,255,0.04);
              border-radius: 3px; font-size: 9px; color: var(--muted); letter-spacing: 0.5px; }
`;

function capTags(m: VeniceModel): string {
  const caps = m.model_spec?.capabilities ?? {};
  return [
    caps.supportsFunctionCalling && "tools",
    caps.supportsReasoning && "reasoning",
    caps.supportsResponseSchema && "schema",
    caps.supportsVision && "vision",
    caps.supportsWebSearch && "web",
  ]
    .filter(Boolean)
    .map((t) => `<span class="caps-tag">${t}</span>`)
    .join("");
}

function ctxLabel(m: VeniceModel): string {
  const t = m.model_spec?.availableContextTokens;
  if (!t) return "";
  if (t >= 1_000_000) return (t / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (t >= 1000) return Math.round(t / 1000) + "K";
  return String(t);
}

export async function renderModels(): Promise<string> {
  let models: VeniceModel[] = [];
  let fetchError = "";
  try {
    models = await listModels();
  } catch (err: any) {
    fetchError = String(err?.message ?? err);
  }

  const pricing = loadPricing();
  const runs = listRuns();

  // Last run per model: pass rate + capturedAt
  const byModel = new Map<string, { passRate: number; capturedAt: string; runId: string; runs: number }>();
  for (const r of runs) {
    if (r.isBaselineRun) continue;
    if (!byModel.has(r.model)) {
      byModel.set(r.model, {
        passRate: r.passRate,
        capturedAt: r.capturedAt,
        runId: r.id,
        runs: r.suites.length,
      });
    }
  }

  // Merge Venice catalog with pricing-only entries (models we priced but Venice might not show today).
  const allIds = new Set<string>([...models.map((m) => m.id), ...Object.keys(pricing)]);
  const catalog = Array.from(allIds).sort();

  const rows = catalog
    .map((id) => {
      const m = models.find((x) => x.id === id);
      const p = pricing[id];
      const last = byModel.get(id);
      const hasPricing = !!p;
      const benchmarked = !!last;
      const statusCls = !benchmarked ? "unrun" : last.passRate === 1 ? "ok" : last.passRate >= 0.9 ? "warn" : "bad";
      const statusLabel = benchmarked ? fmtPct(last.passRate) : "unrun";
      const statusLink = benchmarked
        ? `<a href="/run/${encodeURIComponent(last.runId)}/report.html" class="status-chip ${statusCls}">${statusLabel}</a>`
        : `<span class="status-chip ${statusCls}">${statusLabel}</span>`;

      const pricingCell = hasPricing
        ? `<span class="pricing-chip">${fmtUsd(p.inputPerMillion)}/${fmtUsd(p.outputPerMillion)}${p.cachedReadPerMillion != null ? ` · ${fmtUsd(p.cachedReadPerMillion)} cache` : ""}</span>`
        : `<span class="pricing-chip missing">no pricing</span>`;

      const cmd = `cd /Users/daniel./Projects/venice-bench && ./bin/venice-bench.mjs run-all -m ${id} -n 20`;
      const cmdQuick = `cd /Users/daniel./Projects/venice-bench && ./bin/venice-bench.mjs run-all -m ${id} -n 5`;
      const cmdPodcast = `cd /Users/daniel./Projects/venice-bench && ./bin/venice-bench.mjs run -s podcast-analysis -m ${id} -n 10`;

      const caps = m?.model_spec?.capabilities ?? {};
      const capTokens = [
        (caps as any).supportsFunctionCalling && "tools",
        (caps as any).supportsReasoning && "reasoning",
        (caps as any).supportsResponseSchema && "schema",
        (caps as any).supportsVision && "vision",
        (caps as any).supportsWebSearch && "web",
      ].filter(Boolean).join(",");
      return `<tr class="model-row" data-benchmarked="${benchmarked}" data-pricing="${hasPricing}" data-venice="${!!m}" data-id="${escape(id)}" data-caps="${escape(capTokens)}">
        <td class="id" data-val="${escape(id)}">${escape(id)} <span class="caps">${capTags(m as VeniceModel) || '<span style="color:#3a4a80;">catalog-only</span>'}</span></td>
        <td class="num">${ctxLabel(m as VeniceModel) || "—"}</td>
        <td data-val="${hasPricing ? p.inputPerMillion : -1}">${pricingCell}</td>
        <td data-val="${benchmarked ? last!.passRate : -1}">${statusLink}</td>
        <td class="last" data-val="${benchmarked ? escape(last!.capturedAt) : ''}">${benchmarked ? `${fmtRel(last!.capturedAt)}` : "—"}</td>
        <td>
          <button class="copy-cmd" data-cmd="${escape(cmdQuick)}" title="5-run quick smoke">⧉ quick</button>
          <button class="copy-cmd" data-cmd="${escape(cmd)}" title="20-run full sweep">⧉ full</button>
          <button class="copy-cmd" data-cmd="${escape(cmdPodcast)}" title="10-run podcast analysis">⧉ podcast</button>
        </td>
      </tr>`;
    })
    .join("");

  const ctrlBenchmarked = Array.from(byModel.keys()).length;
  const ctrlPriced = Object.keys(pricing).length;
  const ctrlTotal = catalog.length;

  const body = `
    <header class="hero">
      <h1>Models catalog</h1>
      <div class="sub">${ctrlTotal} models · ${ctrlPriced} with pricing · ${ctrlBenchmarked} benchmarked${fetchError ? ` · <span style="color:var(--bad);">Venice API error: ${escape(fetchError.slice(0, 100))}</span>` : ""}</div>
    </header>

    <section class="panel">
      <div class="filters">
        <label>search</label>
        <input type="search" id="f-search" placeholder="filter by id..." style="min-width:220px;">
        <label>capability</label>
        <select id="f-cap">
          <option value="">any</option>
          <option value="tools">tools</option>
          <option value="reasoning">reasoning</option>
          <option value="schema">schema</option>
          <option value="vision">vision</option>
          <option value="web">web</option>
        </select>
        <label class="toggle"><input type="checkbox" id="f-unrun"> only unrun</label>
        <label class="toggle"><input type="checkbox" id="f-priced" checked> only priced</label>
        <label class="toggle"><input type="checkbox" id="f-venice"> only live on Venice</label>
        <span class="count" id="row-count"></span>
      </div>
    </section>

    <section class="panel">
      <div class="scroll-x">
        <table id="models-table" data-sortable>
          <thead><tr>
            <th data-sort="str">Model id</th><th class="num" data-sort="num">Context</th><th data-sort="num">Pricing (in / out)</th>
            <th data-sort="num">Status</th><th data-sort="str">Last run</th><th>Commands</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    ${TABLE_SORT_SCRIPT}
  </section>

  <section class="panel" style="background:rgba(0,229,199,0.03);">
      <h3 style="margin:0 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px;">How to iterate</h3>
      <ol style="margin:0;padding-left:20px;color:var(--fg);font-size:13px;line-height:1.7;">
        <li>Check <strong>⧉ quick</strong> — copies a 5-run smoke command (~2-3 min, &lt;$0.10 per model).</li>
        <li>Paste in your terminal. Dashboard updates as soon as the run finishes.</li>
        <li>Promising model? Hit <strong>⧉ full</strong> for the 20-run sweep.</li>
        <li>Baseline ≠ your current model? Every run-all auto-renders deltas vs baseline on the report.</li>
      </ol>
    </section>

    <script>
    (() => {
      const rows = [...document.querySelectorAll('#models-table tbody tr.model-row')];
      const fSearch = document.getElementById('f-search');
      const fCap = document.getElementById('f-cap');
      const fUnrun = document.getElementById('f-unrun');
      const fPriced = document.getElementById('f-priced');
      const fVenice = document.getElementById('f-venice');
      const count = document.getElementById('row-count');

      function save(k, v) { localStorage.setItem('vb-models-' + k, v); }
      function load(k, dflt) { const v = localStorage.getItem('vb-models-' + k); return v == null ? dflt : v; }

      fSearch.value = load('search', '');
      fCap.value = load('cap', '');
      fUnrun.checked = load('unrun', 'false') === 'true';
      fPriced.checked = load('priced', 'true') === 'true';
      fVenice.checked = load('venice', 'false') === 'true';

      function apply() {
        const q = fSearch.value.toLowerCase();
        const cap = fCap.value;
        const onlyUnrun = fUnrun.checked;
        const onlyPriced = fPriced.checked;
        const onlyVenice = fVenice.checked;
        let shown = 0;
        for (const r of rows) {
          const id = r.dataset.id.toLowerCase();
          const benchmarked = r.dataset.benchmarked === 'true';
          const priced = r.dataset.pricing === 'true';
          const venice = r.dataset.venice === 'true';
          const caps = r.dataset.caps;
          const ok =
            (!q || id.includes(q)) &&
            (!cap || caps.toLowerCase().includes(cap)) &&
            (!onlyUnrun || !benchmarked) &&
            (!onlyPriced || priced) &&
            (!onlyVenice || venice);
          r.style.display = ok ? '' : 'none';
          if (ok) shown++;
        }
        count.textContent = shown + ' / ' + rows.length + ' models';
      }
      fSearch.addEventListener('input', () => { save('search', fSearch.value); apply(); });
      fCap.addEventListener('change', () => { save('cap', fCap.value); apply(); });
      fUnrun.addEventListener('change', () => { save('unrun', fUnrun.checked); apply(); });
      fPriced.addEventListener('change', () => { save('priced', fPriced.checked); apply(); });
      fVenice.addEventListener('change', () => { save('venice', fVenice.checked); apply(); });
      apply();

      document.querySelectorAll('.copy-cmd').forEach(btn => {
        btn.addEventListener('click', async () => {
          await navigator.clipboard.writeText(btn.dataset.cmd);
          const prev = btn.textContent;
          btn.textContent = '✓ copied';
          setTimeout(() => btn.textContent = prev, 1500);
        });
      });
    })();
    </script>
  `;

  return htmlDoc("venice-bench · models", "models", body, MODELS_CSS);
}
