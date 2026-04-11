import type { ArgueEvent, ArgueResult } from "@onevcat/argue";
import { describe, expect, it } from "vitest";
import { createOutputFormatter } from "../src/output.js";

function createIO(): { logs: string[]; errors: string[]; log: (msg: string) => void; error: (msg: string) => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (msg: string) => logs.push(msg),
    error: (msg: string) => errors.push(msg)
  };
}

function makeParticipantRespondedEvent(overrides: Record<string, unknown> = {}): ArgueEvent {
  return {
    type: "ParticipantResponded",
    at: new Date().toISOString(),
    requestId: "req-1",
    sessionId: "sess-1",
    payload: {
      phase: "debate",
      round: 1,
      participantId: "agent-a",
      summary: "I agree with the main claim.",
      extractedClaims: 1,
      judgements: 2,
      stanceAgree: 1,
      stanceDisagree: 1,
      stanceRevise: 0,
      claimVotes: 0,
      fullResponse: "This is the full LLM response text.",
      extractedClaimsDetail: [
        { title: "New finding", statement: "A newly discovered insight.", category: "pro" }
      ],
      judgementsDetail: [
        { claimId: "c1", stance: "agree", confidence: 0.95, rationale: "Strong evidence supports this." },
        { claimId: "c2", stance: "disagree", confidence: 0.7, rationale: "Contradicts prior analysis." }
      ],
      ...overrides
    }
  };
}

function makeMinimalResult(): ArgueResult {
  return {
    requestId: "req-1",
    sessionId: "sess-1",
    status: "consensus",
    finalClaims: [
      {
        claimId: "c1",
        title: "Main claim",
        statement: "The primary conclusion.",
        category: "pro",
        proposedBy: ["agent-a", "agent-b"],
        status: "active"
      }
    ],
    claimResolutions: [
      {
        claimId: "c1",
        status: "resolved",
        acceptCount: 2,
        rejectCount: 0,
        totalVoters: 2,
        votes: [
          { participantId: "agent-a", claimId: "c1", vote: "accept", reason: "Correct." },
          { participantId: "agent-b", claimId: "c1", vote: "accept" }
        ]
      }
    ],
    representative: {
      participantId: "agent-a",
      reason: "top-score",
      score: 85.5,
      speech: "We reached consensus on the main claim."
    },
    scoreboard: [
      {
        participantId: "agent-a",
        total: 85.5,
        byRound: [
          { round: 0, score: 80 },
          { round: 1, score: 91 }
        ],
        breakdown: { correctness: 90, completeness: 85, actionability: 80, consistency: 87 }
      },
      {
        participantId: "agent-b",
        total: 78.2,
        byRound: [
          { round: 0, score: 75 },
          { round: 1, score: 81.4 }
        ],
        breakdown: { correctness: 80, completeness: 75, actionability: 78, consistency: 80 }
      }
    ],
    eliminations: [],
    report: {
      mode: "representative",
      traceIncluded: false,
      traceLevel: "compact",
      finalSummary: "Consensus reached.",
      representativeSpeech: "We reached consensus on the main claim."
    },
    rounds: [],
    metrics: {
      elapsedMs: 12345,
      totalRounds: 3,
      totalTurns: 6,
      retries: 0,
      waitTimeouts: 0,
      earlyStopTriggered: false,
      globalDeadlineHit: false
    }
  };
}

