import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";

function makeHaystack(
  approxTokens: number,
  needle: string,
  depthPct: number,
): string {
  const filler =
    "The river wound slowly through the valley, past orchards heavy with late-season fruit and quiet hamlets whose names had drifted out of the atlas a generation ago. ";
  const wordsPerToken = 0.75;
  const targetWords = Math.floor(approxTokens * wordsPerToken);
  const fillerWords = filler.split(" ");
  const total: string[] = [];
  while (total.length < targetWords) total.push(...fillerWords);
  const trimmed = total.slice(0, targetWords);
  const insertAt = Math.floor(trimmed.length * depthPct);
  trimmed.splice(insertAt, 0, needle);
  return trimmed.join(" ");
}

// Six depths × three context-length rungs. We rotate over trials so
// a 30-run suite samples each depth evenly, cycling through context sizes.
// Formula: context = CONTEXT_RUNGS[floor(index / DEPTHS.length) % CONTEXT_RUNGS.length]
//          depth   = DEPTHS[index % DEPTHS.length]
// This means each rung gets a full depth sweep before advancing.
const DEPTHS = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95];
const CONTEXT_RUNGS = [16_000, 32_000, 64_000];

// Rotating needle pool — prevents pattern-matching shortcuts where the model
// recognises a fixed phrase rather than actually retrieving from context.
const NEEDLES: Array<{ text: string; answer: string }> = [
  { text: "The secret passphrase is BLUE-HARBOR-42.", answer: "BLUE-HARBOR-42" },
  { text: "The hidden codeword is SILVER-FALCON-7.", answer: "SILVER-FALCON-7" },
  { text: "The access token is RED-SUMMIT-19.", answer: "RED-SUMMIT-19" },
  { text: "The secret phrase is AMBER-CREEK-88.", answer: "AMBER-CREEK-88" },
  { text: "The vault keyword is GREEN-RIDGE-55.", answer: "GREEN-RIDGE-55" },
  { text: "The recovery word is IRON-PEAK-31.", answer: "IRON-PEAK-31" },
];

export const longContext: Suite = {
  name: "long-context",
  description:
    "Needle-in-haystack retrieval across 16k/32k/64k context sizes and 6 insertion depths. Rotates depth per trial and advances context rung every DEPTHS.length trials.",
  async runTrial(opts, index) {
    const context = CONTEXT_RUNGS[Math.floor(index / DEPTHS.length) % CONTEXT_RUNGS.length];
    const depth = DEPTHS[index % DEPTHS.length];
    const needle = NEEDLES[index % NEEDLES.length];
    const haystack = makeHaystack(context, needle.text, depth);
    const call = await chatCall({
      model: opts.model,
      messages: [
        {
          role: "system",
          content:
            "Answer with ONLY the secret value from the text, no prose, no quotes, no punctuation.",
        },
        {
          role: "user",
          content: `${haystack}\n\nQuestion: What is the secret value hidden in the text?`,
        },
      ],
      timeoutMs: Math.max(opts.timeoutMs, 180_000),
      temperature: 0,
      maxTokens: 32,
    });

    const reply = (call.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
    const hit = reply.toUpperCase().includes(needle.answer);

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);
    if (!hit) reasons.push(`needle_missed_depth_${Math.round(depth * 100)}pct`);

    return makeTrial(index, call, !!call.ok && hit, reasons, {
      depth_pct: Math.round(depth * 100),
      context_tokens: context,
      needle_idx: index % NEEDLES.length,
      hit,
    });
  },
  computeMetrics(trials) {
    // Per-rung × per-depth recall keys, e.g. recall_at_16k_depth_50pct
    const byRungDepth: Record<string, { hit: number; total: number }> = {};
    for (const t of trials) {
      const rung = String(t.metrics.context_tokens);
      const d = String(t.metrics.depth_pct);
      const key = `recall_at_${Number(rung) / 1000}k_depth_${d}pct`;
      byRungDepth[key] ??= { hit: 0, total: 0 };
      byRungDepth[key].total += 1;
      if (t.metrics.hit === true) byRungDepth[key].hit += 1;
    }
    const out: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(byRungDepth)) {
      out[k] = v.hit / (v.total || 1);
    }
    return out;
  },
};
