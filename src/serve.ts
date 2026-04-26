import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { RESULTS_DIR } from "./config.ts";
import { loadBaseline } from "./baseline.ts";
import type { SuiteResult } from "./types.ts";
import { renderDashboard } from "./render/dashboard.ts";
import { renderMatrix } from "./render/matrix.ts";
import { renderRadar } from "./render/radar.ts";
import { renderPareto } from "./render/pareto.ts";
import { renderModels } from "./render/models.ts";
import { renderTrends } from "./render/trends.ts";
import { renderInspect } from "./render/inspect.ts";
import { renderCompare as renderCompareReport } from "./report.ts";
import {
  escape,
  fmtDateTime,
  fmtPct,
  htmlDoc,
  invalidateCache,
} from "./render/shared.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function send(res: http.ServerResponse, status: number, body: string, type = "text/html; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, obj: unknown) {
  send(res, status, JSON.stringify(obj), "application/json");
}

function readRunSuite(runId: string, suite: string): SuiteResult | null {
  const f = path.join(RESULTS_DIR, runId, `${suite}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as SuiteResult;
  } catch {
    return null;
  }
}

function renderBaselinePage(): string {
  const baseline = loadBaseline();
  if (!baseline) {
    const body = `<section class="panel" style="border:1px solid var(--line);border-radius:14px;padding:20px;background:linear-gradient(180deg,rgba(255,255,255,0.02),rgba(0,0,0,0));">
      <h2 style="color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:1.4px;font-weight:500;margin:0 0 12px;">No baseline cached</h2>
      <p style="color:var(--fg);">Refresh to set the benchmark model:</p>
      <p><code>./bin/venice-bench.mjs baseline --refresh</code></p>
    </section>`;
    return htmlDoc("venice-bench · baseline", "baseline", body);
  }
  const rows = baseline.results
    .map((r) => `<tr><td style="font-family:ui-monospace,monospace;padding:6px 10px;">${escape(r.suite)}</td>
      <td style="text-align:right;padding:6px 10px;color:var(--accent-2);font-family:ui-monospace,monospace;">${fmtPct(r.summary.passRate)}</td>
      <td style="text-align:right;padding:6px 10px;font-family:ui-monospace,monospace;color:var(--muted);">${Math.round(r.summary.latency.mean)}ms avg</td>
      <td style="text-align:right;padding:6px 10px;font-family:ui-monospace,monospace;color:var(--muted);">${r.summary.tokens.total.toLocaleString()} tok</td></tr>`)
    .join("");
  const body = `<section class="panel" style="border:1px solid var(--line);border-radius:14px;padding:20px;background:linear-gradient(180deg,rgba(93,255,154,0.05),rgba(0,0,0,0));">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;">
      <div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;">Baseline model</div>
        <div style="font-size:20px;color:var(--accent-2);font-family:ui-monospace,monospace;margin-top:4px;">${escape(baseline.model)}</div>
      </div>
      <div style="font-size:11px;color:var(--muted);font-family:ui-monospace,monospace;">captured ${escape(fmtDateTime(baseline.capturedAt))}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr><th style="text-align:left;padding:6px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--line);">Suite</th>
        <th style="text-align:right;padding:6px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--line);">Pass</th>
        <th style="text-align:right;padding:6px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--line);">Latency</th>
        <th style="text-align:right;padding:6px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--line);">Tokens</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:var(--muted);font-size:12px;margin-top:14px;">
      Refresh: <code>./bin/venice-bench.mjs baseline --refresh</code>
    </p>
  </section>`;
  return htmlDoc("venice-bench · baseline", "baseline", body);
}

export function startServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", `http://localhost:${port}`);
    const p = decodeURIComponent(u.pathname);

    try {
      // Bust the in-memory cache on every request so new runs appear immediately.
      invalidateCache();

      if (p === "/" || p === "/index.html") return send(res, 200, renderDashboard());
      if (p === "/matrix") return send(res, 200, renderMatrix());
      if (p === "/pareto") return send(res, 200, renderPareto());
      if (p === "/models") {
        renderModels().then((html) => send(res, 200, html)).catch((e) => send(res, 500, String(e)));
        return;
      }
      if (p === "/radar") {
        const m = u.searchParams.get("models");
        const sel = m ? m.split(",").map((s) => s.trim()).filter(Boolean) : [];
        return send(res, 200, renderRadar(sel));
      }
      if (p === "/baseline") return send(res, 200, renderBaselinePage());
      if (p === "/trends") return send(res, 200, renderTrends());
      if (p === "/inspect") return send(res, 200, renderInspect());

      // /compare?runs=id1,id2,...
      if (p === "/compare") {
        const param = u.searchParams.get("runs");
        if (!param) return send(res, 400, "missing ?runs=id1,id2");
        const runIds = param.split(",").map((s) => s.trim()).filter(Boolean);
        const map: Record<string, SuiteResult[]> = {};
        for (const id of runIds) {
          const dir = path.join(RESULTS_DIR, id);
          if (!fs.existsSync(dir)) continue;
          const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "manifest.json");
          map[id] = files
            .map((f) => {
              try {
                return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SuiteResult;
              } catch {
                return null;
              }
            })
            .filter((r): r is SuiteResult => !!r);
        }
        return send(res, 200, renderCompareReport(runIds, map));
      }

      // /api/trial/<runId>/<suite>/<index>  → single trial detail (JSON)
      const trialMatch = p.match(/^\/api\/trial\/([^/]+)\/([^/]+)\/(\d+)$/);
      if (trialMatch) {
        const [, runId, suite, idx] = trialMatch;
        const r = readRunSuite(runId, suite);
        if (!r) return sendJson(res, 404, { error: "run/suite not found" });
        const t = r.trials[Number(idx)];
        if (!t) return sendJson(res, 404, { error: "trial index out of range" });
        return sendJson(res, 200, {
          index: t.index,
          passed: t.passed,
          reasons: t.reasons,
          metrics: t.metrics,
          latency_ms: t.call.latencyMs,
          prompt_tokens: t.call.promptTokens ?? 0,
          cached_tokens: t.call.cachedTokens ?? 0,
          completion_tokens: t.call.completionTokens ?? 0,
          finish_reason: t.call.finishReason ?? null,
          error: t.call.error ?? null,
          tool_calls: t.call.toolCalls ?? null,
          content: t.call.content ?? "",
        });
      }

      // /run/<id>/<...path> → static from results/<id>/<path>
      const runMatch = p.match(/^\/run\/([^/]+)(\/.*)?$/);
      if (runMatch) {
        const runId = runMatch[1];
        const rest = runMatch[2] || "/";
        const target = path.join(RESULTS_DIR, runId, rest);
        const normalized = path.normalize(target);
        const base = path.normalize(path.join(RESULTS_DIR, runId));
        if (!normalized.startsWith(base)) return send(res, 403, "forbidden");
        if (!fs.existsSync(normalized)) return send(res, 404, "not found");
        const stat = fs.statSync(normalized);
        if (stat.isDirectory()) {
          const indexFile = path.join(normalized, "report.html");
          if (fs.existsSync(indexFile)) {
            res.writeHead(302, { Location: `/run/${runId}/report.html` });
            res.end();
            return;
          }
          const files = fs.readdirSync(normalized).sort();
          const links = files
            .map((f) => `<li><a href="/run/${encodeURIComponent(runId)}/${encodeURIComponent(f)}">${escape(f)}</a></li>`)
            .join("");
          return send(
            res, 200,
            htmlDoc(
              `files · ${runId}`,
              "dashboard",
              `<div class="panel" style="border:1px solid var(--line);border-radius:14px;padding:20px;"><h2 style="color:var(--accent-2);font-family:ui-monospace,monospace;">${escape(runId)}</h2><ul>${links}</ul></div>`,
            ),
          );
        }
        const ext = path.extname(normalized).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME[ext] ?? "application/octet-stream",
          "Cache-Control": "no-store",
        });
        fs.createReadStream(normalized).pipe(res);
        return;
      }

      send(res, 404, "not found");
    } catch (err: any) {
      send(res, 500, `<pre style="color:#ff6b6b;padding:20px;font-family:ui-monospace,monospace;">${escape(err?.stack ?? err?.message ?? String(err))}</pre>`);
    }
  });

  server.listen(port);
  return server;
}
