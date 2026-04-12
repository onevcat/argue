# Argue Viewer Design

## Visual Direction

Argue Viewer uses an editorial report aesthetic rather than a dashboard-heavy AI style.

- Tone: calm, analytical, and human-readable under long-form content.
- Layout: paper-like report panels on a textured, low-contrast gradient background.
- Motion: subtle hover and focus transitions with restrained timing.
- Emphasis strategy: color + shape + spacing first, animation second.

## Information Architecture

Single-page application with two vertical zones:

1. Ingress strip
   - Drag-and-drop target
   - File picker
   - Paste input + load action
   - Parse status messaging
2. Report body
   - Header summary
   - Core analysis sections
   - Supporting diagnostics and metrics

Section order intentionally follows decision flow:

1. Header
2. Conclusion
3. Representative
4. Claims
5. Scoreboard
6. Rounds
7. Disagreements (conditional)
8. Eliminations (conditional)
9. Action (conditional)
10. Metrics footer

## Interaction Model

- File ingestion supports drag-drop, file picker, and paste text.
- Parsed result is validated with `ArgueResultSchema` and `ARGUE_RESULT_VERSION`.
- Claim card click toggles active claim context.
- Active claim context highlights related judgements and votes across sections.
- Scoreboard row hover highlights the participant's related contributions.
- Rounds are collapsed by default and can be expanded per round.
- Loading, empty, and error states are first-class and stable.

## Component Map

- `App`
  - State machine for `idle | loading | loaded | error`
  - Parse + validation orchestration
- `FileIngress`
  - Drag/drop behaviors
  - File picker
  - Paste area
- `ReportView`
  - Header
  - Conclusion
  - Representative
  - Claims panel
  - Scoreboard panel
  - Rounds panel
  - Disagreements panel
  - Eliminations panel
  - Action panel
  - Metrics footer
- `lib/validate.ts`
  - JSON and schema guardrail
- `lib/view-model.ts`
  - Deterministic computed data used by UI

## Color & Typography Tokens

Color tokens:

- `--bg-0`: page background deep green-black
- `--bg-1`: warm neutral paper
- `--bg-2`: dark panel
- `--fg-0`: primary text
- `--fg-1`: secondary text
- `--accent-0`: amber signal
- `--accent-1`: cyan-teal signal
- `--ok`: consensus-like status
- `--warn`: partial/unresolved status
- `--bad`: failure/reject status

Typography tokens:

- Display: `Fraunces`
- UI/body: `Manrope`
- Mono: `JetBrains Mono`

## Explicit Non-Goals

- No CLI integration in this package.
- No timeline charting or advanced visualization libraries.
- No remote upload, sync, or persistence.
- No schema migration beyond strict version gating.
- No dark/light theme switch in v0.

## Design Improvement Cycles

### Cycle 1

Skill input:

- `/i-critique` (hierarchy/linkage/discoverability)

Critique:

- Initial hierarchy was readable but claim-to-round linkage did not stand out enough.
- Hover affordance around participant contribution was weak on dense lists.

Fixes:

- Added explicit visual markers for active claim in cards and linked list items.
- Added participant hover tint across claims, rounds, and disagreements.
- Implemented in `src/components/ReportView.tsx` and `src/styles/app.css` (`link-claim`, `link-participant`, active claim card states).

Re-check:

- Confirmed claim click makes related judgements and votes immediately discoverable.
- Confirmed participant hover gives stable cross-section tracking without jitter.

### Cycle 2

Skill input:

- `/i-clarify` (state copy clarity)
- `/i-colorize` (status/affordance emphasis)

Critique:

- Header metadata felt too compact relative to conclusion importance.
- Empty/loading/error states lacked enough narrative guidance.

Fixes:

- Promoted report header with stronger status chip and metadata grid.
- Added dedicated state panels with clear next actions.
- Implemented in `src/App.tsx` and `src/components/ReportView.tsx` header/state sections.

Re-check:

- Confirmed state transitions remain deterministic and messages stay actionable.
- Confirmed header now anchors scan order before detail sections.

### Cycle 3

Skill input:

- `/i-normalize` (consistency pass)
- `/i-adapt` (dense layout readability)

Critique:

- Scoreboard density was high; score breakdown comparability needed clearer visual scaffolding.
- Round details needed better separators for long debates.

Fixes:

- Added compact inline breakdown bars and clearer rank emphasis.
- Added stronger card segmentation and monospaced metadata tags inside rounds.
- Implemented in `src/components/ReportView.tsx` and `src/styles/app.css` (`breakdown-bars`, `rank-cell`, round output tags).

Re-check:

- Confirmed ranking and score components are quickly comparable.
- Confirmed expanded rounds remain legible under large payloads.

### Final Polish

Skill input:

- `/i-polish`

- Tuned spacing rhythm and transition durations for consistency.
- Balanced accent usage to avoid over-highlighting.
- Verified mobile layout keeps section reading order and interaction parity.
- Added clipboard ingestion fallback and clearer error copy in `src/components/FileIngress.tsx`.
- Added keyboard toggle/focus visibility for claim cards and reduced-motion CSS fallback.
