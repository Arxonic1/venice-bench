import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";

interface AnalysisGold {
  modeApplied: string;
  minSectionsPresent: number;
  minSignalsCaptured: number;
  portfolioActionPresent: boolean;
}

interface AnalysisCase {
  mode: string;
  transcript: string;
  plantedSignals: string[];
  expectedAssetDirection: Record<string, string>;
  gold: AnalysisGold;
  decoyCheck?: string;
}

const ANALYSIS_CASES: AnalysisCase[] = [
  // Case 0 — Translation Layer: enterprise CTO, privacy/centralization complaints
  {
    mode: "Translation Layer",
    transcript: `[00:04:22] We're running into serious problems with our current AI vendor stack. Every prompt we send to OpenAI or Anthropic passes through their servers — that means customer data is exposed. Three Fortune 100 clients told us they cannot use our product because of this exact compliance issue.

[00:08:15] The compute concentration problem is real and underappreciated. Right now, roughly 80% of enterprise AI inference runs through AWS, Google, or OpenAI. That is not a resilient supply chain. We saw what happened when OpenAI had that March outage — it cascaded across hundreds of enterprise products simultaneously.

[00:12:30] What the market actually needs is a marketplace model for inference — where you can route to any provider based on privacy requirements, latency, and cost. Similar to what happened with cloud: enterprises don't use a single cloud provider anymore. They use multi-cloud routing.

[00:18:45] The technical roadmap honestly points toward verifiable compute. If you can cryptographically prove a computation occurred without exposing the underlying data, that solves our entire compliance problem. We are actively piloting three vendors working on this right now.`,
    plantedSignals: [
      "customer data exposed on centralized AI vendors",
      "80% compute concentration on AWS/Google/OpenAI",
      "inference marketplace model needed",
      "verifiable compute solves compliance",
    ],
    expectedAssetDirection: { VVV: "bullish", TAO: "neutral", BTC: "neutral", ETH: "neutral" },
    gold: {
      modeApplied: "Translation Layer",
      minSectionsPresent: 5,
      minSignalsCaptured: 3,
      portfolioActionPresent: true,
    },
  },
  // Case 1 — Pure Signal: macro economist with hard data
  {
    mode: "Pure Signal",
    transcript: `[00:02:11] Core CPI came in at 3.2% for March. That is the third consecutive month above target. Our model assigns 71% probability to no rate cuts in 2025 and a 23% probability of one additional hike.

[00:09:33] BTC 90-day correlation with the Nasdaq is currently 0.78. That is near the 2022 peak correlation level. Any tech-driven equity selloff will likely transmit directly to crypto at that correlation.

[00:14:20] M2 money supply is expanding again after the 2022-23 contraction. Historical data shows a 12 to 18 month lag between M2 expansion and crypto market cap movement. We are now 8 months into the current M2 expansion.

[00:21:05] On-chain data shows 76% of BTC supply held by long-term holders — near all-time high. Short-term holder cost basis sits at approximately $58,000. Current spot price is $84,000. That spread suggests limited forced selling pressure.`,
    plantedSignals: [
      "71% probability no rate cuts 2025",
      "BTC-Nasdaq correlation 0.78",
      "M2 expansion 8 months in with 12-18 month lag",
      "76% long-term holder supply near all-time high",
    ],
    expectedAssetDirection: { BTC: "mixed", ETH: "risk", TAO: "neutral", VVV: "neutral" },
    gold: {
      modeApplied: "Pure Signal",
      minSectionsPresent: 5,
      minSignalsCaptured: 3,
      portfolioActionPresent: true,
    },
  },
  // Case 2 — Crypto-Native: Venice/VVV directly discussed
  {
    mode: "Crypto-Native",
    transcript: `[00:05:15] Venice just announced enterprise contracts with two undisclosed Fortune 500 companies using their private inference API. The CEO indicated revenue guidance for 2026 was revised upward by 40% from initial projections.

[00:11:30] The staking economics are interesting. Current VVV staking yield is running at 23% APY. The DIEM mint rate for locked stakers is approximately 0.8 DIEM per staked VVV per month. At current DIEM prices that represents an additional 12% annualized yield on top of VVV staking rewards.

[00:17:45] Competition is intensifying. Nous Research just closed a $50 million raise specifically to build a competing uncensored inference marketplace. Their token launch is targeting Q3 2026. This is a direct competitive threat to Venice's positioning.

[00:23:10] Bittensor subnet yield compression is a concern. Average subnet APY has declined from approximately 40% to 18% over the past 12 months as new capital entered. The core question is whether subnet utility growth can outpace that yield compression trend.`,
    plantedSignals: [
      "Venice Fortune 500 enterprise contracts",
      "DIEM mint rate 0.8 per month plus 23% VVV staking yield",
      "Nous Research $50M raise competing marketplace",
      "TAO subnet yield compression from 40% to 18%",
    ],
    expectedAssetDirection: { VVV: "bullish", DIEM: "accumulate", TAO: "monitor", ETH: "neutral" },
    gold: {
      modeApplied: "Crypto-Native",
      minSectionsPresent: 5,
      minSignalsCaptured: 3,
      portfolioActionPresent: true,
    },
  },
  // Case 3 — Translation Layer, long noisy transcript (~1800 words)
  // DECOY: Bitcoin mention at [00:07:04] — Elena says hospitals don't hold Bitcoin.
  // A good model should NOT trigger a BTC portfolio action from this.
  {
    mode: "Translation Layer",
    transcript: `[00:01:14] HOST: Welcome back. Today I've got Elena Marchetti, Chief Data Officer at Meridian Health, one of the largest hospital networks in the country — 47 hospitals, about $8 billion in annual revenue. Elena, thanks for coming on.

[00:01:28] ELENA: Happy to be here. Big fan of the show, been listening since episode 12.

[00:01:33] HOST: That's amazing. So let's start with the basics — what does a CDO actually do day to day at a health system your size?

[00:01:41] ELENA: Yeah so the title is a bit misleading. I'm less "chief data officer" in the traditional BI sense and more chief data governance officer honestly. My team owns the policies for how data moves across 47 hospitals, who can access what, how long we retain it, what we share with vendors. It's as much legal and compliance as it is technical.

[00:02:18] HOST: And how has AI changed that job over the last two years?

[00:02:23] ELENA: Dramatically. And not in the way people expected. The narrative was "AI is going to make healthcare more efficient." And sure, maybe. But what AI actually did to my job is create a completely new category of data governance problem that didn't exist before.

[00:02:41] HOST: Can you give a concrete example?

[00:02:44] ELENA: Sure. We piloted a clinical documentation AI — basically it listens to the doctor-patient conversation and writes the note. Sounds great in a demo. But when I looked at the vendor contract, patient audio was being transmitted to their cloud for processing. That audio includes the patient's name, date of birth, the physician's name, the diagnosis — it's a HIPAA nightmare. We had to kill the pilot.

[00:03:19] HOST: How common is that?

[00:03:21] ELENA: Every single AI vendor we evaluated had this problem. Every one. The processing happens on their infrastructure. The data leaves our network. In healthcare that's not a "we'll figure it out later" issue — that's a $50,000-per-violation problem under HIPAA. We had the general counsel in the room for every AI vendor meeting in 2025.

[00:04:02] HOST: So what's the solution? Just don't use AI?

[00:04:06] ELENA: No, we need AI. The documentation burden on physicians is unsustainable — I've seen data that doctors spend 40% of their time on admin. We cannot afford to not use AI. The solution has to be AI that processes locally or through some mechanism where we can verify the data never left our custody.

[00:04:31] HOST: Interesting. Let me shift gears for a second — what about your team structure? How many people report to you?

[00:04:38] ELENA: So I have three direct reports — a VP of Data Engineering, a VP of Data Governance, and a Chief Privacy Officer who's technically a dotted line. Total org is about 140 people. We're actually hiring right now if anyone listening is interested. [laughs]

[00:05:01] HOST: We'll put the jobs page in the show notes. So back to AI — you mentioned "verifiable data never left our custody." What does that actually look like technically?

[00:05:12] ELENA: This is where it gets interesting. We've been in discussions with three vendors — I won't name them publicly yet — who are building inference infrastructure where computation happens in what they call a "confidential enclave." The claim is that even the vendor cannot access the plaintext data during processing. It's processed in an encrypted state.

[00:05:38] HOST: Is that real? Or is that marketing?

[00:05:40] ELENA: [laughs] Both, depending on the vendor. One of them has been audited by a third party and the audit report is public. That one we're taking seriously. The other two are still "trust us." The cryptographic proof concept is real — there's published academic work on it — but the implementations vary wildly in maturity.

[00:06:14] HOST: What's the procurement timeline if one of these passes your security review?

[00:06:18] ELENA: Healthcare procurement is notoriously slow. Realistically 18 to 24 months from "vendor passes our security review" to "system is live in all 47 hospitals." But I will tell you — the pressure is coming from the C-suite. Our CEO is watching physician burnout numbers, and documentation burden is the number one complaint in every physician survey we run. When the CEO is asking about timeline, procurement moves faster.

[00:06:58] HOST: Let me ask you something slightly different — what about Bitcoin? Do hospitals hold Bitcoin on their balance sheet?

[00:07:04] ELENA: [laughs] Not that I'm aware of, no. My CFO would have a heart attack. We have an investment policy that's pretty conservative — Treasuries, some money markets. I think there's a world where hospital endowments eventually have some crypto exposure but that's a 10-year conversation, not today.

[00:07:28] HOST: Fair enough. Back to data governance — you mentioned the "data never leaves our custody" requirement. Is that specific to healthcare or are you hearing this from peers at other industries?

[00:07:39] ELENA: It's healthcare, financial services, defense contractors, government. Anyone with regulated data or significant liability exposure. I'm on an industry working group with peers from JPMorgan, Lockheed, and two large law firms. We all have the same problem statement: we need AI inference that is verifiable, auditable, and does not require trusting a third-party cloud with sensitive data.

[00:08:14] HOST: That's a big market.

[00:08:16] ELENA: It's a massive market. Healthcare alone is a $4 trillion industry. If you solve this problem correctly, you own the AI contract for every HIPAA-covered entity in the United States. I've told vendors this directly. The company that cracks this — genuinely cracks it, not marketing-cracks it — has a very large business.

[00:08:47] HOST: What would "genuinely cracked" look like to you?

[00:08:51] ELENA: Third-party cryptographic audit. Open-source or at minimum independently verifiable implementation. HIPAA BAA signed. SOC 2 Type II. And a reference customer in a comparable regulated environment who's been live for at least 12 months. That's my checklist.

[00:09:20] HOST: Has anyone met all five?

[00:09:23] ELENA: Not yet. We have one vendor who meets four out of five — they're missing the 12-month reference customer. We're in active contract discussions and we'd potentially be their reference customer. That's how much pressure we're under to solve this.

[00:09:47] HOST: What's the contract value for a system like yours?

[00:09:50] ELENA: I can't share specific numbers, but inference at scale for 47 hospitals with 20,000+ physicians generating documentation is... not small. These are eight-figure annual contracts.

[00:10:17] HOST: Eight-figure. Okay. Last question — if you had to predict where this is in five years?

[00:10:23] ELENA: Five years from now, confidential compute is table stakes for enterprise AI in regulated industries. It won't be a differentiator — it'll be a requirement. The vendors who aren't there in five years won't be selling to regulated enterprises. The market right now rewards whoever gets there first and builds the reference customer base. Speed to credible deployment matters enormously.

[00:10:58] HOST: Elena, this was fantastic. Thank you so much.

[00:11:02] ELENA: Thanks for having me. Really enjoyed it.`,
    plantedSignals: [
      "every AI vendor transmits patient data to their cloud — centralized inference is a HIPAA violation",
      "verifiable confidential compute where vendor cannot access plaintext — cryptographic proof requirement",
      "working group with JPMorgan, Lockheed, law firms — regulated industries all have the same problem",
      "eight-figure annual contracts for inference at 47-hospital scale — massive enterprise TAM",
    ],
    expectedAssetDirection: { VVV: "bullish", TAO: "neutral", BTC: "neutral", ETH: "neutral" },
    decoyCheck: "bitcoin",
    gold: {
      modeApplied: "Translation Layer",
      minSectionsPresent: 5,
      minSignalsCaptured: 3,
      portfolioActionPresent: true,
    },
  },
];

