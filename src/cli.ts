import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import {
  BENCHMARK_MODEL,
  RESULTS_DIR,
  SUPABASE_ENABLED,
  assertEnv,
} from "./config.ts";
import {
  baselineExists,
  computeDeltas,
  loadBaseline,
  saveBaseline,
} from "./baseline.ts";
import { listModels } from "./venice.ts";
import { runSuite } from "./runner.ts";
import { ALL_SUITES, SUITES } from "./suites/index.ts";
import type { SuiteName, SuiteResult, RunOptions } from "./types.ts";
import { renderCompare, renderReport } from "./report.ts";
import { writeSuiteResult } from "./supabase.ts";
import { renderLoadReport, runLoad } from "./load.ts";
import { computeDrift, formatDrift } from "./drift.ts";
import { startServer } from "./serve.ts";
import { spawn } from "node:child_process";

const program = new Command();
program
  .name("venice-bench")
  .description("Benchmark Venice.ai models across tool-choice, JSON, reasoning, extraction, long-context, latency, and safety suites.")
  .version("0.1.0");

program
  .command("models")
  .description("List text models available from Venice /models (optional filter).")
  .option("--filter <substring>", "case-insensitive filter")
  .option("--json", "emit raw JSON")
  .action(async (opts) => {
    assertEnv();
    const models = await listModels();
    const filtered = opts.filter
      ? models.filter((m) =>
          m.id.toLowerCase().includes(String(opts.filter).toLowerCase()),
        )
      : models;
    if (opts.json) {
      console.log(JSON.stringify(filtered, null, 2));
      return;
    }
    const rows = filtered.map((m) => {
      const caps = m.model_spec?.capabilities ?? {};
      const flags = [
        caps.supportsFunctionCalling && "tools",
        caps.supportsReasoning && "reasoning",
        caps.supportsResponseSchema && "schema",
        caps.supportsVision && "vision",
        caps.supportsWebSearch && "web",
      ]
        .filter(Boolean)
        .join(",");
      const ctx = m.model_spec?.availableContextTokens;
      return `${m.id.padEnd(40)}  ${ctx ? `${ctx}t` : "".padEnd(8)}  ${flags}`;
    });
    console.log(`\n${filtered.length} text models\n`);
    console.log(rows.join("\n"));
  });

program
  .command("run")
  .description("Run one suite against one model.")
  .requiredOption("-s, --suite <name>", `one of: ${ALL_SUITES.join(", ")}`)
  .requiredOption("-m, --model <id>", "Venice model id")
  .option("-n, --runs <n>", "number of runs", "20")
  .option("-c, --concurrency <n>", "parallel requests", "3")
  .option("--timeout <ms>", "per-request timeout", "120000")
  .option("--run-id <id>", "custom run id")
  .action(async (opts) => {
    assertEnv();
    const suite = SUITES[opts.suite as SuiteName];
    if (!suite) throw new Error(`Unknown suite: ${opts.suite}`);
    const runId = opts.runId || makeRunId(opts.model, opts.suite);
    const runOpts: RunOptions = {
      model: opts.model,
      runs: Number(opts.runs),
      concurrency: Number(opts.concurrency),
      timeoutMs: Number(opts.timeout),
    };
    console.log(
      `\n▶ ${suite.name} · ${opts.model} · ${runOpts.runs} runs × ${runOpts.concurrency}\n`,
    );
    const result = await runSuite(suite, runOpts);
    await persist(runId, [result]);
    printSummaryLine(result);
  });