describe("output formatter", () => {
  describe("non-verbose mode", () => {
    it("does not show detailed judgements or full response", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: false, noColor: true });
      const handler = fmt.createEventHandler();

      handler(makeParticipantRespondedEvent());

      const all = io.logs.join("\n");
      expect(all).toContain("agent-a");
      expect(all).toContain("1✓ 1✗");
      expect(all).toContain("I agree with the main claim.");
      expect(all).not.toContain("full response:");
      expect(all).not.toContain("judgements:");
      expect(all).not.toContain("Strong evidence");
    });

    it("does not show scoreboard in runCompleted", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: false, noColor: true });
      fmt.runCompleted(makeMinimalResult(), { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("consensus");
      expect(all).not.toContain("Scoreboard:");
      expect(all).not.toContain("Metrics:");
    });
  });

  describe("verbose mode", () => {
    it("shows extracted claims detail", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();

      handler(makeParticipantRespondedEvent());

      const all = io.logs.join("\n");
      expect(all).toContain("extracted claims:");
      expect(all).toContain("New finding");
      expect(all).toContain("[pro]");
      expect(all).toContain("A newly discovered insight.");
    });

    it("shows judgements with stance, confidence, and rationale", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();

      handler(makeParticipantRespondedEvent());

      const all = io.logs.join("\n");
      expect(all).toContain("judgements:");
      expect(all).toContain("c1");
      expect(all).toContain("95%");
      expect(all).toContain("Strong evidence supports this.");
      expect(all).toContain("c2");
      expect(all).toContain("70%");
      expect(all).toContain("Contradicts prior analysis.");
    });

    it("shows revised statement for revise stance", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();

      handler(
        makeParticipantRespondedEvent({
          judgementsDetail: [
            {
              claimId: "c1",
              stance: "revise",
              confidence: 0.8,
              rationale: "Needs refinement.",
              revisedStatement: "Updated claim text."
            }
          ]
        })
      );

      const all = io.logs.join("\n");
      expect(all).toContain("revised:");
      expect(all).toContain("Updated claim text.");
    });

    it("shows claim votes in final_vote phase", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();

      handler(
        makeParticipantRespondedEvent({
          phase: "final_vote",
          claimVotes: 2,
          claimVotesDetail: [
            { claimId: "c1", vote: "accept", reason: "Solid conclusion." },
            { claimId: "c2", vote: "reject", reason: "Insufficient evidence." }
          ]
        })
      );

      const all = io.logs.join("\n");
      expect(all).toContain("votes:");
      expect(all).toContain("accept");
      expect(all).toContain("Solid conclusion.");
      expect(all).toContain("reject");
      expect(all).toContain("Insufficient evidence.");
    });

    it("shows full response text", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();

      handler(makeParticipantRespondedEvent());

      const all = io.logs.join("\n");
      expect(all).toContain("full response:");
      expect(all).toContain("This is the full LLM response text.");
    });

    it("shows scoreboard with breakdown in runCompleted", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      fmt.runCompleted(makeMinimalResult(), { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Scoreboard:");
      expect(all).toContain("agent-a: 85.50");
      expect(all).toContain("agent-b: 78.20");
      expect(all).toContain("cor=90");
      expect(all).toContain("cpl=85");
      expect(all).toContain("act=80");
      expect(all).toContain("con=87");
    });

    it("shows claims with resolution status", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      fmt.runCompleted(makeMinimalResult(), { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Claims:");
      expect(all).toContain("c1: Main claim");
      expect(all).toContain("[pro]");
      expect(all).toContain("proposed by: agent-a, agent-b");
      expect(all).toContain("resolved: 2/2 accept");
    });

    it("shows representative speech", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      fmt.runCompleted(makeMinimalResult(), { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Representative speech:");
      expect(all).toContain("We reached consensus on the main claim.");
    });

    it("shows metrics", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      fmt.runCompleted(makeMinimalResult(), { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Metrics:");
      expect(all).toContain("12.3s");
      expect(all).toContain("rounds=3");
      expect(all).toContain("turns=6");
    });

    it("shows disagreements when present", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const result = makeMinimalResult();
      result.disagreements = [{ claimId: "c1", participantId: "agent-b", reason: "I still disagree." }];
      fmt.runCompleted(result, { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Disagreements:");
      expect(all).toContain("c1 by agent-b: I still disagree.");
    });

    it("shows action dispatched event", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();
      handler({
        type: "ActionDispatched",
        at: new Date().toISOString(),
        requestId: "req-1",
        sessionId: "sess-1",
        payload: { actorId: "agent-a", prompt: "Fix the bugs." }
      });
      const all = io.logs.join("\n");
      expect(all).toContain("action dispatched");
      expect(all).toContain("agent-a");
      expect(all).toContain("Fix the bugs.");
    });

    it("shows action completed event", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { noColor: true });
      const handler = fmt.createEventHandler();
      handler({
        type: "ActionCompleted",
        at: new Date().toISOString(),
        requestId: "req-1",
        sessionId: "sess-1",
        payload: { actorId: "agent-a", summary: "Fixed 3 issues." }
      });
      const all = io.logs.join("\n");
      expect(all).toContain("action completed");
      expect(all).toContain("Fixed 3 issues.");
    });

    it("shows action failed event", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { noColor: true });
      const handler = fmt.createEventHandler();
      handler({
        type: "ActionFailed",
        at: new Date().toISOString(),
        requestId: "req-1",
        sessionId: "sess-1",
        payload: { actorId: "agent-a", reason: "dispatch_failed" }
      });
      const all = io.logs.join("\n");
      expect(all).toContain("action failed");
      expect(all).toContain("dispatch_failed");
    });

    it("shows eliminations when present", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const result = makeMinimalResult();
      result.eliminations = [{ participantId: "agent-c", round: 2, reason: "timeout", at: "2026-04-10T00:00:00Z" }];
      fmt.runCompleted(result, { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Eliminations:");
      expect(all).toContain("agent-c at round 2 (timeout)");
    });
  });
});
