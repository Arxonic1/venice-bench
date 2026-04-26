import Ajv from "ajv";
import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";

const ajv = new Ajv({ allErrors: true, strict: false });

// Lookup tables — trial.index % length picks the values for each run.
const NAMES = ["Alex", "Jordan", "Maria", "Priya", "Chen", "Fatima", "Lucas"];
const AGES = [28, 35, 42, 19, 55, 31, 67];
// Tiers must stay within the schema enum. "free"/"pro"/"enterprise" rotate 3-way.
const TIERS: Array<"free" | "pro" | "enterprise"> = [
  "free",
  "pro",
  "enterprise",
  "free",
  "pro",
  "enterprise",
  "free",
];

// Every other trial (even index) requires email; odd trials omit it.
function buildSchema(requireEmail: boolean) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      age: { type: "integer", minimum: 0, maximum: 130 },
      email: { type: "string", pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
      interests: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 5,
      },
      tier: { type: "string", enum: ["free", "pro", "enterprise"] },
    },
    required: requireEmail
      ? ["name", "age", "email", "interests", "tier"]
      : ["name", "age", "interests", "tier"],
  } as const;
}

function stripThinking(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJson(raw: string): string | null {
  const cleaned = stripThinking(raw);
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) return cleaned.slice(first, last + 1);
  return null;
}

export const jsonSchema: Suite = {
  name: "json-schema",
  description:
    "Strict JSON schema conformance — all required fields present, correct types, enum adherence, no extras. Seed values rotate per trial to prevent memorisation.",
  async runTrial(opts, index) {
    const name = NAMES[index % NAMES.length];
    const age = AGES[index % AGES.length];
    const tier = TIERS[index % TIERS.length];
    const requireEmail = index % 2 === 0;
    const schema = buildSchema(requireEmail);
    const validate = ajv.compile(schema);

    const emailInstruction = requireEmail
      ? `Include a plausible email address for them.`
      : `Do NOT include an email field — it is not in the required fields for this schema.`;

    const call = await chatCall({
      model: opts.model,
      messages: [
        {
          role: "system",
          content:
            "Return ONLY a single JSON object matching the given schema. No prose, no markdown fences, no commentary.",
        },
        {
          role: "user",
          content:
            `Generate a fake user profile with fields:\n${JSON.stringify(schema, null, 2)}\n\n` +
            `The user's name is exactly "${name}", age is exactly ${age}, and tier is exactly "${tier}". ` +
            emailInstruction,
        },
      ],
      responseFormat: { type: "json_object" },
      timeoutMs: opts.timeoutMs,
      temperature: 0,
    });

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);
    const jsonText = extractJson(call.content || "");
    let parsed: unknown = null;
    let parseOk = false;
    if (jsonText) {
      try {
        parsed = JSON.parse(jsonText);
        parseOk = true;
      } catch {
        reasons.push("json_parse_failed");
      }
    } else {
      reasons.push("no_json_found");
    }

    const valid = parseOk && validate(parsed);
    if (!valid && parseOk)
      reasons.push(
        `schema_violations:${(validate.errors ?? []).map((e) => e.instancePath + " " + e.message).join("|")}`,
      );

    // Check that the returned values match what was explicitly requested.
    let valuesMatch = false;
    if (parseOk && parsed !== null && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const nameOk = obj["name"] === name;
      const ageOk = obj["age"] === age;
      const tierOk = obj["tier"] === tier;
      valuesMatch = nameOk && ageOk && tierOk;
      if (!nameOk) reasons.push(`name_mismatch:got=${String(obj["name"])},expected=${name}`);
      if (!ageOk) reasons.push(`age_mismatch:got=${String(obj["age"])},expected=${age}`);
      if (!tierOk) reasons.push(`tier_mismatch:got=${String(obj["tier"])},expected=${tier}`);
    }

    const passed = call.ok && parseOk && !!valid && valuesMatch;
    return makeTrial(index, call, passed, reasons, {
      parse_ok: parseOk,
      schema_valid: !!valid,
      values_match: valuesMatch,
    });
  },
  computeMetrics(trials) {
    const total = trials.length || 1;
    return {
      parse_rate: trials.filter((t) => t.metrics.parse_ok === true).length / total,
      schema_valid_rate:
        trials.filter((t) => t.metrics.schema_valid === true).length / total,
      values_match_rate:
        trials.filter((t) => t.metrics.values_match === true).length / total,
    };
  },
};
