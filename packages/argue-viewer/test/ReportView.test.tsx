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
});
