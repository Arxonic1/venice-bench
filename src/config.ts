import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pricing } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const RESULTS_DIR = path.join(ROOT, "results");
export const DATA_DIR = path.join(ROOT, "data");
export const BASELINE_DIR = path.join(RESULTS_DIR, "_baseline");

export const BENCHMARK_MODEL =
  process.env.BENCHMARK_MODEL ?? "claude-opus-4-7";

export const MONTHLY_BUDGET_USD = process.env.MONTHLY_BUDGET_USD
  ? Number(process.env.MONTHLY_BUDGET_USD)
  : null;

export const VENICE_API_KEY = process.env.VENICE_API_KEY ?? "";
export const VENICE_BASE_URL =
  process.env.VENICE_BASE_URL ?? "https://api.venice.ai/api/v1";

export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
export const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);

let _pricingCache: Record<string, Pricing> | null = null;

export function loadPricing(): Record<string, Pricing> {
  if (_pricingCache) return _pricingCache;
  const file = path.join(DATA_DIR, "pricing.json");
  if (!fs.existsSync(file)) return {};
  try {
    _pricingCache = JSON.parse(fs.readFileSync(file, "utf8"));
    return _pricingCache!;
  } catch {
    return {};
  }
}

export function pricingFor(model: string): Pricing | null {
  const map = loadPricing();
  return map[model] ?? null;
}

export function assertEnv() {
  if (!VENICE_API_KEY) {
    throw new Error(
      "VENICE_API_KEY is required. Copy .env.example to .env and fill it in.",
    );
  }
}