program
  .command("run-all")
  .description("Run every suite against one model and emit a combined report.")
  .requiredOption("-m, --model <id>", "Venice model id")
  .option("-n, --runs <n>", "runs per suite", "20")
  .option("-c, --concurrency <n>", "parallel requests", "3")
  .option("--timeout <ms>", "per-request timeout", "120000")
  .option("--skip <list>", "comma-separated suite names to skip")
  .option("--only <list>", "comma-separated suite names to run (all others skipped; takes precedence over --skip)")
  .action(async (opts) => {
    assertEnv();
    const skip = new Set(
      String(opts.skip ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const only = new Set(
      String(opts.only ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const runs = parseInt(opts.runs, 10);
    if (!Number.isFinite(runs) || runs < 1) {
      console.error(`Error: -n must be a positive integer, got: ${JSON.stringify(opts.runs)}`);
      process.exit(1);
    }
    const runId = makeRunId(opts.model, "all");
    const runOpts: RunOptions = {
      model: opts.model,
      runs,
      concurrency: Number(opts.concurrency),
      timeoutMs: Number(opts.timeout),
    };

    // capSkip: suites auto-skipped due to missing capabilities — scored as 0%.
    const capSkip = new Map<string, string>();

    // Preflight: print model capabilities so failures have context.
    try {
      const models = await listModels();
      const m = models.find((x) => x.id === opts.model);
      if (!m) {
        console.log(
          `\n⚠  model ${opts.model} not found in /models — running anyway`,
        );
      } else {
        const caps = m.model_spec?.capabilities ?? {};
        const flags = [
          caps.supportsFunctionCalling && "tools",
          caps.supportsReasoning && "reasoning",
          caps.supportsResponseSchema && "schema",
        ]
          .filter(Boolean)
          .join(", ") || "none";
        console.log(
          `\nPreflight: ${m.id} · ${m.model_spec?.availableContextTokens ?? "?"}t ctx · ${flags}`,
        );
        if (caps.supportsReasoning) {
          console.log(
            "  note: reasoning model — tool-choice suite will fall back to 'auto' since forced tool_choice is blocked in thinking mode.",
          );
        }
        if (!caps.supportsFunctionCalling) {
          console.log(
            "  note: no function-calling support — tool-choice will fail cleanly; consider --skip tool-choice.",
          );
        }

        // Capability-aware auto-skip: track reason per suite so we can emit
        // zeroed results (scoring 0%) rather than silently excluding them.
        if (caps.supportsFunctionCalling === false) {
          for (const s of ["tool-choice", "tool-ambiguity"] as const) {
            if (!capSkip.has(s)) {
              capSkip.set(s, "model does not support function calling");
              console.log(`  note: scoring ${s} as 0% (model does not support function calling)`);
            }
          }
        }
        if (caps.supportsResponseSchema === false) {
          for (const s of ["json-schema", "schema-hardness"] as const) {
            if (!capSkip.has(s)) {
              capSkip.set(s, "model does not support response schema");
              console.log(`  note: scoring ${s} as 0% (model does not support response schema)`);
            }
          }
        }
        if (caps.supportsVision === false) {
          if (!capSkip.has("vision")) {
            capSkip.set("vision", "model does not support vision");
            console.log(`  note: scoring vision as 0% (model does not support vision)`);
          }
        }
      }
    } catch (e: any) {
      console.log(`\n⚠  preflight failed: ${e?.message ?? e}`);
    }

    console.log(
      `\n▶ all suites · ${opts.model} · ${runOpts.runs} runs × ${runOpts.concurrency}\n`,
    );
    const results: SuiteResult[] = [];
    for (const name of ALL_SUITES) {
      // --only takes precedence: if provided, skip anything not in the list.
      if (only.size > 0 && !only.has(name)) {
        console.log(`  ⏭  skip ${name}`);
        continue;
      }
      if (only.size === 0 && skip.has(name)) {
        console.log(`  ⏭  skip ${name}`);
        continue;
      }
      // Capability-skipped: emit a zeroed result so it scores 0% in comparisons.
      const capReason = capSkip.get(name);
      if (capReason) {
        const now = new Date().toISOString();
        const zeroLatency = { mean: 0, median: 0, min: 0, max: 0, stdDev: 0, p90: 0, p95: 0, p99: 0 };
        const zeroTokens = { avgPrompt: 0, avgCached: 0, avgCompletion: 0, totalPrompt: 0, totalCached: 0, totalCompletion: 0, total: 0 };
        const zeroCost = { perRunUsd: 0, per1kRunsUsd: 0, perSuccessUsd: null, totalUsd: 0, breakdown: { inputUsd: 0, cachedUsd: 0, outputUsd: 0 } };
        results.push({
          suite: name,
          model: opts.model,
          startedAt: now,
          finishedAt: now,
          trials: [],
          skippedReason: capReason,
          summary: { runs: 0, passed: 0, failed: 0, passRate: 0, latency: zeroLatency, tokens: zeroTokens, cost: zeroCost, suiteMetrics: {} },
        });
        console.log(`  · ${name.padEnd(14)}   0.0%  (capability not supported)`);
        continue;
      }
      const suite = SUITES[name];
      process.stdout.write(`  · ${name.padEnd(14)} `);
      const r = await runSuite(suite, runOpts);
      results.push(r);
      console.log(
        `${(r.summary.passRate * 100).toFixed(1).padStart(5)}%  (${Math.round(r.summary.latency.mean)}ms avg)`,
      );
    }
    await persist(runId, results);
  });

program
  .command("list")
  .description("List all available run IDs from the results directory, sorted newest-first.")
  .action(() => {
    if (!fs.existsSync(RESULTS_DIR)) {
      console.log("No results directory found.");
      return;
    }
    const entries = fs
      .readdirSync(RESULTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const runId = d.name;
        const manifestPath = path.join(RESULTS_DIR, runId, "manifest.json");
        let model = "";
        let suiteCount: number | null = null;
        let isBaseline = false;
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            model = manifest.model ?? "";
            suiteCount = Array.isArray(manifest.suites) ? manifest.suites.length : null;
            isBaseline = runId.endsWith("_baseline");
          } catch {
            // ignore malformed manifests
          }
        }
        return { runId, model, suiteCount, isBaseline };
      })
      // Sort newest-first by run ID (ISO timestamp prefix sorts lexicographically)
      .sort((a, b) => b.runId.localeCompare(a.runId));

    if (entries.length === 0) {
      console.log("No runs found.");
      return;
    }

    for (const { runId, model, suiteCount, isBaseline } of entries) {
      const modelCol = model.padEnd(36);
      const countCol = isBaseline
        ? "(baseline)"
        : suiteCount !== null
          ? `${suiteCount} suite${suiteCount === 1 ? "" : "s"}`
          : "";
      console.log(`${runId.padEnd(60)}  ${modelCol}  ${countCol}`);
    }
  });

program
  .command("load")
  .description("Concurrency-ladder load test — sweep parallel request levels and report throughput, P95/P99 latency, and error rate per tier.")
  .requiredOption("-m, --model <id>", "Venice model id")
  .option("--tiers <list>", "comma-separated concurrency levels", "1,5,10,20")
  .option("-r, --requests <n>", "requests per tier", "30")
  .option("--timeout <ms>", "per-request timeout", "120000")
  .action(async (opts) => {
    assertEnv();
    const tiers = String(opts.tiers)
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => n > 0);
    const runId = makeRunId(opts.model, "load");
    console.log(
      `\n▶ load · ${opts.model} · tiers [${tiers.join(", ")}] · ${opts.requests} req/tier\n`,
    );
    const result = await runLoad({
      model: opts.model,
      tiers,
      requestsPerTier: Number(opts.requests),
      timeoutMs: Number(opts.timeout),
    });
    for (const t of result.tiers) {
      console.log(
        `  c=${String(t.concurrency).padStart(3)}  ${t.successCount}/${t.requests} ok  ${t.throughputPerSec.toFixed(2)} req/s  mean=${Math.round(t.latency.mean)}ms  p95=${Math.round(t.latency.p95)}ms`,
      );
    }
    const dir = path.join(RESULTS_DIR, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "load.json"),
      JSON.stringify(result, null, 2),
    );
    const html = renderLoadReport(runId, result);
    const htmlPath = path.join(dir, "report.html");
    fs.writeFileSync(htmlPath, html);
    console.log(`\n✔ ${htmlPath}`);
  });

