// Shared trial-inspector modal markup + script.
// Used by both /run/:id/report.html (report.ts) and /inspect (inspect.ts).
// Caller must embed this at the bottom of the <body>, before </body>.

export const MODAL_CSS = `
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: none; z-index: 100; }
  .modal-backdrop.show { display: flex; align-items: center; justify-content: center; }
  .modal { max-width: 900px; width: calc(100% - 32px); max-height: 85vh; overflow: auto;
           background: var(--bg2); border: 1px solid var(--accent); border-radius: 12px; padding: 20px; }
  .modal-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px;
                border-bottom: 1px solid var(--line); padding-bottom: 10px; }
  .modal-head h3 { margin: 0; color: var(--accent); font-size: 16px; font-family: ui-monospace, monospace; }
  .modal-close { background: none; border: none; color: var(--muted); font-size: 20px; cursor: pointer; }
  .modal-close:hover { color: var(--fg); }
  .modal-section { margin-bottom: 14px; }
  .modal-section h4 { margin: 0 0 6px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
  .modal-section pre { background: rgba(0,0,0,0.4); padding: 10px 12px; border-radius: 6px;
                       font: 12px/1.5 ui-monospace, SFMono-Regular, monospace; color: var(--fg);
                       white-space: pre-wrap; word-break: break-word; max-height: 400px; overflow: auto; }
  .modal-section pre .think { color: var(--warn); background: rgba(255,207,74,0.08); padding: 2px 4px; border-radius: 3px; }
  .reasons-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .reasons-list .pill { padding: 3px 8px; border-radius: 12px; font-size: 11px; font-family: ui-monospace, monospace; }
  .reasons-list .pill.fail { background: rgba(255,107,107,0.12); color: var(--bad); }
  .reasons-list .pill.pass { background: rgba(93,255,154,0.10); color: var(--accent-2); }
  .kv-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; font-size: 12px; }
  .kv-grid .k { color: var(--muted); }
  .kv-grid .v { font-family: ui-monospace, monospace; color: var(--fg); }
`;

export const MODAL_HTML = `
  <div class="modal-backdrop" id="trial-modal">
    <div class="modal">
      <div class="modal-head">
        <h3 id="m-title">trial</h3>
        <button class="modal-close" id="m-close" title="close (Esc)">×</button>
      </div>
      <div id="m-body"></div>
    </div>
  </div>
`;

export const MODAL_SCRIPT = `
<script>
(() => {
  const modal = document.getElementById('trial-modal');
  const mTitle = document.getElementById('m-title');
  const mBody = document.getElementById('m-body');
  const mClose = document.getElementById('m-close');

  function closeModal() { modal.classList.remove('show'); }
  mClose.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function highlightThink(s) {
    return esc(s).replace(/&lt;think&gt;([\\s\\S]*?)&lt;\\/think&gt;/gi,
      '<span class="think">&lt;think&gt;$1&lt;/think&gt;</span>');
  }

  const isFile = window.location.protocol === 'file:';

  window.__openTrial = async function(runId, suite, idx) {
    if (isFile) {
      mTitle.textContent = 'Trial drill-down unavailable';
      mBody.innerHTML = '<div style="padding:20px;color:var(--muted);">File:// protocol — run <code>venice-bench serve</code> and open from there.</div>';
      modal.classList.add('show');
      return;
    }
    mTitle.textContent = suite + ' · trial #' + idx;
    mBody.innerHTML = '<div style="color:var(--muted);padding:20px;">loading...</div>';
    modal.classList.add('show');
    try {
      // Try the per-trial endpoint (local serve); fall back to slicing the
      // suite JSON (static snapshot — no per-trial files).
      const trialUrl = '/api/trial/' + encodeURIComponent(runId) + '/' + encodeURIComponent(suite) + '/' + encodeURIComponent(idx);
      const suiteUrl = '/run/' + encodeURIComponent(runId) + '/' + encodeURIComponent(suite) + '.json';
      let t = null;
      let lastStatus = 0;
      for (const url of [trialUrl, suiteUrl]) {
        const res = await fetch(url);
        lastStatus = res.status;
        if (!res.ok) continue;
        const data = await res.json();
        if (data && Array.isArray(data.trials)) {
          const tr = data.trials[Number(idx)];
          if (!tr) { mBody.innerHTML = '<div style="color:var(--bad);padding:20px;">trial ' + idx + ' not found</div>'; return; }
          t = {
            index: tr.index, passed: tr.passed, reasons: tr.reasons, metrics: tr.metrics,
            latency_ms: tr.call.latencyMs,
            prompt_tokens: tr.call.promptTokens || 0,
            cached_tokens: tr.call.cachedTokens || 0,
            completion_tokens: tr.call.completionTokens || 0,
            finish_reason: tr.call.finishReason || null,
            error: tr.call.error || null,
            tool_calls: tr.call.toolCalls || null,
            content: tr.call.content || '',
          };
        } else {
          t = data;
        }
        break;
      }
      if (!t) { mBody.innerHTML = '<div style="color:var(--bad);padding:20px;">error: ' + lastStatus + '</div>'; return; }
      const passedLabel = t.passed
        ? '<span class="pill pass">PASS</span>'
        : '<span class="pill fail">FAIL</span>';
      const reasons = (t.reasons || []).map(r => '<span class="pill fail">' + esc(r) + '</span>').join('');
      const metricRows = Object.entries(t.metrics || {})
        .map(([k,v]) => '<span class="k">' + esc(k) + '</span><span class="v">' + esc(String(v)) + '</span>').join('');
      const toolStr = t.tool_calls ? JSON.stringify(t.tool_calls, null, 2) : null;
      const contentHtml = !t.content
        ? '<em style="color:var(--muted);">(empty)</em>'
        : t.content.length > 20480
          ? '<pre>' + esc(t.content) + '</pre>'
          : '<pre>' + highlightThink(t.content) + '</pre>';
      mBody.innerHTML =
        '<div class="modal-section"><h4>Result</h4><div class="reasons-list">' + passedLabel + '</div></div>' +
        (reasons ? '<div class="modal-section"><h4>Failure reasons</h4><div class="reasons-list">' + reasons + '</div></div>' : '') +
        '<div class="modal-section"><h4>Metadata</h4><div class="kv-grid">' +
          '<span class="k">latency</span><span class="v">' + Math.round(t.latency_ms) + 'ms</span>' +
          '<span class="k">tokens (prompt / cached / completion)</span><span class="v">' + t.prompt_tokens + ' / ' + t.cached_tokens + ' / ' + t.completion_tokens + '</span>' +
          '<span class="k">finish reason</span><span class="v">' + esc(t.finish_reason || '—') + '</span>' +
          (t.error ? '<span class="k">error</span><span class="v" style="color:var(--bad);">' + esc(t.error) + '</span>' : '') +
        '</div></div>' +
        (metricRows ? '<div class="modal-section"><h4>Metrics</h4><div class="kv-grid">' + metricRows + '</div></div>' : '') +
        (toolStr ? '<div class="modal-section"><h4>Tool calls</h4><pre>' + esc(toolStr) + '</pre></div>' : '') +
        '<div class="modal-section"><h4>Response content</h4>' + contentHtml + '</div>';
    } catch (err) {
      mBody.innerHTML = '<div style="color:var(--bad);padding:20px;">' + esc(String(err)) + '</div>';
    }
  };

  document.querySelectorAll('tr.trial-row').forEach(row => {
    row.addEventListener('click', () => {
      window.__openTrial(row.dataset.run, row.dataset.suite, row.dataset.index);
    });
  });
})();
</script>
`;
