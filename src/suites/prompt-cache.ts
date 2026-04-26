import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";

// A long-ish prefix (~3k tokens) shared across every trial. If the model
// supports prompt caching, we expect usage.cached_tokens to grow on calls 2+.
const PREFIX_REPEATS = 60;
const PREFIX_UNIT =
  "The analysis protocol mandates that each decision be traced to a specific evidence line with a timestamp, an actor, and a quantified impact bound. Deviations from this pattern are treated as soft failures and logged into the anomaly register for weekly review. ";

function longPrefix(): string {
  return Array(PREFIX_REPEATS).fill(PREFIX_UNIT).join("");
}

export const promptCache: Suite = {
  name: "prompt-cache",
  description:
    "Prompt-cache effectiveness. Sends the same ~3k-token prefix N times and measures cached_tokens growth. Also tracks effective cost reduction.",
  async runTrial(opts, index) {
    const prefix = longPrefix();
    const call = await chatCall({
      model: opts.model,
      messages: [
        {
          role: "system",
          content: prefix,
        },
        {
          role: "user",
          content: `Question ${index}: In one sentence, what is the purpose of the anomaly register described above?`,
        },
      ],
      timeoutMs: opts.timeoutMs,
      temperature: 0,
      maxTokens: 120,
    });

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);
    const cached = call.cachedTokens;
    const prompt = call.promptTokens;
    const cachedPct = prompt > 0 ? cached / prompt : 0;

    // Trial 0 is the warmup — its purpose is to seed the cache, so a cache hit
    // is impossible and expected. Counting it as passed would inflate passRate by
    // 1/n. Instead we pass warmup only if the API call succeeded (the prefix was
    // accepted), and we track it separately via is_warmup so computeMetrics can
    // exclude it from cache_hit_rate.
    const isWarmup = index === 0;
    const hit = cachedPct >= 0.5;
    if (!call.ok) {
      return makeTrial(index, call, false, reasons, {
        cached_pct: cachedPct,
        is_warmup: isWarmup,
        cache_hit: false,
      });
    }
    // Warmup passes if API responded OK (cache hit is irrelevant on first call).
    // Non-warmup passes only if cache hit rate is meaningful (≥ 50%).
    const passed = isWarmup ? true : hit;
    if (!isWarmup && !hit) reasons.push(`low_cache_hit:${(cachedPct * 100).toFixed(1)}%`);
    return makeTrial(index, call, passed, reasons, {
      cached_pct: cachedPct,
      is_warmup: isWarmup,
      cache_hit: hit,
    });
  },
  computeMetrics(trials) {
    const postWarmup = trials.filter((t) => t.metrics.is_warmup !== true);
    const meanCached = postWarmup.reduce(
      (a, t) => a + (Number(t.metrics.cached_pct) || 0),
      0,
    ) / Math.max(postWarmup.length, 1);
    const hitRate = postWarmup.filter((t) => t.metrics.cache_hit === true).length /
      Math.max(postWarmup.length, 1);
    return {
      avg_cached_pct: meanCached,
      cache_hit_rate: hitRate,
      warmup_trials: trials.filter((t) => t.metrics.is_warmup === true).length,
    };
  },
};