program
  .command("drift")
  .description("Flag suites whose latest pass rate moved ≥ threshold vs median of prior runs (requires Supabase).")
  .option("-m, --model <id>", "restrict to one model")
  .option("--days <n>", "lookback window in days", "7")
  .option("--threshold <pp>", "pp delta to flag", "10")
  .action(async (opts) => {
    if (!SUPABASE_ENABLED) {
      console.error(
        "drift requires Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.",
      );
      process.exit(1);
    }
    const driftOpts = {
      model: opts.model as string | undefined,
      days: Number(opts.days),
      thresholdPct: Number(opts.threshold),
    };
    const rows = await computeDrift(driftOpts);
    console.log(
      `\n▶ drift · last ${driftOpts.days}d · threshold ±${driftOpts.thresholdPct}pp${driftOpts.model ? ` · model=${driftOpts.model}` : ""}\n`,
    );
    console.log(formatDrift(rows, driftOpts));
    const flagged = rows.filter((r) => r.flagged);
    console.log(
      `\n${flagged.length} flagged / ${rows.length} comparable suite-model pairs.`,
    );
  });

program
  .command("baseline")
  .description(
    `Manage the benchmark baseline (default model: ${BENCHMARK_MODEL}). Every run-all against a different model auto-renders deltas vs this baseline.`,
  )
  .option("--refresh", "re-run all suites against the benchmark model and overwrite the cached baseline")
  .option("-m, --model <id>", "override BENCHMARK_MODEL for this refresh")
  .option("-n, --runs <n>", "runs per suite", "20")
  .option("-c, --concurrency <n>", "parallel requests", "3")
  .option("--timeout <ms>", "per-request timeout", "120000")
  .action(async (opts) => {
    if (!opts.refresh) {
      const current = loadBaseline();
      if (!current) {
        console.log(
          `\nNo baseline cached.\n  Benchmark model: ${BENCHMARK_MODEL}\n  Refresh with:    venice-bench baseline --refresh\n`,
        );
        process.exit(1);
      }
      console.log(`\nBaseline model : ${current.model}`);
      console.log(`Captured       : ${current.capturedAt}`);
      console.log(`Suites         :\n`);
      for (const r of current.results) {
        console.log(
          `  ${r.suite.padEnd(14)}  ${(r.summary.passRate * 100).toFixed(1).padStart(5)}%  ${Math.round(r.summary.latency.mean)}ms avg  ${r.summary.tokens.total.toLocaleString()} tokens`,
        );
      }
      return;
    }
    assertEnv();
    const model = (opts.model as string) || BENCHMARK_MODEL;
    const runOpts: RunOptions = {
      model,
      runs: Number(opts.runs),
      concurrency: Number(opts.concurrency),
      timeoutMs: Number(opts.timeout),
    };
    console.log(
      `\n▶ refreshing baseline · ${model} · ${runOpts.runs} runs × ${runOpts.concurrency}${baselineExists() ? " (overwriting existing)" : ""}\n`,
    );
    const results: SuiteResult[] = [];
    for (const name of ALL_SUITES) {
      const suite = SUITES[name];
      process.stdout.write(`  · ${name.padEnd(14)} `);
      const r = await runSuite(suite, runOpts);
      results.push(r);
      console.log(
        `${(r.summary.passRate * 100).toFixed(1).padStart(5)}%  (${Math.round(r.summary.latency.mean)}ms avg)`,
      );
    }
    saveBaseline(results);
    // Also persist to the normal results dir for traceability — skip
    // self-referential baseline deltas here.
    const runId = makeRunId(model, "baseline");
    await persist(runId, results, { skipBaseline: true });
    console.log(`\n✔ baseline cached (${model})`);
  });

