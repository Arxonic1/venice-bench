import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "set_travel_dates",
      description: "Record the user's intended travel start and end dates.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "YYYY-MM-DD" },
          end_date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["start_date", "end_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_destination",
      description: "Set the travel destination city.",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_budget",
      description: "Record traveler's budget in USD.",
      parameters: {
        type: "object",
        properties: { amount_usd: { type: "number" } },
        required: ["amount_usd"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_travelers",
      description: "Record the number of adults and children traveling.",
      parameters: {
        type: "object",
        properties: {
          adults: { type: "integer" },
          children: { type: "integer" },
        },
        required: ["adults"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_accommodation",
      description: "Record preferred accommodation type.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["hotel", "hostel", "apartment", "resort"] },
        },
        required: ["type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_transport",
      description: "Record preferred transport mode between cities.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["flight", "train", "bus", "car"] },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_interests",
      description: "Record traveler interests.",
      parameters: {
        type: "object",
        properties: {
          interests: { type: "array", items: { type: "string" } },
        },
        required: ["interests"],
      },
    },
  },
];

const USER_PROMPT =
  "I'm planning a trip starting 2026-06-10 and returning 2026-06-24. Please record these dates.";

export const toolChoice: Suite = {
  name: "tool-choice",
  description:
    "Forced tool-choice stress test. Measures: tool-call rate, JSON validity, content leakage alongside tool_calls.",
  async runTrial(opts, index) {
    const baseArgs = {
      model: opts.model,
      messages: [
        {
          role: "system",
          content:
            "You are a travel-planning assistant. Use the provided tools to record user preferences. Do not write any prose when calling a tool.",
        },
        { role: "user", content: USER_PROMPT },
      ],
      tools: TOOLS,
      timeoutMs: opts.timeoutMs,
    };

    let mode: "forced" | "auto" = "forced";
    let call = await chatCall({
      ...baseArgs,
      toolChoice: { type: "function", function: { name: "set_travel_dates" } },
    });

    // Thinking/reasoning models reject forced tool_choice — fall back to auto.
    const thinkingReject =
      !call.ok &&
      !!call.error &&
      (/thinking mode/i.test(call.error) ||
        /does not support.*tool_choice/i.test(call.error) ||
        /tool_choice.*(required|object)/i.test(call.error));
    if (thinkingReject) {
      mode = "auto";
      call = await chatCall({ ...baseArgs, toolChoice: "auto" });
    }

    const reasons: string[] = [];
    const tc = call.toolCalls?.[0];
    const calledRight = tc?.name === "set_travel_dates";
    const jsonValid = !!tc && typeof tc.args === "object" && tc.args !== null;
    const leaked = !!call.content && call.content.trim().length > 0;
    const schemaOk =
      jsonValid &&
      typeof (tc!.args as any)?.start_date === "string" &&
      typeof (tc!.args as any)?.end_date === "string";

    if (!call.ok) reasons.push(`api_error:${call.error}`);
    if (!calledRight) reasons.push("wrong_tool_or_none");
    if (!jsonValid) reasons.push("invalid_json_args");
    if (!schemaOk) reasons.push("schema_mismatch");
    if (leaked) reasons.push("content_leaked_alongside_tool");

    // In auto mode we don't penalize missing content (it's allowed).
    const effectiveLeaked = mode === "forced" && leaked;
    const passed = call.ok && calledRight && jsonValid && schemaOk && !effectiveLeaked;
    return makeTrial(index, call, passed, reasons, {
      tool_called: tc?.name ?? "",
      json_valid: jsonValid,
      leaked,
      schema_ok: schemaOk,
      mode,
    });
  },
  computeMetrics(trials) {
    const total = trials.length || 1;
    const toolCallRate =
      trials.filter((t) => !!t.metrics.tool_called).length / total;
    const jsonValidRate =
      trials.filter((t) => t.metrics.json_valid === true).length / total;
    const leakRate =
      trials.filter((t) => t.metrics.leaked === true).length / total;
    const autoFallback =
      trials.filter((t) => t.metrics.mode === "auto").length / total;
    return {
      tool_call_rate: toolCallRate,
      json_valid_rate: jsonValidRate,
      content_leak_rate: leakRate,
      auto_fallback_rate: autoFallback,
    };
  },
};