function decoyTriggered(text: string, decoyWord: string): boolean {
  const lower = text.toLowerCase();
  const dIdx = lower.indexOf(decoyWord.toLowerCase());
  if (dIdx === -1) return false;
  const window = lower.slice(Math.max(0, dIdx - 200), dIdx + 200);
  return /(accumulate|trim|increase|reduce|target %|rebalance)/i.test(window);
}

const SECTION_MARKERS = ["## 1.", "## 2.", "## 3.", "## 4.", "## 5.", "## 6.", "## 13."];

function sectionsPresent(text: string): number {
  return SECTION_MARKERS.filter((m) => text.includes(m)).length;
}

function signalsCaptured(text: string, signals: string[]): number {
  const lower = text.toLowerCase();
  return signals.filter((s) => {
    const words = s
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4);
    const matches = words.filter((w) => lower.includes(w)).length;
    return matches >= Math.ceil(words.length * 0.5);
  }).length;
}

function portfolioActionPresent(text: string): boolean {
  return (
    /\|\s*(VVV|DIEM|TAO|BTC|ETH)\s*\|/.test(text) &&
    /(Accumulate|Trim|Hold|Increase|Reduce|Rotate)/i.test(text)
  );
}

function buildUserMessage(tc: AnalysisCase): string {
  return `UNIFIED CRYPTO PODCAST ANALYSIS & REBALANCING PROMPT

ANALYSIS MODE: ${tc.mode}

TRANSCRIPT TO ANALYZE:
${tc.transcript}

PORTFOLIO CONTEXT:
- Holdings: VVV/DIEM 40%, TAO 25%, BTC 20%, ETH 10%, Stables 5%
- Time Horizon: 3 years
- Risk Tolerance: Moderate

Produce your analysis covering these sections:

## 1. SPEAKER CREDIBILITY & WEIGHTING
Score each speaker 1-10 per the ${tc.mode} credibility table.

## 2. EXECUTIVE SUMMARY
4-6 paragraphs. For ${tc.mode}: include mode-specific additions.

## 3. KEY STATEMENTS TABLE
10-15 statements. Format: | Statement | Why It Matters | Investment Translation | Asset | Credibility |

## 4. DIRECT PORTFOLIO IMPLICATIONS
For each of VVV/DIEM, TAO, BTC, ETH: Bullish signals, Bearish signals, Conviction Check (Hold/Accumulate/Trim/Research Deeper).

## 5. SIGNAL VS. NOISE RATIO
Grade 1-10. Justify.

## 6. REBALANCING TRIGGERS ACTIVATED
List any triggers from the framework that this transcript activates. If none, state "None activated."

## 13. FINAL INVESTMENT FRAMEWORK
| Asset | Current % | Target % | Change | Justification |
Fill in for VVV, DIEM, TAO, BTC, ETH.`;
}

