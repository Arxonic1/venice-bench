import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";
import { stripThinking } from "./utils.ts";

// "Exactly 3 bullets, exactly 12 words each." Massive variance between models.

function parseBullets(raw: string): string[] {
  const lines = stripThinking(raw)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines
    .map((l) => l.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
    .filter((l) => l.length > 0);
  return bullets;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export const outputLength: Suite = {
  name: "output-length",
  description:
    "Output length controllability. Asks for exactly 3 bullets × 12 words each. Measures bullet-count + word-count compliance.",
  async runTrial(opts, index) {
    const call = await chatCall({
      model: opts.model,
      messages: [
        {
          role: "system",
          content:
            "Follow length instructions exactly. Do not include a preamble, summary, or extra lines — output only the requested content.",
        },
        {
          role: "user",
          content:
            "Give me exactly 3 bullet points about the benefits of daily walking. Each bullet must contain EXACTLY 12 words. Use '-' as the bullet marker. No header, no footer, no extra text.",
        },
      ],
      timeoutMs: opts.timeoutMs,
      temperature: 0,
      maxTokens: 300,
    });

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);
    const bullets = parseBullets(call.content || "");
    const countOk = bullets.length === 3;
    if (!countOk) reasons.push(`bullet_count:${bullets.length}(expected:3)`);
    const wc = bullets.map(wordCount);
    const wordsExact = wc.filter((w) => w === 12).length;
    const wordsClose = wc.filter((w) => Math.abs(w - 12) <= 1).length; // ±1 tolerance

    const allExact = countOk && wordsExact === 3;
    const allClose = countOk && wordsClose === 3;
    if (!allExact) reasons.push(`word_counts:[${wc.join(",")}]`);

    const passed = !!call.ok && allExact;
    return makeTrial(index, call, passed, reasons, {
      bullets: bullets.length,
      exact_word_matches: wordsExact,
      close_word_matches: wordsClose,
      all_exact: allExact,
      within_one: allClose,
    });
  },
  computeMetrics(trials) {
    const total = trials.length || 1;
    return {
      exact_compliance_rate:
        trials.filter((t) => t.metrics.all_exact === true).length / total,
      within_one_rate:
        trials.filter((t) => t.metrics.within_one === true).length / total,
      avg_bullets: trials.reduce((a, t) => a + (Number(t.metrics.bullets) || 0), 0) / total,
    };
  },
};
