import { ARGUE_RESULT_VERSION, type ArgueResult } from "@onevcat/argue";

export function createFixtureResult(): ArgueResult {
  return {
    resultVersion: ARGUE_RESULT_VERSION,
    requestId: "req-1",
    sessionId: "session-1",
    status: "consensus",
    finalClaims: [
      {
        claimId: "c1",
        title: "Prefer strict schema",
        statement: "Strict validation should happen before rendering.",
        category: "pro",
        proposedBy: ["alice"],
        status: "active"
      },
      {
        claimId: "c2",
        title: "Avoid over-animation",
        statement: "Use restrained transitions only.",
        category: "risk",
        proposedBy: ["bob"],
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
          { participantId: "alice", claimId: "c1", vote: "accept" },
          { participantId: "bob", claimId: "c1", vote: "accept" }
        ]
      },
      {
        claimId: "c2",
        status: "unresolved",
        acceptCount: 1,
        rejectCount: 1,
        totalVoters: 2,
        votes: [
          { participantId: "alice", claimId: "c2", vote: "accept" },
          { participantId: "bob", claimId: "c2", vote: "reject" }
        ]
      }
    ],
    representative: {
      participantId: "alice",
      reason: "top-score",
      score: 86.2,
      speech: "We should keep the viewer deterministic and clear."
    },
    scoreboard: [
      {
        participantId: "alice",
        total: 86.2,
        byRound: [
          { round: 0, score: 42.1 },
          { round: 1, score: 44.1 }
        ],
        breakdown: {
          correctness: 22,
          completeness: 21,
          actionability: 22,
          consistency: 21.2
        }
      },
      {
        participantId: "bob",
        total: 82.4,
        byRound: [
          { round: 0, score: 41.2 },
          { round: 1, score: 41.2 }
        ],
        breakdown: {
          correctness: 20,
          completeness: 21,
          actionability: 20,
          consistency: 21.4
        }
      }
    ],
    eliminations: [],
    report: {
      mode: "representative",
      traceIncluded: true,
      traceLevel: "compact",
      finalSummary: "Validation-first rendering improves trust and stability.",
      representativeSpeech: "Schema checks and clear hierarchy are essential.",
      opinionShiftTimeline: [
        {
          claimId: "c2",
          participantId: "alice",
          from: "disagree",
          to: "revise",
          round: 1,
          reason: "Found a balanced approach"
        }
      ],
      roundHighlights: [
        { round: 0, participantId: "alice", summary: "Established baseline" },
        { round: 1, participantId: "bob", summary: "Compared risks" }
      ]
    },
    disagreements: [
      {
        claimId: "c2",
        participantId: "bob",
        reason: "Animation could distract under pressure."
      }
    ],
    rounds: [
      {
        round: 0,
        outputs: [
          {
            participantId: "alice",
            round: 0,
            phase: "initial",
            fullResponse: "...",
            extractedClaims: [
              {
                claimId: "c1",
                title: "Prefer strict schema",
                statement: "Strict validation should happen before rendering.",
                category: "pro"
              }
            ],
            judgements: [
              {
                claimId: "c1",
                stance: "agree",
                confidence: 0.84,
                rationale: "Mandatory for reliability"
              }
            ],
            summary: "Start from strict input guarantees"
          },
          {
            participantId: "bob",
            round: 0,
            phase: "initial",
            fullResponse: "...",
            extractedClaims: [
              {
                claimId: "c2",
                title: "Avoid over-animation",
                statement: "Use restrained transitions only.",
                category: "risk"
              }
            ],
            judgements: [
              {
                claimId: "c2",
                stance: "disagree",
                confidence: 0.7,
                rationale: "Need stronger feedback first"
              }
            ],
            summary: "Animation can help when minimal"
          }
        ]
      },
      {
        round: 1,
        outputs: [
          {
            participantId: "alice",
            round: 1,
            phase: "final_vote",
            fullResponse: "...",
            judgements: [
              {
                claimId: "c2",
                stance: "revise",
                confidence: 0.73,
                rationale: "Keep only subtle transitions"
              }
            ],
            claimVotes: [
              { claimId: "c1", vote: "accept" },
              { claimId: "c2", vote: "accept" }
            ],
            summary: "Prefer restrained motion"
          },
          {
            participantId: "bob",
            round: 1,
            phase: "final_vote",
            fullResponse: "...",
            judgements: [
              {
                claimId: "c1",
                stance: "agree",
                confidence: 0.81,
                rationale: "Validation gives deterministic behavior"
              }
            ],
            claimVotes: [
              { claimId: "c1", vote: "accept" },
              { claimId: "c2", vote: "reject" }
            ],
            summary: "Reject excess animation"
          }
        ]
      }
    ],
    metrics: {
      elapsedMs: 13210,
      totalRounds: 2,
      totalTurns: 4,
      retries: 1,
      waitTimeouts: 0,
      earlyStopTriggered: false,
      globalDeadlineHit: false
    }
  };
}
