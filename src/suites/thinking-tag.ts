import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";
import { stripThinking } from "./utils.ts";

const PROBLEM_POOL: Array<{ question: string; answer: number }> = [
  {
    question:
      "A train leaves at 14:05 and arrives at 17:40. How many minutes is the journey?",
    answer: 215,
  },
  {
    question: "What is 17.5% of 240?",
    answer: 42,
  },
  {
    question:
      "A car travels at 65 mph for 2.5 hours. How many feet did it travel? (1 mile = 5280 feet)",
    answer: 858000,
  },
  {
    question:
      "How many days are there from March 15 to July 4 (inclusive of July 4, exclusive of March 15)?",
    answer: 111,
  },
  {
    question:
      "£1000 is invested at 4% annual interest, compounded annually, for 3 years. What is the final amount in pence (i.e. rounded to the nearest penny, expressed as an integer number of pence)?",
    // £1000 × 1.04^3 = £1124.864... → £1124.86 → 112486 pence
    answer: 112486,
  },
  {
    question: "Convert -40°C to Fahrenheit.",
    answer: -40,
  },
];

export const thinkingTag: Suite = {
  name: "thinking-tag",
  description:
    "Reasoning correctness + optional tag hygiene. Model must produce a correct numeric answer. If the model uses <think> tags, they must be balanced and stripped cleanly — tag presence is not mandatory (models that skip tags but answer correctly still pass). hygiene_rate measures how often models that do use tags handle them correctly.",
  async runTrial(opts, index) {
    const problem = PROBLEM_POOL[index % PROBLEM_POOL.length];

    const call = await chatCall({
      model: opts.model,
      messages: [
        {
          role: "system",
          content:
            "Think step by step, then return ONLY a JSON object: {\"answer\": <number>}.",
        },
        {
          role: "user",
          content: problem.question,
        },
      ],
      timeoutMs: opts.timeoutMs,
      temperature: 0,
    });

    const raw = call.content || "";
    const openTags = (raw.match(/<think>/gi) || []).length;
    const closeTags = (raw.match(/<\/think>/gi) || []).length;
    const usesThink = openTags > 0 || closeTags > 0;
    const balanced = openTags === closeTags;

    const stripped = stripThinking(raw);
    const residualThink = /<\/?think>/i.test(stripped);
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);

    let parseOk = false;
    let answerCorrect = false;
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        parseOk = true;
        answerCorrect = Number(obj.answer) === problem.answer;
      } catch {
        /* noop */
      }
    }

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);
    if (!usesThink) reasons.push("no_think_tags");
    if (usesThink && !balanced) reasons.push("unbalanced_think_tags");
    if (residualThink) reasons.push("residual_think_tag_after_strip");
    if (!parseOk) reasons.push("final_json_unparseable");
    if (!answerCorrect) reasons.push("wrong_answer");

    // usesThink is optional: models that don't emit <think> tags but answer
    // correctly still pass. If a model does use tags, they must be balanced and
    // not bleed into the stripped answer — that's the hygiene check.
    const passed =
      call.ok &&
      parseOk &&
      answerCorrect &&
      (!usesThink || (balanced && !residualThink));

    return makeTrial(index, call, passed, reasons, {
      uses_think: usesThink,
      balanced,
      residual_think: residualThink,
      parse_ok: parseOk,
      answer_correct: answerCorrect,
      problem_index: index % PROBLEM_POOL.length,
    });
  },
  computeMetrics(trials) {
    const total = trials.length || 1;
    const usingThink = trials.filter((t) => t.metrics.uses_think === true);
    // hygiene_rate: among trials that used <think> tags, fraction where tags
    // were balanced AND no residual tags bled into the stripped answer.
    const hygieneOk = usingThink.filter(
      (t) => t.metrics.balanced === true && t.metrics.residual_think !== true,
    ).length;
    return {
      think_adoption_rate: usingThink.length / total,
      balanced_rate:
        usingThink.length > 0
          ? usingThink.filter((t) => t.metrics.balanced === true).length /
            usingThink.length
          : 1,
      hygiene_rate: usingThink.length > 0 ? hygieneOk / usingThink.length : 1,
      answer_accuracy:
        trials.filter((t) => t.metrics.answer_correct === true).length / total,
    };
  },
};
