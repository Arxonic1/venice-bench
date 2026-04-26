import Ajv from "ajv";
import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";
import { stripThinking, extractJson } from "./utils.ts";

const ajv = new Ajv({ allErrors: true, strict: false });

// Four tiers of schema hardness. Trials rotate through them so a 20-run suite
// samples each tier 5 times.
const TIERS: { name: string; schema: Record<string, unknown>; prompt: string }[] = [
  {
    name: "flat",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "integer" },
        title: { type: "string" },
        published: { type: "boolean" },
      },
      required: ["id", "title", "published"],
    },
    prompt: "Return a JSON object describing a blog post with id=42, title=Hello, published=true.",
  },
  {
    name: "nested",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        user: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            address: {
              type: "object",
              additionalProperties: false,
              properties: {
                city: { type: "string" },
                zip: { type: "string", pattern: "^[0-9]{5}$" },
              },
              required: ["city", "zip"],
            },
          },
          required: ["name", "address"],
        },
      },
      required: ["user"],
    },
    prompt: "Return a JSON object for a user named Alex, address city=Portland, zip=97201.",
  },
  {
    name: "unions",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        payload: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: { kind: { const: "text" }, text: { type: "string" } },
              required: ["kind", "text"],
            },
            {
              type: "object",
              additionalProperties: false,
              properties: { kind: { const: "number" }, value: { type: "number" } },
              required: ["kind", "value"],
            },
          ],
        },
      },
      required: ["id", "payload"],
    },
    prompt:
      "Return a JSON object with id=\"e1\" and payload of kind=\"number\" with value=3.14. Use the number variant only.",
  },
  {
    name: "recursive",
    schema: {
      $defs: {
        node: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            children: {
              type: "array",
              items: { $ref: "#/$defs/node" },
            },
          },
          required: ["name"],
        },
      },
      $ref: "#/$defs/node",
    },
    prompt:
      "Return a JSON tree: root node name=\"A\", children=[name=\"B\" (no children), name=\"C\" with one child name=\"D\"].",
  },
];

export const schemaHardness: Suite = {
  name: "schema-hardness",
  description:
    "Schema-hardness ramp. Rotates across 4 tiers: flat → nested → unions → recursive. Pass rate per tier shows where a model cracks.",
  async runTrial(opts, index) {
    const tier = TIERS[index % TIERS.length];
    const validate = ajv.compile(tier.schema);
    const call = await chatCall({
      model: opts.model,
      messages: [
        { role: "system", content: "Return ONLY a JSON object matching the given schema. No prose." },
        { role: "user", content: `Schema:\n${JSON.stringify(tier.schema)}\n\n${tier.prompt}` },
      ],
      responseFormat: { type: "json_object" },
      timeoutMs: opts.timeoutMs,
      temperature: 0,
      maxTokens: 500,
    });

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);
    const obj = extractJson(call.content || "");
    const parseOk = obj !== null;
    const valid = parseOk ? !!validate(obj) : false;
    if (!parseOk) reasons.push("json_parse_failed");
    if (parseOk && !valid)
      reasons.push(
        `schema_violations:${(validate.errors ?? []).slice(0, 3).map((e) => (e.instancePath || "/") + " " + e.message).join("|")}`,
      );

    const passed = !!call.ok && parseOk && valid;
    return makeTrial(index, call, passed, reasons, {
      tier: tier.name,
      parse_ok: parseOk,
      schema_valid: valid,
    });
  },
  computeMetrics(trials) {
    const byTier: Record<string, { pass: number; total: number }> = {};
    for (const t of trials) {
      const tier = String(t.metrics.tier);
      byTier[tier] ??= { pass: 0, total: 0 };
      byTier[tier].total += 1;
      if (t.passed) byTier[tier].pass += 1;
    }
    const out: Record<string, number | string> = {};
    for (const [tier, v] of Object.entries(byTier)) {
      out[`${tier}_pass_rate`] = v.pass / (v.total || 1);
    }
    return out;
  },
};
