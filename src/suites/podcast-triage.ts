import { chatCall } from "../venice.ts";
import { makeTrial, type Suite } from "../runner.ts";

interface TriageGold {
  decision: "GREEN" | "YELLOW" | "RED";
  skipCount: number;
  prioritizeCount: number;
}

interface TriageCase {
  show: string;
  title: string;
  guest: string;
  guestBg: string;
  description: string;
  date: string;
  gold: TriageGold;
}

const TEST_CASES: TriageCase[] = [
  // Case 0 — Clear RED: thought leader, hype, visionary
  {
    show: "Future Forward Tech",
    title: "The Metaverse Will Change Everything by 2030",
    guest: "Alex Thompson",
    guestBg: "Tech visionary, bestselling author, keynote speaker at 200+ conferences",
    description:
      "Alex Thompson shares his vision for the metaverse and Web3. Having inspired thousands globally, Alex explains why 2030 will be a pivotal year for digital transformation and what it means for your future.",
    date: "2026-04-10",
    gold: { decision: "RED", skipCount: 2, prioritizeCount: 0 },
  },
  // Case 1 — Clear GREEN: macro strategist, called cycle, researcher
  {
    show: "Macro Matters",
    title: "Why Consensus Inflation Forecasts Are Wrong",
    guest: "Dr. Sarah Chen",
    guestBg:
      "Chief Economist at Goldman Sachs, 15-year track record, publicly called 2008 crisis and 2022 inflation spike in published research",
    description:
      "Dr. Chen presents her proprietary macro model's current output, explains why all 42 consensus forecasters are wrong on core CPI, and shares specific leading indicators she is watching for the rate pivot. First podcast appearance.",
    date: "2026-04-15",
    gold: { decision: "GREEN", skipCount: 0, prioritizeCount: 3 },
  },
  // Case 2 — YELLOW: operator with P&L but only 1 trigger
  {
    show: "Venture Voices",
    title: "Building Enterprise AI Infrastructure at Scale",
    guest: "Marcus Rivera",
    guestBg: "CEO of DataVault, $120M ARR, currently building, Series C at $400M",
    description:
      "Marcus discusses how DataVault built its data platform, technical architecture decisions, and why enterprise AI adoption timelines are being underestimated. Practical operational insights from running a 400-person engineering org.",
    date: "2026-04-12",
    gold: { decision: "YELLOW", skipCount: 0, prioritizeCount: 1 },
  },
  // Case 3 — RED: course seller + influencer
  {
    show: "Crypto Alpha Daily",
    title: "My Exact System to 10x Your Portfolio This Cycle",
    guest: "CryptoKing Jake",
    guestBg: "Crypto influencer, 500K Twitter followers, founder of Alpha Academy membership community",
    description:
      "Jake shares the exact altcoin selection strategy he uses to find 10x gems before they moon. Join his Alpha Academy at cryptokingjake.com for the full framework and his weekly picks.",
    date: "2026-04-11",
    gold: { decision: "RED", skipCount: 2, prioritizeCount: 0 },
  },
  // Case 4 — GREEN: regulator + researcher with deployed systems
  {
    show: "Policy Decoded",
    title: "What the SEC Crypto Framework Actually Means",
    guest: "Commissioner Janet Walsh",
    guestBg:
      "SEC Commissioner, 12 years at agency, authored the 2024 digital assets framework, former Fed economist",
    description:
      "Commissioner Walsh explains which specific crypto activities the new SEC framework covers, the enforcement priority list for 2026, and how registration pathways will work in practice. Includes discussion of specific pending cases.",
    date: "2026-04-14",
    gold: { decision: "GREEN", skipCount: 0, prioritizeCount: 2 },
  },
  // Case 5 — RED: recycled content + no track record
  {
    show: "Startup Stories",
    title: "The Founder Journey: From Idea to Exit",
    guest: "Brad Mitchell",
    guestBg:
      "Serial entrepreneur, advisor, speaker — has appeared on 15 podcasts this month discussing the same 2019 exit story",
    description:
      "Brad shares the same inspiring story of how he built and sold his SaaS company in 2019. Lessons on mindset, resilience, and the entrepreneurial journey that Brad has been sharing on the podcast circuit.",
    date: "2026-04-09",
    gold: { decision: "RED", skipCount: 2, prioritizeCount: 0 },
  },
  // Case 6 — YELLOW: 2 prioritize triggers, no skip
  {
    show: "The AI Builders",
    title: "Shipping Production AI at Enterprise Scale",
    guest: "Dr. Priya Nair",
    guestBg:
      "VP Engineering at Stripe, PhD in distributed systems, 3 published papers on ML inference optimization, currently building",
    description:
      "Dr. Nair walks through Stripe's internal ML infrastructure, the specific latency and reliability problems they solved, and their approach to evaluating AI vendors. Technical and data-driven throughout.",
    date: "2026-04-13",
    gold: { decision: "YELLOW", skipCount: 0, prioritizeCount: 2 },
  },
  // Case 7 — YELLOW (0 PRIORITIZE, 0 SKIP — MAYBE category → still YELLOW)
  {
    show: "Crypto Conversations",
    title: "Understanding DeFi Yield Strategies",
    guest: "Tom Baker",
    guestBg: "DeFi blogger, no disclosed trading track record, no company affiliation",
    description:
      "Tom explains various yield farming strategies across major DeFi protocols, how to calculate real APY after fees, and common risks to avoid. Educational content for intermediate crypto users.",
    date: "2026-04-08",
    gold: { decision: "YELLOW", skipCount: 0, prioritizeCount: 0 },
  },
  // Case 8 — Buried SKIP trigger (hard): impressive credentials obscure a course-selling skip trigger
  {
    show: "The Leadership Edge",
    title: "Scaling Culture at Hypergrowth Startups",
    guest: "Ryan Caldwell",
    guestBg:
      "Executive coach, former VP People at two Y Combinator companies, faculty at Stanford d.school, keynote speaker, now runs Caldwell Leadership Academy with 3,000 enrolled students",
    description: `Ryan Caldwell has spent 15 years at the intersection of organizational psychology and startup culture. As VP People at two YC-backed companies that both reached $50M ARR, he developed frameworks for maintaining culture through rapid scaling. He holds a master's in organizational behavior from Stanford and has published three pieces in Harvard Business Review on distributed team management.

In this episode, Ryan shares his proprietary Culture Stack framework — the same system he now teaches in his flagship online course at caldwellleadership.com/academy. The course has helped over 3,000 founders and operators build world-class teams. He covers: hiring for cultural fit at scale, managing the transition from 50 to 500 employees, and why most startups get remote culture wrong.

This is one of the most tactical episodes we've recorded. Ryan's framework has been adopted by companies you know. If you want the full playbook, the Academy doors open next week.`,
    date: "2026-04-16",
    gold: { decision: "RED", skipCount: 1, prioritizeCount: 0 },
    // SKIP trigger: selling course/masterclass/community — buried but explicit ("flagship online course", "Academy doors open next week")
  },
  // Case 9 — Mixed signals, genuinely hard (edge case): real credentials + skip trigger
  // Key test: model must apply the rubric correctly — ANY skip = RED — despite 3 prioritize triggers
  {
    show: "Crypto Investor Summit",
    title: "Macro Cycles and the Bitcoin Supercycle Thesis",
    guest: "Dr. James Holbrook",
    guestBg:
      "Former hedge fund PM at Bridgewater (12 years), co-authored 2 published papers on macro cycles, correctly called 2018 and 2022 crypto drawdowns publicly — now selling 'Holbrook Macro Alpha' subscription newsletter at $2,400/year",
    description: `Dr. James Holbrook brings rare credibility to the crypto macro discussion. During his 12 years at Bridgewater Associates, he managed a $2.4B macro portfolio and developed the cycle-tracking methodology now used in his research. He publicly and specifically predicted the 2018 crypto bear market in a Bloomberg interview and the 2022 drawdown on a November 2021 podcast — both on record.

In this episode, James presents his current macro thesis: why he believes we are entering a 4-year BTC supercycle driven by M2 expansion and institutional allocation. He shares specific leading indicators, his proprietary cycle model's current readings, and where he sees BTC price in 12 months.

Note: James publishes his full model outputs, specific entry/exit signals, and weekly updates exclusively through his Holbrook Macro Alpha service at $2,400/year. This episode covers his framework; the specific actionable signals require a subscription.`,
    date: "2026-04-17",
    gold: { decision: "RED", skipCount: 1, prioritizeCount: 3 },
    // SKIP trigger: selling course/masterclass/community (subscription service)
    // PRIORITIZE: macro strategist 10+ year track record, called previous cycles correctly, researcher with published work
  },
  // Case 10 — Long description, no triggers at all, unambiguously GREEN
  // Tests that the model does not hallucinate SKIP triggers when none exist
  {
    show: "The Institutional Investor",
    title: "Running a $4B Crypto Treasury: Lessons from MicroStrategy's CFO",
    guest: "Patricia Womack",
    guestBg:
      "CFO of MicroStrategy, CPA, 20 years in institutional finance, directly managed the $4.2B Bitcoin acquisition strategy, testified before Senate Banking Committee on crypto accounting standards",
    description: `Patricia Womack joined MicroStrategy as CFO in 2021, inheriting the mandate to manage what had become the world's largest corporate Bitcoin treasury. In the four years since, she has directly overseen the acquisition of $4.2 billion in Bitcoin across 27 separate tranches, navigated FASB's evolving crypto accounting standards in real time, and testified twice before the Senate Banking Committee on digital asset disclosure requirements.

This is Patricia's first podcast appearance. She agreed to speak because MicroStrategy recently completed its Q1 2026 earnings disclosure under the new FASB fair-value accounting rules — the first major company to do so — and she wanted to explain the methodology publicly before analyst questions begin.

The episode covers: how MicroStrategy evaluates Bitcoin acquisition timing, the internal treasury policy governing position sizing, the specific accounting treatment they applied under ASC 350-60, why she believes the new FASB rules will accelerate institutional adoption, and what the Senate Banking Committee specifically asked her about during closed testimony. No promotional content. Patricia has no subscription products, courses, or communities. She is currently CFO of a public company.`,
    date: "2026-04-18",
    gold: { decision: "GREEN", skipCount: 0, prioritizeCount: 3 },
    // PRIORITIZE: operator running $100M+ P&L (public co), regulator/policy maker (Senate testimony), first-time appearance
  },
];

