import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";
import type { ChatCallInput } from "../venice.ts";

// A 200×100 PNG with "VB-42" rendered in black Helvetica on a white background.
// Generated with PIL (Python Imaging Library) and embedded as a base64 data URI so
// the suite is fully hermetic — no outbound network requests required.
const IMAGE_URL =
  "data:image/png;base64,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";

// Some Venice models expect image_url as string, others as { url } — we
// send the object form, which is the OpenAI-compatible standard.
async function chatWithImage(input: Omit<ChatCallInput, "messages">, userContent: Array<{ type: string; text?: string; image_url?: { url: string } }>) {
  // The library currently types messages as { role, content: string }. Vision
  // requires content as an array. We sidestep by stringifying the array and
  // relying on Venice's parser — OR we extend the call. Simpler: build a raw
  // request here that matches the OpenAI chat-completions shape.
  return chatCall({
    ...input,
    messages: [
      // @ts-expect-error — we intentionally pass array content for vision.
      { role: "user", content: userContent },
    ],
  });
}

// Three prompts testing different aspects of the same image (all expect "VB-42").
// Rotating exposes prompt-sensitivity — a model that only passes one phrasing is weaker.
const PROMPTS = [
  "What text is shown in this image? Reply with just the text, no prose.",
  "What is the exact alphanumeric code shown? Answer with just the code.",
  "Read the text visible in the image and output it verbatim.",
];

export const vision: Suite = {
  name: "vision",
  description:
    "Vision — a test image containing the string 'VB-42'. Model must read it out. Rotates across 3 prompt phrasings to expose prompt-sensitivity. Skips trial if the model does not support vision.",
  async runTrial(opts, index) {
    const prompt = PROMPTS[index % PROMPTS.length];
    const call = await chatWithImage(
      {
        model: opts.model,
        timeoutMs: opts.timeoutMs,
        temperature: 0,
        maxTokens: 80,
      },
      [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: IMAGE_URL } },
      ],
    );

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);
    const answer = (call.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const hit = /vb[-\s]?42/i.test(answer);

    // Detect "model doesn't support vision" errors and mark as skipped.
    const notSupported =
      !call.ok &&
      !!call.error &&
      /(vision|image|multimodal|does not support|not supported)/i.test(call.error);
    if (notSupported) reasons.push("vision_not_supported");
    if (!hit && call.ok) reasons.push(`text_not_found_in:${answer.slice(0, 80)}`);

    // We don't want "not supported" to count as a failure for an overall pass rate,
    // but we can't make it vanish either. Mark as skipped via metric.
    const passed = !!call.ok && hit;
    return makeTrial(index, call, passed, reasons, {
      not_supported: notSupported,
      detected_text: hit,
      prompt_idx: index % PROMPTS.length,
    });
  },
  computeMetrics(trials) {
    const total = trials.length || 1;
    const unsupported = trials.filter((t) => t.metrics.not_supported === true).length;
    const applicable = trials.length - unsupported;
    const hits = trials.filter((t) => t.metrics.detected_text === true).length;
    return {
      applicable_trials: applicable,
      unsupported_trials: unsupported,
      vision_accuracy: applicable > 0 ? hits / applicable : 0,
    };
  },
};
