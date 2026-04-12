import type { ClaimLookup } from "../lib/view-model.js";

type ClaimRefProps = {
  claimId: string;
  lookup: ClaimLookup;
  compact?: boolean;
};

/**
 * Hoverable reference to a claim by id. Renders the raw claim id with a
 * dashed underline; on hover or keyboard focus, surfaces a popover with
 * the claim's title, statement, and — when the claim was merged — a
 * compact chain showing the survivor it folded into.
 *
 * The popover is rendered inline as a sibling span so it inherits stacking
 * context from the enclosing round block and doesn't require portal
 * plumbing. Consumers wrap flowing text around `<ClaimRef />` freely.
 */
export function ClaimRef({ claimId, lookup, compact = false }: ClaimRefProps) {
  const info = lookup.describe(claimId);
  const primary = info.claim;
  const survivor = info.survivor;
  const isMerged = primary?.status === "merged";
  const hasDetail = Boolean(primary || survivor);

  return (
    <span className={`claim-ref ${compact ? "is-compact" : ""}`} tabIndex={hasDetail ? 0 : -1}>
      <span className="claim-ref-id mono">{claimId}</span>
      {hasDetail ? (
        <span className="claim-ref-tip" role="tooltip">
          <span className="claim-ref-tip-title">{primary?.title ?? survivor?.title ?? claimId}</span>
          {primary?.statement ? <span className="claim-ref-tip-body">{primary.statement}</span> : null}
          {primary?.category ? <span className="claim-ref-tip-meta">category: {primary.category}</span> : null}
          {isMerged && survivor && survivor.claimId !== claimId ? (
            <span className="claim-ref-tip-chain">
              merged into <span className="mono">{survivor.claimId}</span>
              {survivor.title ? <em> · {survivor.title}</em> : null}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