function buildUserMessage(tc: TriageCase): string {
  return `PODCAST EPISODE TRIAGE PROMPT

Evaluate this episode for listening priority.

EPISODE TO EVALUATE:
- Show Name: ${tc.show}
- Episode Title: ${tc.title}
- Guest Name: ${tc.guest}
- Guest Title/Background: ${tc.guestBg}
- Episode Description: ${tc.description}
- Posted Date: ${tc.date}

SKIP TRIGGERS (Check any that apply):
- Guest is CMO/marketer without P&L responsibility
- "Thought leader" with no verifiable company exits/research/deployed systems
- Hype cycle topic (NFT metaverse moments, "get rich quick" framing)
- Selling course/masterclass/community (obvious monetization play)
- Crypto influencer with no technical background discussing price
- "Visionary" discussing 10-year future with zero track record
- Recycled content (guest has told same story on 5+ other pods this month)

PRIORITIZE TRIGGERS (Check any that apply):
- Operator running $100M+ P&L (public company, verified revenue)
- Founder who took company public or $500M+ exit
- Researcher with cited papers or deployed production systems
- Macro strategist with 10+ year verifiable track record
- Person who called previous cycle correctly (specific predictions, not vague)
- Technical founder currently building (not "advising")
- Regulator/policy maker with actual authority
- First-time appearance (new information vs. recycled)

TRIAGE DECISION:
| Priority Score | Action |
| 0 SKIP + 3+ PRIORITIZE | LISTEN IMMEDIATELY — GREEN |
| 0 SKIP + 1-2 PRIORITIZE | QUEUE — YELLOW |
| 0 SKIP + 0 PRIORITIZE | MAYBE — YELLOW |
| ANY SKIP triggers checked | SKIP — RED |

OUTPUT FORMAT (use exactly this structure):
SKIP TRIGGERS CHECKED: [list each trigger that applies, or "none"]
PRIORITIZE TRIGGERS CHECKED: [list each trigger that applies, or "none"]
PRIORITIZE COUNT: [number]
DECISION: [GREEN / YELLOW / RED]
REASON: [1-2 sentences]`;
}

