import { useMemo, useState } from "preact/hooks";
import type { ArgueResult, Claim } from "@onevcat/argue";
import {
  buildClaimInsights,
  buildClaimLookup,
  buildContributionIndex,
  computeExtractedClaimIds,
  formatDebateDate,
  formatElapsed,
  formatTimestamp,
  nameRound,
  rankScoreboard
} from "../lib/view-model.js";
import { ClaimRef } from "./ClaimRef.js";

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

type ConfidenceBand = "high" | "med" | "low";
function confidenceBand(value: number): ConfidenceBand {
  if (value >= 0.8) return "high";
  if (value >= 0.5) return "med";
  return "low";
}

function ConfidenceChip({ value }: { value: number }) {
  const band = confidenceBand(value);
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className={`confidence-chip conf-${band}`} title={`confidence ${value.toFixed(2)}`}>
      <span className="confidence-bar" aria-hidden="true">
        <span className="confidence-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="confidence-value mono">{value.toFixed(2)}</span>
    </span>
  );
}

function StanceChip({ stance }: { stance: "agree" | "disagree" | "revise" }) {
  return <span className={`stance-chip stance-${stance}`}>{stance}</span>;
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
  const claimLookup = useMemo(() => buildClaimLookup(result), [result]);
  const ranked = useMemo(() => rankScoreboard(result.scoreboard), [result.scoreboard]);
  const activeClaims = useMemo(() => result.finalClaims.filter((claim) => claim.status !== "merged"), [result]);
  const debateDate = useMemo(() => formatDebateDate(result), [result]);

  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [hoveredParticipantId, setHoveredParticipantId] = useState<string | null>(null);

  const toggleClaim = (claimId: string) => {
    setActiveClaimId((current) => (current === claimId ? null : claimId));
  };

  const verdict = verdictByStatus[result.status];

  // Compute contiguous section numbers at render time so conditional
  // panels (disagreements / eliminations / action) don't punch gaps in
  // the numbering readers scan for. Each section registers a key and
  // the counter only advances when the panel actually renders.
  const sectionNumbers: Record<string, string> = {};
  let sectionCounter = 0;
  const assignSection = (key: string) => {
    sectionNumbers[key] = sectionCounter.toString().padStart(2, "0");
    sectionCounter += 1;
  };
  assignSection("verdict");
  assignSection("conclusion");
  assignSection("representative");
  assignSection("claims");
  assignSection("scoreboard");
  assignSection("rounds");
  if (result.disagreements && result.disagreements.length > 0) {
    assignSection("disagreements");
  }
  if (result.eliminations.length > 0) {
    assignSection("eliminations");
  }
  if (result.action) {
    assignSection("action");
  }
  assignSection("metrics");

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
            <p className="eyebrow">§{sectionNumbers.verdict} · Argue Adjudication · Result Report</p>
            <h1 className="task-headline">{result.task.title}</h1>
            <p className="verdict-subtitle">{verdict.subtitle}</p>
            <details className="task-prompt">
              <summary>Full task prompt</summary>
              <p>{result.task.prompt}</p>
            </details>
          </div>
        </div>
        <dl className="verdict-meta">
          <div>
            <dt>status</dt>
            <dd>{result.status}</dd>
          </div>
          {debateDate ? (
            <div>
              <dt>date</dt>
              <dd>{debateDate}</dd>
            </div>
          ) : null}
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
      <section className="panel conclusion-panel">
        <p className="eyebrow">§{sectionNumbers.conclusion} · The Verdict</p>
        <p className="conclusion-quote">{result.report.finalSummary}</p>
      </section>

      {/* §02 — Representative */}
      <section className="panel representative-panel">
        <header className="section-head">
          <p className="eyebrow">§{sectionNumbers.representative} · Representative</p>
        </header>
        <div className="rep-main">
          <h2>{result.representative.participantId}</h2>
          <span className="rep-reason">{result.representative.reason}</span>
          <span className="rep-score">{result.representative.score.toFixed(2)}</span>
        </div>
        <blockquote className="rep-speech">{result.representative.speech}</blockquote>
      </section>

      {/* §03 — Claims (merged claims are excluded — they still appear in §05 Rounds merge chains) */}
      <section className="panel claims-panel">
        <header className="section-head">
          <p className="eyebrow">§{sectionNumbers.claims} · Claims</p>
        </header>
        <div className="claims-list">
          {activeClaims.map((claim, index) => {
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
          <p className="eyebrow">§{sectionNumbers.scoreboard} · Scoreboard</p>
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
          <p className="eyebrow">§{sectionNumbers.rounds} · Rounds</p>
        </header>
        <div className="rounds-list">
          {result.rounds.map((round) => {
            const extractedIds = computeExtractedClaimIds(round);
            const mergesInRound = round.outputs.flatMap((output) =>
              output.judgements
                .filter((judgement) => judgement.mergesWith)
                .map((judgement) => ({
                  participantId: output.participantId,
                  sourceClaimId: judgement.claimId,
                  targetClaimId: judgement.mergesWith!
                }))
            );
            return (
              <details className="round-block" key={round.round}>
                <summary>
                  <span className="round-label">{nameRound(round, result.rounds)}</span>
                  <span className="round-meta">{round.outputs.length} outputs</span>
                  <span className="round-caret">›</span>
                </summary>
                <div className="round-details">
                  {mergesInRound.length > 0 ? (
                    <div className="round-merges">
                      <h5>Merges</h5>
                      <ul className="merge-list">
                        {mergesInRound.map((merge, mergeIndex) => (
                          <li className="merge-row" key={`${merge.sourceClaimId}-${merge.targetClaimId}-${mergeIndex}`}>
                            <ClaimRef claimId={merge.sourceClaimId} lookup={claimLookup} compact />
                            <span className="merge-arrow" aria-hidden="true">
                              ⟶
                            </span>
                            <ClaimRef claimId={merge.targetClaimId} lookup={claimLookup} compact />
                            <span className="merge-author mono">by {merge.participantId}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

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
                              {output.extractedClaims.map((item, claimIndex) => {
                                const resolvedId = extractedIds[`${outputIndex}:${claimIndex}`] ?? item.claimId;
                                return (
                                  <li key={`${item.title}-${claimIndex}`}>
                                    {resolvedId ? (
                                      <span className="claim-chip mono">{resolvedId}</span>
                                    ) : (
                                      <span className="claim-chip is-new mono">NEW</span>
                                    )}
                                    <span className="claim-chip-title">{item.title}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}

                        <div>
                          <h5>Judgements</h5>
                          <ul className="stack-list">
                            {output.judgements.map((item, judgementIndex) => {
                              const claimLinked = activeClaimId === item.claimId;
                              return (
                                <li
                                  className={`judgement-row ${claimLinked ? "link-claim" : ""}`}
                                  key={`${item.claimId}-${judgementIndex}`}
                                >
                                  <ClaimRef claimId={item.claimId} lookup={claimLookup} />
                                  <StanceChip stance={item.stance} />
                                  <ConfidenceChip value={item.confidence} />
                                  {item.mergesWith ? (
                                    <span className="judgement-merge">
                                      <span className="merge-arrow" aria-hidden="true">
                                        ⟶
                                      </span>
                                      <ClaimRef claimId={item.mergesWith} lookup={claimLookup} compact />
                                    </span>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </div>

                        {output.phase === "final_vote" ? (
                          <div>
                            <h5>Votes</h5>
                            <ul className="inline-list vote-list">
                              {output.claimVotes.map((vote, voteIndex) => {
                                const claimLinked = activeClaimId === vote.claimId;
                                return (
                                  <li
                                    className={`vote-row ${claimLinked ? "link-claim" : ""}`}
                                    key={`${vote.claimId}-${voteIndex}`}
                                  >
                                    <ClaimRef claimId={vote.claimId} lookup={claimLookup} compact />
                                    <span className={`vote-pill vote-${vote.vote}`}>{vote.vote}</span>
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
            );
          })}
        </div>
      </section>

      {/* §06 — Disagreements (conditional) */}
      {result.disagreements?.length ? (
        <section className="panel diagnostics-panel">
          <header className="section-head">
            <p className="eyebrow">§{sectionNumbers.disagreements} · Disagreements</p>
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
            <p className="eyebrow">§{sectionNumbers.eliminations} · Eliminations</p>
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
            <p className="eyebrow">§{sectionNumbers.action} · Action</p>
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
          <p className="eyebrow">§{sectionNumbers.metrics} · Metrics</p>
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
