// Shared rendering helpers for the dashboard, per-run report, and analysis pages.
import fs from "node:fs";
import path from "node:path";
import { BASELINE_DIR, MONTHLY_BUDGET_USD, RESULTS_DIR } from "../config.ts";
import { loadBaseline } from "../baseline.ts";
import type { SuiteResult } from "../types.ts";

export const CSS_TOKENS = `
  :root {
    --bg: #0a1030; --bg2: #0d1440; --fg: #e6edff; --muted: #8aa0c8;
    --line: #1f2a5a; --accent: #00e5c7; --accent-2: #5dff9a;
    --warn: #ffcf4a; --bad: #ff6b6b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, sans-serif;
    background: radial-gradient(1200px 600px at 20% -10%, #15206a 0%, var(--bg) 60%) var(--bg);
    color: var(--fg);
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 3px; font-size: 11px; font-family: ui-monospace, SFMono-Regular, monospace; }
  .scroll-x { overflow-x: auto; }
`;

export const NAV_CSS = `
  .topnav {
    display: flex; gap: 18px; align-items: center;
    padding: 10px 16px; margin-bottom: 20px;
    border: 1px solid var(--line); border-radius: 10px;
    background: rgba(255,255,255,0.02);
  }
  .topnav .brand { font-weight: 700; color: var(--accent); letter-spacing: 0.5px; }
  .topnav a { color: var(--muted); font-size: 13px; padding: 4px 0; }
  .topnav a:hover { color: var(--fg); text-decoration: none; }
  .topnav a.active { color: var(--accent-2); }
  .topnav .spacer { flex: 1; }
  .topnav .tz { font-size: 10px; color: var(--muted); font-family: ui-monospace, monospace; }
`;

export function renderNav(active: string): string {
  const links: [string, string, string][] = [
    ["/", "dashboard", "dashboard"],
    ["/models", "models", "models"],
    ["/matrix", "matrix", "matrix"],
    ["/radar", "radar", "radar"],
    ["/pareto", "pareto", "pareto"],
    ["/trends", "trends", "trends"],
    ["/inspect", "inspect", "inspect"],
    ["/baseline", "baseline", "baseline"],
  ];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `<nav class="topnav">
    <span class="brand">venice-bench</span>
    ${links.map(([href, label, key]) => `<a href="${href}" class="${key === active ? "active" : ""}">${escape(label)}</a>`).join("")}
    <span class="spacer"></span>
    <span class="tz">times in ${escape(tz)}</span>
  </nav>`;
}

export function escape(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmtTokens(n: number): string {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 0.0001) return "$" + n.toFixed(6);
  if (n < 0.01) return "$" + n.toFixed(5);
  if (n < 1) return "$" + n.toFixed(4);
  return "$" + n.toFixed(2);
}

