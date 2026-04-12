import { useMemo, useState } from "preact/hooks";
import type { ArgueResult, Claim } from "@onevcat/argue";
import { buildClaimInsights, buildContributionIndex, formatElapsed, rankScoreboard } from "../lib/view-model.js";

type ReportViewProps = {
  result: ArgueResult;
};

const statusClassMap: Record<ArgueResult["status"], string> = {
  consensus: "status-ok",
  partial_consensus: "status-warn",
  unresolved: "status-warn",
  failed: "status-bad"
};

const breakdownOrder = ["correctness", "completeness", "actionability", "consistency"] as const;

function percentage(value: number, total: number): string {
  if (total === 0) {
    return "0%";
  }
  return `${Math.round((value / total) * 100)}%`;
}

function votesView(
  claim: Claim,
  result: ArgueResult,
  activeClaimId: string | null,
  hoveredParticipantId: string | null
) {
  const resolution = result.claimResolutions.find((item) => item.claimId === claim.claimId);
  if (!resolution) {
    return <p className="subtle">No final votes.</p>;
  }

  return (
    <ul className="inline-list compact-list">
      {resolution.votes.map((vote, index) => {
        const isClaimActive = activeClaimId === vote.claimId;
        const isParticipantActive = hoveredParticipantId === vote.participantId;
        return (
          <li
            key={`${vote.participantId}-${vote.claimId}-${index}`}
            className={`${isClaimActive ? "link-claim" : ""} ${isParticipantActive ? "link-participant" : ""}`}
          >
            <span className={`vote-pill ${vote.vote === "accept" ? "vote-accept" : "vote-reject"}`}>{vote.vote}</span>
            <span>{vote.participantId}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ReportView({ result }: ReportViewProps) {
  const claimInsights = useMemo(() => buildClaimInsights(result), [result]);
  const contributionIndex = useMemo(() => buildContributionIndex(result), [result]);
  const ranked = useMemo(() => rankScoreboard(result.scoreboard), [result.scoreboard]);

  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [hoveredParticipantId, setHoveredParticipantId] = useState<string | null>(null);

  const toggleClaim = (claimId: string) => {
    setActiveClaimId((current) => (current === claimId ? null : claimId));
  };

  return (
    <main className="report-root">
      <section className="panel header-panel">
        <div className="title-row">
          <h2>Result Report</h2>
          <span className={`status-chip ${statusClassMap[result.status]}`}>{result.status}</span>
        </div>
        <dl className="meta-grid">
          <div>
            <dt>requestId</dt>
            <dd>{result.requestId}</dd>
          </div>
          <div>
            <dt>sessionId</dt>
            <dd>{result.sessionId}</dd>
          </div>
          <div>
            <dt>elapsed</dt>
            <dd>{formatElapsed(result.metrics.elapsedMs)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <h3>Conclusion</h3>
        <p>{result.report.finalSummary}</p>
      </section>

      <section className="panel representative-panel">
        <h3>Representative</h3>
        <p className="rep-main">
          <strong>{result.representative.participantId}</strong> ({result.representative.reason})
        </p>
        <p className="subtle">Score: {result.representative.score.toFixed(2)}</p>
        <blockquote>{result.representative.speech}</blockquote>
      </section>

      <section className="panel">
        <div className="title-row">
          <h3>Claims</h3>
          <span className="subtle">Click a claim to highlight related judgements and votes</span>
        </div>
        <div className="claims-grid">
          {result.finalClaims.map((claim) => {
            const insight = claimInsights[claim.claimId];
            const isActive = activeClaimId === claim.claimId;
            const participantLinked =
              hoveredParticipantId != null &&
              (claim.proposedBy.includes(hoveredParticipantId) ||
                contributionIndex[hoveredParticipantId]?.claimIds.has(claim.claimId));

            return (
              <article
                className={`claim-card ${isActive ? "is-active" : ""} ${participantLinked ? "link-participant" : ""}`}
                onClick={() => toggleClaim(claim.claimId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleClaim(claim.claimId);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                key={claim.claimId}
              >
                <header>
                  <h4>{claim.title}</h4>
                  <span className="mono">{claim.claimId}</span>
                </header>
                <p>{claim.statement}</p>
                <p className="subtle">category: {claim.category ?? "uncategorized"}</p>
                <p className="subtle">proposed by: {claim.proposedBy.join(", ")}</p>
                <div className="split-grid">
                  <div>
                    <h5>Votes</h5>
                    <p>
                      accept {insight?.votes.accept ?? 0} / reject {insight?.votes.reject ?? 0}
                    </p>
                    {votesView(claim, result, activeClaimId, hoveredParticipantId)}
                  </div>
                  <div>
                    <h5>Stances</h5>
                    <p>agree {insight?.stances.agree ?? 0}</p>
                    <p>disagree {insight?.stances.disagree ?? 0}</p>
                    <p>revise {insight?.stances.revise ?? 0}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h3>Scoreboard</h3>
        <table className="score-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Participant</th>
              <th>Total</th>
              <th>Rounds</th>
              <th>Breakdown</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((participant, index) => {
              const hovered = participant.participantId === hoveredParticipantId;
              return (
                <tr
                  className={hovered ? "link-participant" : ""}
                  key={participant.participantId}
                  onMouseEnter={() => setHoveredParticipantId(participant.participantId)}
                  onMouseLeave={() => setHoveredParticipantId(null)}
                >
                  <td className="rank-cell">#{index + 1}</td>
                  <td>{participant.participantId}</td>
                  <td>{participant.total.toFixed(2)}</td>
                  <td>{participant.byRound.map((item) => `r${item.round}:${item.score.toFixed(1)}`).join(" · ")}</td>
                  <td>
                    {participant.breakdown ? (
                      <div className="breakdown-bars">
                        {breakdownOrder.map((label) => {
                          const value = participant.breakdown?.[label] ?? 0;
                          return (
                            <div className="breakdown-row" key={label}>
                              <span>{label}</span>
                              <div className="breakdown-bar-track">
                                <div className="breakdown-bar-fill" style={{ width: `${Math.min(value, 25) * 4}%` }} />
                              </div>
                              <span>{value.toFixed(1)}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="subtle">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3>Rounds</h3>
        <div className="rounds-list">
          {result.rounds.map((round) => (
            <details key={round.round}>
              <summary>
                <span>Round {round.round}</span>
                <span className="subtle">{round.outputs.length} outputs</span>
              </summary>
              <div className="round-details">
                {round.outputs.map((output, outputIndex) => {
                  const participantLinked = hoveredParticipantId === output.participantId;
                  return (
                    <article
                      className={`round-output ${participantLinked ? "link-participant" : ""}`}
                      key={`${output.participantId}-${round.round}-${outputIndex}`}
                    >
                      <header>
                        <h5>{output.participantId}</h5>
                        <div className="output-tags">
                          <span>{output.phase}</span>
                          {output.selfScore != null ? <span>self {output.selfScore.toFixed(1)}</span> : null}
                          <span>r{round.round}</span>
                        </div>
                      </header>

                      <p>{output.summary}</p>

                      {output.extractedClaims?.length ? (
                        <div>
                          <h5>Extracted claims</h5>
                          <ul className="stack-list compact-list">
                            {output.extractedClaims.map((item, claimIndex) => (
                              <li key={`${item.title}-${claimIndex}`}>
                                <strong>{item.claimId ?? "(new)"}</strong> · {item.title}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div>
                        <h5>Judgements</h5>
                        <ul className="stack-list compact-list">
                          {output.judgements.map((item, judgementIndex) => {
                            const claimLinked = activeClaimId === item.claimId;
                            return (
                              <li className={claimLinked ? "link-claim" : ""} key={`${item.claimId}-${judgementIndex}`}>
                                <strong>{item.claimId}</strong> · {item.stance} · c={item.confidence.toFixed(2)}
                              </li>
                            );
                          })}
                        </ul>
                      </div>

                      {output.phase === "final_vote" ? (
                        <div>
                          <h5>Votes</h5>
                          <ul className="inline-list compact-list">
                            {output.claimVotes.map((vote, voteIndex) => {
                              const claimLinked = activeClaimId === vote.claimId;
                              return (
                                <li className={claimLinked ? "link-claim" : ""} key={`${vote.claimId}-${voteIndex}`}>
                                  {vote.claimId}: {vote.vote}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </section>

      {result.disagreements?.length ? (
        <section className="panel">
          <h3>Disagreements</h3>
          <ul className="stack-list">
            {result.disagreements.map((item, index) => {
              const claimLinked = activeClaimId === item.claimId;
              const participantLinked = hoveredParticipantId === item.participantId;
              return (
                <li
                  className={`${claimLinked ? "link-claim" : ""} ${participantLinked ? "link-participant" : ""}`}
                  key={`${item.claimId}-${item.participantId}-${index}`}
                >
                  <strong>{item.claimId}</strong> · {item.participantId} · {item.reason}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {result.eliminations.length ? (
        <section className="panel">
          <h3>Eliminations</h3>
          <ul className="stack-list">
            {result.eliminations.map((item, index) => (
              <li key={`${item.participantId}-${item.round}-${index}`}>
                {item.participantId} · round {item.round} · {item.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.action ? (
        <section className="panel">
          <h3>Action</h3>
          <p>
            <strong>{result.action.actorId}</strong> · {result.action.status}
          </p>
          {result.action.summary ? <p>{result.action.summary}</p> : null}
          {result.action.error ? <p className="error-line">{result.action.error}</p> : null}
        </section>
      ) : null}

      <section className="panel metrics-panel">
        <h3>Metrics</h3>
        <div className="metrics-grid">
          <p>elapsed: {formatElapsed(result.metrics.elapsedMs)}</p>
          <p>total rounds: {result.metrics.totalRounds}</p>
          <p>total turns: {result.metrics.totalTurns}</p>
          <p>retries: {result.metrics.retries}</p>
          <p>timeouts: {result.metrics.waitTimeouts}</p>
          <p>early stop: {result.metrics.earlyStopTriggered ? "yes" : "no"}</p>
          <p>deadline hit: {result.metrics.globalDeadlineHit ? "yes" : "no"}</p>
          <p>
            consensus ratio:{" "}
            {percentage(
              result.claimResolutions.filter((item) => item.status === "resolved").length,
              result.claimResolutions.length
            )}
          </p>
        </div>
      </section>
    </main>
  );
}