export const podcastAnalysis: Suite = {
  name: "podcast-analysis",
  description:
    "Tests whether a model correctly applies the full 14-section podcast analysis framework to synthetic transcripts: all required sections present, planted signals captured, mode applied, portfolio actions specified.",
  async runTrial(opts, index) {
    const tc = ANALYSIS_CASES[index % ANALYSIS_CASES.length];

    const call = await chatCall({
      model: opts.model,
      messages: [
        {
          role: "system",
          content:
            "You are a crypto portfolio analyst. Apply the podcast analysis framework exactly as specified. Use the selected ANALYSIS MODE throughout. Be thorough but precise.",
        },
        {
          role: "user",
          content: buildUserMessage(tc),
        },
      ],
      temperature: 0,
      maxTokens: 4000,
      timeoutMs: opts.timeoutMs,
    });

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);

    const content = call.content || "";
    const sections = sectionsPresent(content);
    const signals = signalsCaptured(content, tc.plantedSignals);
    const hasAction = portfolioActionPresent(content);

    const sectionsOk = sections >= tc.gold.minSectionsPresent;
    const signalsOk = signals >= tc.gold.minSignalsCaptured;

    if (!sectionsOk)
      reasons.push(`insufficient_sections:got_${sections}_min_${tc.gold.minSectionsPresent}`);
    if (!signalsOk)
      reasons.push(`insufficient_signals:got_${signals}_min_${tc.gold.minSignalsCaptured}`);
    if (!hasAction) reasons.push("no_portfolio_action");

    const passed = call.ok && sectionsOk && signalsOk && hasAction;

    const hasDecoy = tc.decoyCheck !== undefined;
    const decoyFired = hasDecoy ? decoyTriggered(content, tc.decoyCheck!) : false;

    const trialMetrics: Record<string, string | number | boolean> = {
      sections_present: sections,
      signals_captured: signals,
      portfolio_action_present: hasAction,
      sections_ok: sectionsOk,
      signals_ok: signalsOk,
      mode: tc.mode,
      has_decoy: hasDecoy,
    };
    if (hasDecoy) trialMetrics.decoy_fired = decoyFired;

    return makeTrial(index, call, passed, reasons, trialMetrics);
  },
  computeMetrics(trials) {
    const total = trials.length || 1;

    const totalSections = trials.reduce(
      (a, t) => a + (Number(t.metrics.sections_present) || 0),
      0,
    );
    const totalSignals = trials.reduce(
      (a, t) => a + (Number(t.metrics.signals_captured) || 0),
      0,
    );
    const withAction = trials.filter(
      (t) => t.metrics.portfolio_action_present === true,
    ).length;
    const sectionsOkCount = trials.filter(
      (t) => t.metrics.sections_ok === true,
    ).length;
    const signalsOkCount = trials.filter(
      (t) => t.metrics.signals_ok === true,
    ).length;

    const decoyTrials = trials.filter((t) => t.metrics.has_decoy === true);
    const decoyFalsePositives = decoyTrials.filter(
      (t) => t.metrics.decoy_fired === true,
    ).length;
    const decoyFalsePositiveRate = decoyTrials.length > 0
      ? decoyFalsePositives / decoyTrials.length
      : null;

    return {
      avg_sections_present: totalSections / total,
      avg_signals_captured: totalSignals / total,
      portfolio_action_rate: withAction / total,
      section_completion_rate: sectionsOkCount / total,
      signal_capture_rate: signalsOkCount / total,
      ...(decoyFalsePositiveRate !== null && { decoy_false_positive_rate: decoyFalsePositiveRate }),
    };
  },
};