program
  .command("serve")
  .description("Start a local dashboard serving every run at a single URL (index + per-run reports + cost rollups).")
  .option("-p, --port <n>", "port", "4321")
  .option("--open", "open the dashboard in your browser")
  .action(async (opts) => {
    const port = Number(opts.port);
    const server = startServer(port);
    const url = `http://localhost:${port}`;
    console.log(`\n✔ venice-bench dashboard\n  ${url}\n\n  results dir: ${RESULTS_DIR}\n  stop with Ctrl-C\n`);
    if (opts.open) {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    }
    // Keep process alive until interrupted
    process.on("SIGINT", () => {
      server.close();
      console.log("\n  stopped.");
      process.exit(0);
    });
  });

program
  .command("compare <runIds...>")
  .description("Render a side-by-side HTML comparison of two or more runs.")
  .action(async (runIds: string[]) => {
    const resultsByRun: Record<string, SuiteResult[]> = {};
    for (const id of runIds) {
      const dir = path.join(RESULTS_DIR, id);
      if (!fs.existsSync(dir)) throw new Error(`No results dir: ${dir}`);
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json") && f !== "manifest.json");
      resultsByRun[id] = files.map(
        (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SuiteResult,
      );
    }
    const html = renderCompare(runIds, resultsByRun);
    const out = path.join(RESULTS_DIR, `compare-${Date.now()}.html`);
    fs.writeFileSync(out, html);
    console.log(`\n✔ ${out}`);
  });

program
  .command("report <runId>")
  .description("Re-render the HTML report for an existing run.")
  .action(async (runId: string) => {
    const dir = path.join(RESULTS_DIR, runId);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && f !== "manifest.json");
    const results = files.map(
      (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SuiteResult,
    );
    const html = renderReport(runId, results);
    const out = path.join(dir, "report.html");
    fs.writeFileSync(out, html);
    console.log(`\n✔ ${out}`);
  });

async function persist(
  runId: string,
  results: SuiteResult[],
  opts: { skipBaseline?: boolean } = {},
) {
  const dir = path.join(RESULTS_DIR, runId);
  fs.mkdirSync(dir, { recursive: true });

  // Per-suite JSON (machine-readable, full fidelity)
  for (const r of results) {
    fs.writeFileSync(
      path.join(dir, `${r.suite}.json`),
      JSON.stringify(r, null, 2),
    );
    // Raw JSONL trials for easy grepping
    const jsonl = r.trials
      .map((t) =>
        JSON.stringify({
          suite: r.suite,
          model: r.model,
          index: t.index,
          passed: t.passed,
          reasons: t.reasons,
          latency_ms: t.call.latencyMs,
          prompt_tokens: t.call.promptTokens,
          completion_tokens: t.call.completionTokens,
          metrics: t.metrics,
          error: t.call.error,
          content: t.call.content?.slice(0, 500),
        }),
      )
      .join("\n");
    fs.writeFileSync(path.join(dir, `${r.suite}.jsonl`), jsonl);
  }

  // Manifest
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        runId,
        model: results[0]?.model,
        createdAt: new Date().toISOString(),
        suites: results.map((r) => r.suite),
      },
      null,
      2,
    ),
  );

  // Baseline deltas auto-attach when target ≠ baseline model
  const targetModel = results[0]?.model ?? "";
  const baseline = opts.skipBaseline ? null : loadBaseline();
  const baselineCtx =
    baseline && baseline.model !== targetModel
      ? {
          model: baseline.model,
          capturedAt: baseline.capturedAt,
          deltas: computeDeltas(results, baseline.results),
        }
      : undefined;

  // Human-readable HTML (this is the copy Daniel eyeballs)
  const html = renderReport(runId, results, baselineCtx);
  const htmlPath = path.join(dir, "report.html");
  fs.writeFileSync(htmlPath, html);

  // Supabase (optional, for drift tracking)
  if (SUPABASE_ENABLED) {
    for (const r of results) await writeSuiteResult(runId, r);
  }

  console.log(`\n✔ results → ${dir}`);
  console.log(`  report  → ${htmlPath}`);
  if (SUPABASE_ENABLED) console.log(`  supabase → venice_bench_results (runId=${runId})`);
  if (baselineCtx) {
    const flagged = baselineCtx.deltas.filter(
      (d) => Math.abs(d.passRateDeltaPp) >= 5,
    );
    console.log(
      `  baseline → ${baselineCtx.model} (${flagged.length} suite(s) moved ≥5pp vs baseline)`,
    );
  }
}

function printSummaryLine(r: SuiteResult) {
  console.log(
    `  ${r.suite}: ${(r.summary.passRate * 100).toFixed(1)}% pass · ${Math.round(r.summary.latency.mean)}ms avg · ${r.summary.tokens.total.toLocaleString()} tokens`,
  );
}

function makeRunId(model: string, suite: string): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const slug = model.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `${ts}_${slug}_${suite}`;
}

program.parseAsync(process.argv).catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
