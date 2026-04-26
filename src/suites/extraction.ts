import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";
import { stripThinking, extractJson } from "./utils.ts";

interface Gold {
  speaker: string;
  org: string;
  frameworks: string[];
  rollback_multiplier: [number, number];
}

interface DocEntry {
  doc: string;
  gold: Gold;
}

// Pool of 5 synthetic documents with the same shape but different names,
// orgs, frameworks, and numeric ranges — prevents trivial pass from training
// memorisation of any single fixture.
const DOC_POOL: DocEntry[] = [
  {
    doc: `At TechVerse 2025, keynote speaker Maya Okonkwo (CTO, Relay Robotics) announced
three frameworks for deploying autonomous agents in warehouses:
1) The RACE loop — Reconnoitre, Act, Correct, Evaluate — a four-step control
   cycle that replaces traditional sense-plan-act pipelines.
2) Capability Laddering — progressively grant agents new skills only after they
   pass behavioural audits on the prior rung.
3) Dark-Launch Playbook — ship new agent policies behind a shadow deployment
   that mirrors live traffic but has no write access for 14 days.
Okonkwo emphasized that organizations skipping step (2) typically see a 3–5x
increase in rollback events during the first quarter of deployment.`.trim(),
    gold: {
      speaker: "Maya Okonkwo",
      org: "Relay Robotics",
      frameworks: ["RACE loop", "Capability Laddering", "Dark-Launch Playbook"],
      rollback_multiplier: [3, 5],
    },
  },
  {
    doc: `At DataOps Summit 2024, principal engineer Soren Lindqvist (VP Engineering, NordStream Analytics)
presented three frameworks for scaling real-time data pipelines:
1) The FLOW protocol — Fetch, Linearise, Observe, Write — a four-phase ingestion
   cycle designed for sub-second latency at petabyte scale.
2) Schema Graduation — promote data contracts to production only after they survive
   a 7-day shadow-validation window on live event streams.
3) Blast-Radius Banding — partition pipeline topology into concentric failure zones
   so a single stream outage affects at most 12% of downstream consumers.
Lindqvist noted that teams skipping Schema Graduation typically see a 2–4x
increase in downstream data-quality incidents within the first month.`.trim(),
    gold: {
      speaker: "Soren Lindqvist",
      org: "NordStream Analytics",
      frameworks: ["FLOW protocol", "Schema Graduation", "Blast-Radius Banding"],
      rollback_multiplier: [2, 4],
    },
  },
  {
    doc: `At FinScale 2026, risk architect Priya Menon (Chief Risk Officer, Tessera Capital)
outlined three frameworks for managing algorithmic trading risk:
1) The ALERT cycle — Assess, Limit, Execute, Review, Tune — a five-stage loop
   for continuous position-size governance.
2) Circuit-Breaker Laddering — escalate trading halts through three tiers only
   after quantified drawdown thresholds are breached in sequence.
3) Shadow Book Protocol — run every new strategy in a paper-trading shadow book
   for 30 days before granting live capital allocation.
Menon warned that firms bypassing Circuit-Breaker Laddering see a 6–10x
amplification of peak drawdown during stressed market conditions.`.trim(),
    gold: {
      speaker: "Priya Menon",
      org: "Tessera Capital",
      frameworks: ["ALERT cycle", "Circuit-Breaker Laddering", "Shadow Book Protocol"],
      rollback_multiplier: [6, 10],
    },
  },
  {
    doc: `At CloudArch Global 2025, infrastructure lead Tomás Varga (Director of Platform, Helios Cloud)
described three frameworks for zero-downtime Kubernetes migrations:
1) The SHIFT matrix — Snapshot, Hydrate, Instrument, Failover, Teardown — a five-step
   migration playbook that eliminates maintenance windows.
2) Traffic Ratcheting — increment canary traffic in 10% steps gated by automated
   SLO checks before advancing to the next rung.
3) Rollback Covenant — a signed operational contract requiring one-command rollback
   capability to be verified before any production cutover is approved.
Varga reported that organisations omitting Traffic Ratcheting experience a 4–7x
increase in post-migration P1 incidents.`.trim(),
    gold: {
      speaker: "Tomás Varga",
      org: "Helios Cloud",
      frameworks: ["SHIFT matrix", "Traffic Ratcheting", "Rollback Covenant"],
      rollback_multiplier: [4, 7],
    },
  },
  {
    doc: `At MLOps World 2025, head of ML platform Amara Osei (Principal Scientist, Vantage AI)
introduced three frameworks for safe large-model deployments:
1) The SCOPE loop — Sample, Calibrate, Observe, Patch, Evaluate — a five-phase
   model-lifecycle loop replacing ad-hoc post-deployment monitoring.
2) Confidence Banding — route model outputs through human review tiers based on
   calibrated uncertainty scores before surfacing to end-users.
3) Red-Team Cadence — mandate adversarial testing sprints every 21 days throughout
   a model's production lifetime, not only at launch.
Osei noted that teams skipping Confidence Banding see a 5–8x increase in
high-severity user-facing errors during the first two quarters post-launch.`.trim(),
    gold: {
      speaker: "Amara Osei",
      org: "Vantage AI",
      frameworks: ["SCOPE loop", "Confidence Banding", "Red-Team Cadence"],
      rollback_multiplier: [5, 8],
    },
  },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function fuzzyIncludes(haystack: string[], needle: string): boolean {
  const n = normalize(needle);
  return haystack.some((h) => {
    const nh = normalize(h);
    return nh === n || nh.includes(n) || n.includes(nh);
  });
}

export const extraction: Suite = {
  name: "extraction",
  description:
    "Faithful extraction from a short synthetic document: speaker, org, named frameworks, and a numeric range. Checks recall against a gold set and flags fabricated frameworks.",
  async runTrial(opts, index) {
    const entry = DOC_POOL[index % DOC_POOL.length];
    const pool = entry.doc;
    const gold = entry.gold;

    const call = await chatCall({
      model: opts.model,
      messages: [
        {
          role: "system",
          content:
            "Extract structured information from the document. Only extract facts explicitly stated in the document. Return JSON only.",
        },
        {
          role: "user",
          content:
            `Document:\n${pool}\n\n` +
            "Return JSON with keys: speaker (string), org (string), frameworks (array of framework names exactly as named), rollback_multiplier_low (number), rollback_multiplier_high (number).",
        },
      ],
      responseFormat: { type: "json_object" },
      timeoutMs: opts.timeoutMs,
      temperature: 0,
    });

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);
    const obj = extractJson(call.content || "") as Record<string, unknown> | null;
    if (!obj) reasons.push("no_valid_json");

    const speakerOk = obj?.speaker && normalize(String(obj.speaker)).includes(normalize(gold.speaker));
    const orgOk = obj?.org && normalize(String(obj.org)).includes(normalize(gold.org).split(" ")[0]);

    const gotFrameworks: string[] = Array.isArray(obj?.frameworks) ? (obj.frameworks as string[]) : [];
    const recall =
      gold.frameworks.filter((g) => fuzzyIncludes(gotFrameworks, g)).length /
      gold.frameworks.length;
    const fabricated = gotFrameworks.filter(
      (g) => !fuzzyIncludes(gold.frameworks, g),
    ).length;

    const lowOk = Number(obj?.rollback_multiplier_low) === gold.rollback_multiplier[0];
    const highOk = Number(obj?.rollback_multiplier_high) === gold.rollback_multiplier[1];

    if (!speakerOk) reasons.push("missing_or_wrong_speaker");
    if (!orgOk) reasons.push("missing_or_wrong_org");
    if (recall < 1) reasons.push(`framework_recall:${recall.toFixed(2)}`);
    if (fabricated > 0) reasons.push(`fabricated_frameworks:${fabricated}`);
    if (!lowOk || !highOk) reasons.push("numeric_range_wrong");

    const passed =
      !!call.ok &&
      !!obj &&
      !!speakerOk &&
      !!orgOk &&
      recall === 1 &&
      fabricated === 0 &&
      lowOk &&
      highOk;

    return makeTrial(index, call, passed, reasons, {
      speaker_ok: !!speakerOk,
      org_ok: !!orgOk,
      framework_recall: recall,
      fabricated_count: fabricated,
      range_ok: lowOk && highOk,
    });
  },
  computeMetrics(trials) {
    const total = trials.length || 1;
    const recalls = trials
      .map((t) => Number(t.metrics.framework_recall) || 0)
      .reduce((a, b) => a + b, 0);
    const fabs = trials
      .map((t) => Number(t.metrics.fabricated_count) || 0)
      .reduce((a, b) => a + b, 0);
    return {
      avg_framework_recall: recalls / total,
      avg_fabricated_per_run: fabs / total,
      range_accuracy:
        trials.filter((t) => t.metrics.range_ok === true).length / total,
    };
  },
};
