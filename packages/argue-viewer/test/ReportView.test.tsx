import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { ReportView } from "../src/components/ReportView.js";
import { createFixtureResult } from "./fixtures.js";

describe("ReportView", () => {
  it("shows each effective merge only once in the round where it first became true", () => {
    const result = createFixtureResult();

    result.finalClaims = [
      {
        claimId: "c1",
        title: "Canonical claim",
        statement: "survivor",
        category: "pro",
        proposedBy: ["alice", "bob"],
        status: "active"
      },
      {
        claimId: "c2",
        title: "Duplicate claim",
        statement: "duplicate",
        category: "pro",
        proposedBy: ["bob"],
        status: "merged",
        mergedInto: "c1"
      }
    ];
    result.claimResolutions = [
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
      }
    ];
    result.rounds = [
      {
        round: 1,
        outputs: [
          {
            participantId: "alice",
            round: 1,
            phase: "debate",
            fullResponse: "...",
            judgements: [
              {
                claimId: "c2",
                stance: "revise",
                confidence: 0.9,
                rationale: "duplicate",
                mergesWith: "c1"
              }
            ],
            summary: "alice merge proposal"
          },
          {
            participantId: "bob",
            round: 1,
            phase: "debate",
            fullResponse: "...",
            judgements: [
              {
                claimId: "c2",
                stance: "revise",
                confidence: 0.91,
                rationale: "same duplicate",
                mergesWith: "c1"
              }
            ],
            summary: "bob confirms merge"
          }
        ]
      },
      {
        round: 2,
        outputs: [
          {
            participantId: "bob",
            round: 2,
            phase: "debate",
            fullResponse: "...",
            judgements: [
              {
                claimId: "c2",
                stance: "revise",
                confidence: 0.92,
                rationale: "repeated historical merge reference",
                mergesWith: "c1"
              }
            ],
            summary: "bob repeats the old merge"
          }
        ]
      }
    ];

    const { container } = render(<ReportView result={result} />);
    expect(container.querySelectorAll(".merge-row")).toHaveLength(1);
  });

  it("renders chained applied merges from structured round data and sorts participant ids", () => {
    const result = createFixtureResult();

    result.finalClaims = [
      {
        claimId: "c1",
        title: "Claim 1",
        statement: "merged into c2",
        category: "pro",
        proposedBy: ["alpha"],
        status: "merged",
        mergedInto: "c2"
      },
      {
        claimId: "c2",
        title: "Claim 2",
        statement: "merged into c3",
        category: "pro",
        proposedBy: ["zeta"],
        status: "merged",
        mergedInto: "c3"
      },
      {
        claimId: "c3",
        title: "Claim 3",
        statement: "survivor",
        category: "pro",
        proposedBy: ["gamma"],
        status: "active"
      }
    ];

    result.claimResolutions = [
      {
        claimId: "c3",
        status: "resolved",
        acceptCount: 3,
        rejectCount: 0,
        totalVoters: 3,
        votes: [
          { participantId: "alpha", claimId: "c3", vote: "accept" },
          { participantId: "zeta", claimId: "c3", vote: "accept" },
          { participantId: "gamma", claimId: "c3", vote: "accept" }
        ]
      }
    ];

    result.rounds = [
      {
        round: 1,
        appliedMerges: [
          {
            sourceClaimId: "c1",
            targetClaimId: "c2",
            participantIds: ["zeta", "alpha"]
          }
        ],
        outputs: [
          {
            participantId: "alpha",
            round: 1,
            phase: "debate",
            fullResponse: "...",
            judgements: [
              {
                claimId: "c1",
                stance: "revise",
                confidence: 0.9,
                rationale: "first merge",
                mergesWith: "c2"
              }
            ],
            summary: "merge c1 to c2"
          }
        ]
      },
      {
        round: 2,
        appliedMerges: [
          {
            sourceClaimId: "c2",
            targetClaimId: "c3",
            participantIds: ["gamma"]
          }
        ],
        outputs: [
          {
            participantId: "gamma",
            round: 2,
            phase: "debate",
            fullResponse: "...",
            judgements: [
              {
                claimId: "c1",
                stance: "revise",
                confidence: 0.92,
                rationale: "historical reference",
                mergesWith: "c2"
              },
              {
                claimId: "c2",
                stance: "revise",
                confidence: 0.93,
                rationale: "second merge",
                mergesWith: "c3"
              }
            ],
            summary: "merge c2 to c3"
          }
        ]
      }
    ];

    const { container } = render(<ReportView result={result} />);
    expect(container.querySelectorAll(".merge-row")).toHaveLength(2);

    const text = container.textContent ?? "";
    expect(text).toContain("by alpha, zeta");
    expect(text).not.toContain("by zeta, alpha");
  });

});