export function fmtMs(n: number): string {
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

export function fmtRel(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return iso;
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export function passClass(pr: number): string {
  if (pr === 1) return "ok";
  if (pr >= 0.9) return "warn";
  return "bad";
}

// -----------------------------------------------------------------------------
// Data loading — cached briefly so page loads don't re-scan the FS excessively.
// -----------------------------------------------------------------------------

export interface RunSummary {
  id: string;
  model: string;
  capturedAt: string;
  suites: SuiteResult[];
  totalCalls: number;
  passed: number;
  passRate: number;
  totalPrompt: number;
  totalCached: number;
  totalCompletion: number;
  totalTokens: number;
  totalCost: number | null;
  hasBreakdown: boolean;
  isBaselineRun: boolean; // true if this IS the baseline's cached copy
}

// 3-second cache — plenty for an interactive dashboard, keeps refresh fast.
let cache: { runs: RunSummary[]; at: number } | null = null;
const CACHE_MS = 3000;

export function pickPrompt(r: SuiteResult): number {
  return r.summary.tokens.totalPrompt ?? Math.round((r.summary.tokens.avgPrompt || 0) * r.summary.runs);
}
export function pickCompletion(r: SuiteResult): number {
  return r.summary.tokens.totalCompletion ?? Math.round((r.summary.tokens.avgCompletion || 0) * r.summary.runs);
}
export function pickCached(r: SuiteResult): number {
  return r.summary.tokens.totalCached ?? 0;
}

function readRun(id: string): RunSummary | null {
  const dir = path.join(RESULTS_DIR, id);
  const mfPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(mfPath)) return null;
  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(mfPath, "utf8"));
  } catch {
    return null;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  const suites: SuiteResult[] = [];
  for (const f of files) {
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SuiteResult;
      if (obj && obj.summary) suites.push(obj);
    } catch {
      /* skip */
    }
  }
  if (suites.length === 0 && dir !== BASELINE_DIR) return null;

  const totalCalls = suites.reduce((a, r) => a + r.summary.runs, 0);
  const passed = suites.reduce((a, r) => a + r.summary.passed, 0);
  const totalPrompt = suites.reduce((a, r) => a + pickPrompt(r), 0);
  const totalCached = suites.reduce((a, r) => a + pickCached(r), 0);
  const totalCompletion = suites.reduce((a, r) => a + pickCompletion(r), 0);
  const totalTokens = totalPrompt + totalCompletion;
  const costs = suites.map((r) => r.summary.cost.totalUsd).filter((c): c is number => c != null);
  const totalCost = costs.length === suites.length && suites.length > 0 ? costs.reduce((a, b) => a + b, 0) : null;
  const hasBreakdown = suites.length > 0 && suites.every((r) => r.summary.cost.breakdown != null);

  return {
    id,
    model: manifest.model ?? "unknown",
    capturedAt: manifest.createdAt ?? manifest.capturedAt ?? "",
    suites,
    totalCalls,
    passed,
    passRate: totalCalls > 0 ? passed / totalCalls : 0,
    totalPrompt,
    totalCached,
    totalCompletion,
    totalTokens,
    totalCost,
    hasBreakdown,
    isBaselineRun: id === "_baseline",
  };
}

export function listRuns(force = false): RunSummary[] {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.runs;
  if (!fs.existsSync(RESULTS_DIR)) {
    cache = { runs: [], at: Date.now() };
    return [];
  }
  const entries = fs.readdirSync(RESULTS_DIR).filter((e) => {
    const p = path.join(RESULTS_DIR, e);
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  });
  const runs = entries
    .map((id) => readRun(id))
    .filter((r): r is RunSummary => !!r)
    .sort((a, b) => {
      if (a.isBaselineRun && !b.isBaselineRun) return -1;
      if (!a.isBaselineRun && b.isBaselineRun) return 1;
      return b.capturedAt.localeCompare(a.capturedAt);
    });
  cache = { runs, at: Date.now() };
  return runs;
}

export function invalidateCache() {
  cache = null;
}

export function uniqueModels(runs: RunSummary[]): string[] {
  return Array.from(new Set(runs.map((r) => r.model))).sort();
}

// -----------------------------------------------------------------------------
// Budget helpers
// -----------------------------------------------------------------------------

export function budgetContext(): { budget: number | null; spent: number; remaining: number | null; pct: number | null } {
  const runs = listRuns();
  const now = Date.now();
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  const spent = runs
    .filter((r) => {
      const t = new Date(r.capturedAt).getTime();
      return Number.isFinite(t) && now - t < monthMs;
    })
    .reduce((a, r) => a + (r.totalCost ?? 0), 0);
  if (MONTHLY_BUDGET_USD == null) {
    return { budget: null, spent, remaining: null, pct: null };
  }
  return {
    budget: MONTHLY_BUDGET_USD,
    spent,
    remaining: MONTHLY_BUDGET_USD - spent,
    pct: spent / MONTHLY_BUDGET_USD,
  };
}

export function baselineBanner(active: string): string {
  const baseline = loadBaseline();
  if (baseline) return "";
  return `<div class="banner banner-info" style="border:1px solid var(--line);background:rgba(0,229,199,0.06);color:var(--fg);padding:10px 14px;border-radius:10px;margin-bottom:16px;font-size:13px;">
    <strong style="color:var(--accent);">No baseline cached.</strong>
    Run <code>./bin/venice-bench.mjs baseline --refresh</code> to enable delta comparisons on every run-all.
  </div>`;
}

