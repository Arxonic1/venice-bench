// Snapshot the live dashboard to a static `dist/` for Vercel.
// Renders the 8 main pages, materializes /api/trial/* JSONs, and copies results/ → dist/run/.

import fs from "node:fs";
import path from "node:path";
import { RESULTS_DIR, ROOT } from "./config.ts";
import { renderDashboard } from "./render/dashboard.ts";
import { renderMatrix } from "./render/matrix.ts";
import { renderRadar } from "./render/radar.ts";
import { renderPareto } from "./render/pareto.ts";
import { renderModels } from "./render/models.ts";
import { renderTrends } from "./render/trends.ts";
import { renderInspect } from "./render/inspect.ts";
import { renderBaselinePage } from "./serve.ts";
import { invalidateCache } from "./render/shared.ts";
const DIST = path.join(ROOT, "dist");

function write(rel: string, body: string): void {
  const full = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

async function main(): Promise<void> {
  if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });
  invalidateCache();

  console.log("rendering pages...");
  write("index.html", renderDashboard());
  write("matrix.html", renderMatrix());
  write("pareto.html", renderPareto());
  write("radar.html", renderRadar([]));
  write("trends.html", renderTrends());
  write("inspect.html", renderInspect());
  write("models.html", await renderModels());
  write("baseline.html", renderBaselinePage());

  console.log(`copying results/ → dist/run/...`);
  copyDir(RESULTS_DIR, path.join(DIST, "run"));

  const fileCount = (function count(dir: string): number {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      n += e.isDirectory() ? count(path.join(dir, e.name)) : 1;
    }
    return n;
  })(DIST);
  console.log(`done — 8 pages + results mirror, ${fileCount} files, dist at ${DIST}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
