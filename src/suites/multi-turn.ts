import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";
import { stripThinking, extractJson } from "./utils.ts";

// 4-turn conversation that tests back-reference memory.
// Expected final answer: "42" (echoing the number from turn 1) + "Paris" (from turn 2).
const TURNS = [
  { role: "user", content: "Remember this number: 42." },
  { role: "assistant", content: "Noted — 42." },
  { role: "user", content: "And this city: Paris." },
  { role: "assistant", content: "Noted — Paris." },
  { role: "user", content: "Please list three colors of the rainbow." },
  { role: "assistant", content: "Red, green, blue." },
  {
    role: "user",
    content:
      'Now output ONLY a JSON object: {"number": <the number I gave you>, "city": <the city I gave you>}. No prose.',
  },
];

export const multiTurn: Suite = {
  name: "multi-turn",
  description:
    "Multi-turn coherence. A 4-turn conversation with back-references to turns 1 and 2. Tests memory across turns + final structured output.",
  async runTrial(opts, index) {
    const call = await chatCall({
      model: opts.model,
      messages: TURNS.map((t) => ({ role: t.role, content: t.content })),
      timeoutMs: opts.timeoutMs,
      temperature: 0,
      responseFormat: { type: "json_object" },
      maxTokens: 120,
    });

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);
    const obj = extractJson(call.content || "") as Record<string, unknown> | null;
    if (!obj) reasons.push("no_valid_json");

    const numberOk = Number(obj?.number) === 42;
    const cityOk = typeof obj?.city === "string" && /paris/i.test(obj.city as string);
    if (!numberOk) reasons.push("wrong_number");
    if (!cityOk) reasons.push("wrong_city");

    const passed = !!call.ok && !!obj && numberOk && cityOk;
    return makeTrial(index, call, passed, reasons, {
      number_ok: numberOk,
      city_ok: cityOk,
    });
  },
  computeMetrics(trials) {
    const total = trials.length || 1;
    return {
      number_recall_rate: trials.filter((t) => t.metrics.number_ok === true).length / total,
      city_recall_rate: trials.filter((t) => t.metrics.city_ok === true).length / total,
    };
  },
};
