import { streamTTFB } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";
import type { CallResult } from "../types.ts";

export const latency: Suite = {
  name: "latency",
  description:
    "Streaming TTFB + total latency on a short prompt. Trial passes if TTFB < 3s and total < 15s.",
  async runTrial(opts, index) {
    const res = await streamTTFB({
      model: opts.model,
      messages: [
        { role: "system", content: "Reply with one short sentence." },
        { role: "user", content: "Say hello." },
      ],
      timeoutMs: opts.timeoutMs,
      maxTokens: 64,
    });

    const call: CallResult = {
      ok: res.ok,
      latencyMs: res.totalMs,
      promptTokens: res.promptTokens,
      cachedTokens: res.cachedTokens,
      completionTokens: res.completionTokens,
      totalTokens: res.promptTokens + res.completionTokens,
      content: "",
      error: res.error,
    };

    const reasons: string[] = [];
    if (!res.ok) reasons.push(`api_error:${res.error}`);
    if (res.ttfbMs > 3000) reasons.push(`slow_ttfb_${Math.round(res.ttfbMs)}ms`);
    if (res.totalMs > 15000) reasons.push(`slow_total_${Math.round(res.totalMs)}ms`);

    const passed = res.ok && res.ttfbMs <= 3000 && res.totalMs <= 15000;
    return makeTrial(index, call, passed, reasons, {
      ttfb_ms: Math.round(res.ttfbMs),
      total_ms: Math.round(res.totalMs),
    });
  },
  computeMetrics(trials) {
    const ttfbs = trials
      .filter((t) => !!t.call.ok)
      .map((t) => Number(t.metrics.ttfb_ms) || 0)
      .sort((a, b) => a - b);
    const mean = ttfbs.length
      ? ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length
      : 0;
    const p95 = ttfbs.length
      ? ttfbs[Math.min(ttfbs.length - 1, Math.ceil(0.95 * ttfbs.length) - 1)]
      : 0;
    return {
      ttfb_mean_ms: Math.round(mean),
      ttfb_p95_ms: Math.round(p95),
    };
  },
};
