import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";

// Two plausibly-correct tools. The user request semantically maps to one —
// but a naive model that just matches keywords will pick the wrong one.
const TOOLS = [
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description: "Add an event to the user's calendar. Use when the user wants to schedule or block out time on a date.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          start: { type: "string", description: "ISO-8601 datetime" },
          end: { type: "string", description: "ISO-8601 datetime" },
        },
        required: ["title", "start", "end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description: "Create a one-time reminder that pings the user at a given time. Use when the user wants a notification nudge rather than a time-blocked calendar entry.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
          at: { type: "string", description: "ISO-8601 datetime" },
        },
        required: ["message", "at"],
      },
    },
  },
];

// Alternating prompts — each trial rotates through both correct answers so
// the suite doesn't accidentally pass by always picking the same tool.
const PROMPTS: { text: string; expected: "create_calendar_event" | "set_reminder" }[] = [
  { text: "Block out 2026-06-10 from 14:00 to 15:30 for a dentist appointment.", expected: "create_calendar_event" },
  { text: "Remind me to call Maria tomorrow at 9:30 am.", expected: "set_reminder" },
  { text: "I need to put my annual review meeting on Friday from 10 to 11.", expected: "create_calendar_event" },
  { text: "Ping me at 18:00 today to take the chicken out of the freezer.", expected: "set_reminder" },
];

export const toolAmbiguity: Suite = {
  name: "tool-ambiguity",
  description:
    "Tool disambiguation. Two plausibly-correct tools; one is right. Rotates across 4 prompts (2 of each). Tests reasoning, not JSON formatting.",
  async runTrial(opts, index) {
    const p = PROMPTS[index % PROMPTS.length];
    const baseArgs = {
      model: opts.model,
      messages: [
        {
          role: "system",
          content:
            "You have two tools available: create_calendar_event (for blocking out time in a calendar) and set_reminder (for a one-time notification nudge). Pick the more appropriate tool for the user's request.",
        },
        { role: "user", content: p.text },
      ],
      tools: TOOLS,
      timeoutMs: opts.timeoutMs,
    };

    // Try forced = auto (we want the model to choose). Reasoning models often reject forced "required".
    let call = await chatCall({ ...baseArgs, toolChoice: "auto" });
    // If the model ignored tools and returned text, try forcing "required" — some
    // non-reasoning Venice models only emit tool_calls under explicit pressure.
    if (!call.toolCalls?.length && call.ok) {
      const retry = await chatCall({ ...baseArgs, toolChoice: "required" });
      if (retry.toolCalls?.length) call = retry;
    }

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);
    const tc = call.toolCalls?.[0];
    const tool = tc?.name ?? "";
    const rightTool = tool === p.expected;
    if (!tool) reasons.push("no_tool_called");
    else if (!rightTool) reasons.push(`wrong_tool:${tool}(expected:${p.expected})`);

    return makeTrial(index, call, !!call.ok && rightTool, reasons, {
      expected: p.expected,
      chosen: tool,
      right_tool: rightTool,
    });
  },
  computeMetrics(trials) {
    const total = trials.length || 1;
    const calEvents = trials.filter((t) => t.metrics.expected === "create_calendar_event");
    const reminders = trials.filter((t) => t.metrics.expected === "set_reminder");
    return {
      overall_right_rate: trials.filter((t) => t.metrics.right_tool === true).length / total,
      calendar_accuracy:
        calEvents.length > 0
          ? calEvents.filter((t) => t.metrics.right_tool === true).length / calEvents.length
          : 0,
      reminder_accuracy:
        reminders.length > 0
          ? reminders.filter((t) => t.metrics.right_tool === true).length / reminders.length
          : 0,
    };
  },
};