export function budgetBanner(active?: string): string {
  if (active !== undefined && active !== "dashboard") return "";
  const b = budgetContext();
  if (b.budget == null) return "";
  const pct = Math.min(100, (b.pct ?? 0) * 100);
  const cls = pct >= 100 ? "bad" : pct >= 80 ? "warn" : "ok";
  return `<div class="budget-banner ${cls}" style="display:flex;gap:12px;align-items:center;padding:10px 14px;margin-bottom:16px;border:1px solid var(--line);border-radius:10px;background:rgba(0,0,0,0.2);">
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">Monthly spend</div>
    <div style="flex:1;height:8px;background:rgba(0,0,0,0.3);border-radius:4px;overflow:hidden;">
      <div class="budget-fill" style="height:100%;width:${pct.toFixed(1)}%;background:linear-gradient(90deg, var(--accent), ${cls === "bad" ? "var(--bad)" : cls === "warn" ? "var(--warn)" : "var(--accent-2)"});"></div>
    </div>
    <div style="font-family:ui-monospace,monospace;font-size:12px;">${fmtUsd(b.spent)} / ${fmtUsd(b.budget)} <span style="color:var(--muted);">(${pct.toFixed(0)}%)</span></div>
  </div>`;
}

export const TABLE_SORT_SCRIPT = `
<script>
(() => {
  function parseNum(s) {
    s = String(s || '').trim();
    if (!s || s === '—') return -Infinity;
    if (s.endsWith('ms')) return parseFloat(s) || 0;
    if (/^\\d/.test(s) && s.endsWith('s') && !s.endsWith('ms')) return (parseFloat(s) || 0) * 1000;
    if (/[\\d.]+M$/.test(s)) return (parseFloat(s) || 0) * 1e6;
    if (/[\\d.]+K$/.test(s)) return (parseFloat(s) || 0) * 1e3;
    if (s.endsWith('%')) return parseFloat(s) || 0;
    const n = parseFloat(s.replace(/\u2212/g, '-').replace(/[^0-9.\\-]/g, ''));
    return isNaN(n) ? -Infinity : n;
  }
  document.querySelectorAll('table[data-sortable]').forEach(table => {
    const ths = [...table.querySelectorAll('thead th')];
    let lastCol = -1, lastDir = 1;
    ths.forEach((th, colIdx) => {
      if (!th.dataset.sort) return;
      th.style.cursor = 'pointer';
      th.style.userSelect = 'none';
      th.addEventListener('click', e => {
        if (e.target.closest('.tip-icon')) return;
        const dir = colIdx === lastCol ? -lastDir : 1;
        lastCol = colIdx; lastDir = dir;
        ths.forEach(h => { const a = h.querySelector('.sort-arrow'); if (a) a.remove(); });
        const arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        arrow.textContent = dir > 0 ? ' ↑' : ' ↓';
        arrow.style.cssText = 'color:var(--accent);font-size:9px;vertical-align:middle;pointer-events:none;';
        th.appendChild(arrow);
        const tbody = table.querySelector('tbody');
        const rows = [...tbody.querySelectorAll('tr')];
        rows.sort((a, b) => {
          const atd = a.querySelectorAll('td')[colIdx];
          const btd = b.querySelectorAll('td')[colIdx];
          const av = atd?.dataset?.val ?? atd?.textContent?.trim() ?? '';
          const bv = btd?.dataset?.val ?? btd?.textContent?.trim() ?? '';
          const type = th.dataset.sort;
          const cmp = type === 'num'
            ? parseNum(av) - parseNum(bv)
            : av.localeCompare(bv, undefined, {numeric: true, sensitivity: 'base'});
          return cmp * dir;
        });
        rows.forEach(r => tbody.appendChild(r));
      });
    });
  });
})();
</script>
`;

export function htmlDoc(title: string, active: string, body: string, extraCss = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escape(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%230a1030'/><text x='50%25' y='50%25' dominant-baseline='central' text-anchor='middle' font-family='ui-monospace,monospace' font-size='15' font-weight='700' fill='%2300e5c7'>vb</text></svg>"/>
<style>${CSS_TOKENS}${NAV_CSS}${extraCss}</style>
</head>
<body>
${renderNav(active)}
${budgetBanner(active)}
${body}
</body></html>`;
}