function extractDecision(text: string): "GREEN" | "YELLOW" | "RED" | null {
  const m = text.match(/DECISION:\s*(GREEN|YELLOW|RED)/i);
  return m ? (m[1].toUpperCase() as "GREEN" | "YELLOW" | "RED") : null;
}

function extractPrioritizeCount(text: string): number {
  const m = text.match(/PRIORITIZE COUNT:\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : -1;
}

export const podcastTriage: Suite = {
  name: "podcast-triage",
  description:
    "Applies a structured podcast triage rubric to episode metadata and verifies the model returns the correct RED/YELLOW/GREEN decision with accurate prioritize-trigger count.",
  async runTrial(opts, index) {
    const tc = TEST_CASES[index % TEST_CASES.length];

    const call = await chatCall({
      model: opts.model,
      messages: [
        {
          role: "system",
          content:
            "You are a podcast analyst evaluating episodes for listening priority. Apply the rubric exactly as given. Output your analysis in the exact format shown.",
        },
        {
          role: "user",
          content: buildUserMessage(tc),
        },
      ],
      temperature: 0,
      maxTokens: 600,
      timeoutMs: opts.timeoutMs,
    });

    const reasons: string[] = [];
    if (!call.ok) reasons.push(`api_error:${call.error}`);

    const content = call.content || "";
    const decision = extractDecision(content);
    const prioritizeCount = extractPrioritizeCount(content);

    const formatCompliant = decision !== null;
    const decisionCorrect = decision === tc.gold.decision;
    const countClose =
      prioritizeCount >= 0 &&
      Math.abs(prioritizeCount - tc.gold.prioritizeCount) <= 1;

    if (!formatCompliant) reasons.push("format_noncompliant");
    if (!decisionCorrect)
      reasons.push(
        `wrong_decision:got_${decision ?? "null"}_expected_${tc.gold.decision}`,
      );
    if (!countClose)
      reasons.push(
        `prioritize_count_off:got_${prioritizeCount}_expected_${tc.gold.prioritizeCount}`,
      );

    const passed = call.ok && decisionCorrect && countClose;

    return makeTrial(index, call, passed, reasons, {
      decision: decision ?? "null",
      expected_decision: tc.gold.decision,
      decision_correct: decisionCorrect,
      prioritize_count: prioritizeCount,
      expected_prioritize_count: tc.gold.prioritizeCount,
      count_close: countClose,
      format_compliant: formatCompliant,
    });
  },
  computeMetrics(trials) {
    const total = trials.length || 1;

    const decisionCorrect = trials.filter(
      (t) => t.metrics.decision_correct === true,
    ).length;
    const formatCompliant = trials.filter(
      (t) => t.metrics.format_compliant === true,
    ).length;

    const redTrials = trials.filter(
      (t) => t.metrics.expected_decision === "RED",
    );
    const yellowTrials = trials.filter(
      (t) => t.metrics.expected_decision === "YELLOW",
    );
    const greenTrials = trials.filter(
      (t) => t.metrics.expected_decision === "GREEN",
    );

    const classAcc = (subset: typeof trials) => {
      if (!subset.length) return 0;
      return subset.filter((t) => t.metrics.decision_correct === true).length / subset.length;
    };

    return {
      decision_accuracy: decisionCorrect / total,
      red_accuracy: classAcc(redTrials),
      yellow_accuracy: classAcc(yellowTrials),
      green_accuracy: classAcc(greenTrials),
      format_compliance: formatCompliant / total,
    };
  },
};
