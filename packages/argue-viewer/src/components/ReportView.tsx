import { useMemo, useState } from "preact/hooks";
import type { ArgueResult, Claim } from "@onevcat/argue";
import {
  buildClaimInsights,
  buildContributionIndex,
  formatElapsed,
  formatTimestamp,
  rankScoreboard
} from "../lib/view-model.js";

type ReportViewProps = {
  result: ArgueResult;
};

type StampKind = "pass" | "warn" | "fail";

const verdictByStatus: Record<ArgueResult["status"], { label: string; kind: StampKind; subtitle: string }> = {
  consensus: { label: "PASS", kind: "pass", subtitle: "Consensus reached" },
  partial_consensus: { label: "PARTIAL", kind: "warn", subtitle: "Partial consensus" },
  unresolved: { label: "OPEN", kind: "warn", subtitle: "Unresolved" },
  failed: { label: "FAIL", kind: "fail", subtitle: "Run failed" }
};

const breakdownOrder = ["correctness", "completeness", "actionability", "consistency"] as const;

function formatRomanish(index: number): string {
  // simple decimal padding so §03.02 reads editorially without depending on roman numerals.
  return index.toString().padStart(2, "0");
}

function votesView(
  claim: Claim,
  result: ArgueResult,
  activeClaimId: string | null,
  hoveredParticipantId: string | null
) {
  const resolution = result.claimResolutions.find((item) => item.claimId === claim.claimId);
  if (!resolution) {
    return null;
  }

  return (
    <ul className="claim-votes-list">
      {resolution.votes.map((vote, index) => {
        const isClaimActive = activeClaimId === vote.claimId;
        const isParticipantActive = hoveredParticipantId === vote.participantId;
        const classes = [isClaimActive ? "link-claim" : "", isParticipantActive ? "link-participant" : ""]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={`${vote.participantId}-${vote.claimId}-${index}`} className={classes}>
            <span className={`vote-pill vote-${vote.vote}`}>{vote.vote}</span>
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

  const verdict = verdictByStatus[result.status];

  return (
    <main className="report-root">
      {/* §00 — Verdict header */}
      <section className="panel header-panel">
        <div className="verdict-row">
          <div className={`verdict-stamp is-${verdict.kind}`} aria-hidden="true">
            <span className="stamp-kind">Verdict</span>
            <span className="stamp-label">{verdict.label}</span>
          </div>
          <div className="verdict-title">
            <p className="eyebrow">§00 · Argue Adjudication</p>
            <h1>
              Result Report
              <span>{verdict.subtitle}</span>
            </h1>
          </div>
        </div>
        <dl className="verdict-meta">
          <div>
            <dt>status</dt>
            <dd>{result.status}</dd>
          </div>
          <div>
            <dt>request id</dt>
            <dd>{result.requestId}</dd>
          </div>
          <div>
            <dt>session id</dt>
            <dd>{result.sessionId}</dd>
          </div>
          <div>
            <dt>elapsed</dt>
            <dd>{formatElapsed(result.metrics.elapsedMs)}</dd>
          </div>
        </dl>
      </section>

      {/* §01 — Conclusion hero */}
      <section className="panel on-dark conclusion-panel">
        <p className="eyebrow on-dark">§01 · The Verdict</p>
        <p className="conclusion-quote">{result.report.finalSummary}</p>
      </section>

      {/* §02 — Representative */}
      <section className="panel representative-panel">
        <header className="section-head">
          <p className="eyebrow">§02 · Representative</p>
        </header>
        <div className="rep-main">
          <h2>{result.representative.participantId}</h2>
          <span className="rep-reason">{result.representative.reason}</span>
          <span className="rep-score">{result.representative.score.toFixed(2)}</span>
        </div>
        <blockquote className="rep-speech">{result.representative.speech}</blockquote>
      </section>

      {/* §03 — Claims */}
      <section className="panel claims-panel">
        <header className="section-head">
          <p className="eyebrow">§03 · Claims</p>
          <p className="subtle">
            {result.finalClaims.length} total · click a row to highlight related judgements and votes
          </p>
        </header>
        <div className="claims-list">
          {result.finalClaims.map((claim, index) => {
            const insight = claimInsights[claim.claimId];
            const isActive = activeClaimId === claim.claimId;
            const participantLinked =
              hoveredParticipantId != null &&
              (claim.proposedBy.includes(hoveredParticipantId) ||
                contributionIndex[hoveredParticipantId]?.claimIds.has(claim.claimId));

            return (
              <article
                className={`claim-row ${isActive ? "is-active" : ""} ${participantLinked ? "link-participant" : ""}`}
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
                <aside className="claim-rail">
                  <span className="claim-index">§03.{formatRomanish(index + 1)}</span>
                  <span className="claim-cid">{claim.claimId}</span>
                  {claim.category ? (
                    <span className={`claim-category cat-${claim.category}`}>{claim.category}</span>
                  ) : null}
                  <span className="claim-proposer">by {claim.proposedBy.join(", ")}</span>
                </aside>
                <div className="claim-body">
                  <h3>{claim.title}</h3>
                  <p className="claim-statement">{claim.statement}</p>
                  <div className="claim-tally">
                    <div>
                      <span>accept</span>
                      <strong>{insight?.votes.accept ?? 0}</strong>
                    </div>
                    <div>
                      <span>reject</span>
                      <strong>{insight?.votes.reject ?? 0}</strong>
                    </div>
                    <div>
                      <span>agree</span>
                      <strong>{insight?.stances.agree ?? 0}</strong>
                    </div>
                    <div>
                      <span>disagree</span>
                      <strong>{insight?.stances.disagree ?? 0}</strong>
                    </div>
                    <div>
                      <span>revise</span>
                      <strong>{insight?.stances.revise ?? 0}</strong>
                    </div>
                  </div>
                  {votesView(claim, result, activeClaimId, hoveredParticipantId)}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* §04 — Scoreboard */}
      <section className="panel">
        <header className="section-head">
          <p className="eyebrow">§04 · Scoreboard</p>
        </header>
        <ol className="score-list">
          {ranked.map((participant, index) => {
            const hovered = participant.participantId === hoveredParticipantId;
            return (
              <li
                className={`score-row ${hovered ? "link-participant" : ""}`}
                key={participant.participantId}
                onMouseEnter={() => setHoveredParticipantId(participant.participantId)}
                onMouseLeave={() => setHoveredParticipantId(null)}
              >
                <span className="score-rank">{index + 1}</span>
                <div className="score-body">
                  <div className="score-main">
                    <h3>{participant.participantId}</h3>
                    <span className="score-total">
                      <span className="score-total-value">{participant.total.toFixed(2)}</span>
                      <span className="score-total-label">total</span>
                    </span>
                  </div>
                  {participant.byRound.length > 0 ? (
                    <div className="score-rounds">
                      {participant.byRound.map((entry) => (
                        <span key={entry.round}>
                          r{entry.round} · {entry.score.toFixed(1)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {participant.breakdown ? (
                    <div className="breakdown-bars">
                      {breakdownOrder.map((label) => {
                        const value = participant.breakdown?.[label] ?? 0;
                        return (
                          <div className="breakdown-row" key={label}>
                            <span>{label}</span>
                            <div className="breakdown-bar-track">
                              <div
                                className="breakdown-bar-fill"
                                style={{ width: `${Math.max(0, Math.min(value, 100))}%` }}
                              />
                            </div>
                            <span className="breakdown-value">{value.toFixed(1)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* §05 — Rounds */}
      <section className="panel">
        <header className="section-head">
          <p className="eyebrow">§05 · Rounds</p>
        </header>
        <div className="rounds-list">
          {result.rounds.map((round) => (
            <details className="round-block" key={round.round}>
              <summary>
                <span className="round-label">Round {round.round}</span>
                <span className="round-meta">{round.outputs.length} outputs</span>
                <span className="round-caret">›</span>
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
                        <h4>{output.participantId}</h4>
                        <div className="output-tags">
                          <span>{output.phase}</span>
                          {output.selfScore != null ? <span>self {output.selfScore.toFixed(1)}</span> : null}
                          <span>r{round.round}</span>
                          {output.respondedAt ? (
                            <span title={output.respondedAt}>{formatTimestamp(output.respondedAt)}</span>
                          ) : null}
                        </div>
                      </header>

                      <p>{output.summary}</p>

                      {output.extractedClaims?.length ? (
                        <div>
                          <h5>Extracted claims</h5>
                          <ul className="stack-list">
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
                        <ul className="stack-list">
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
                          <ul className="inline-list">
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

      {/* §06 — Disagreements (conditional) */}
      {result.disagreements?.length ? (
        <section className="panel diagnostics-panel">
          <header className="section-head">
            <p className="eyebrow">§06 · Disagreements</p>
          </header>
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

      {/* §07 — Eliminations (conditional) */}
      {result.eliminations.length ? (
        <section className="panel diagnostics-panel">
          <header className="section-head">
            <p className="eyebrow">§07 · Eliminations</p>
          </header>
          <ul className="stack-list">
            {result.eliminations.map((item, index) => (
              <li key={`${item.participantId}-${item.round}-${index}`}>
                <strong>{item.participantId}</strong> · round {item.round} · {item.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Action (conditional) */}
      {result.action ? (
        <section className="panel action-panel">
          <header className="section-head">
            <p className="eyebrow">Action</p>
          </header>
          <p>
            <strong>{result.action.actorId}</strong> · {result.action.status}
          </p>
          {result.action.summary ? <p>{result.action.summary}</p> : null}
          {result.action.error ? <p className="error-line">{result.action.error}</p> : null}
        </section>
      ) : null}

      {/* §08 — Metrics */}
      <section className="panel metrics-panel">
        <header className="section-head">
          <p className="eyebrow">§08 · Metrics</p>
        </header>
        <dl className="metrics-grid">
          <div>
            <dt>elapsed</dt>
            <dd>{formatElapsed(result.metrics.elapsedMs)}</dd>
          </div>
          <div>
            <dt>rounds</dt>
            <dd>{result.metrics.totalRounds}</dd>
          </div>
          <div>
            <dt>turns</dt>
            <dd>{result.metrics.totalTurns}</dd>
          </div>
          <div>
            <dt>retries</dt>
            <dd>{result.metrics.retries}</dd>
          </div>
          <div>
            <dt>timeouts</dt>
            <dd>{result.metrics.waitTimeouts}</dd>
          </div>
          <div>
            <dt>early stop</dt>
            <dd>{result.metrics.earlyStopTriggered ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt>deadline hit</dt>
            <dd>{result.metrics.globalDeadlineHit ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt>consensus ratio</dt>
            <dd>
              {result.claimResolutions.length === 0
                ? "0%"
                : `${Math.round((result.claimResolutions.filter((item) => item.status === "resolved").length / result.claimResolutions.length) * 100)}%`}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
