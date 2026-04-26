import type { Suite } from "../runner.ts";
import type { SuiteName } from "../types.ts";
import { toolChoice } from "./tool-choice.ts";
import { jsonSchema } from "./json-schema.ts";
import { thinkingTag } from "./thinking-tag.ts";
import { extraction } from "./extraction.ts";
import { longContext } from "./long-context.ts";
import { latency } from "./latency.ts";
import { safety } from "./safety.ts";
import { promptCache } from "./prompt-cache.ts";
import { schemaHardness } from "./schema-hardness.ts";
import { multiTurn } from "./multi-turn.ts";
import { refusalCalibration } from "./refusal-calibration.ts";
import { toolAmbiguity } from "./tool-ambiguity.ts";
import { outputLength } from "./output-length.ts";
import { vision } from "./vision.ts";
import { podcastTriage } from "./podcast-triage.ts";
import { podcastAnalysis } from "./podcast-analysis.ts";

export const SUITES: Record<SuiteName, Suite> = {
  "tool-choice": toolChoice,
  "json-schema": jsonSchema,
  "thinking-tag": thinkingTag,
  extraction,
  "long-context": longContext,
  latency,
  safety,
  "prompt-cache": promptCache,
  "schema-hardness": schemaHardness,
  "multi-turn": multiTurn,
  "refusal-calibration": refusalCalibration,
  "tool-ambiguity": toolAmbiguity,
  "output-length": outputLength,
  vision,
  "podcast-triage": podcastTriage,
  "podcast-analysis": podcastAnalysis,
};

export const ALL_SUITES: SuiteName[] = [
  "tool-choice",
  "json-schema",
  "thinking-tag",
  "extraction",
  "long-context",
  "latency",
  "safety",
  "prompt-cache",
  "schema-hardness",
  "multi-turn",
  "refusal-calibration",
  "tool-ambiguity",
  "output-length",
  "vision",
  "podcast-triage",
  // "podcast-analysis" excluded from run-all — run separately: run -s podcast-analysis -m <model> -n 10
];
