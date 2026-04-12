# argue result viewer v0 plan

## 1. Goal

Provide a human-friendly way to view `result.json` files produced by argue runs.

Two usage modes:

1. **Online viewer** — anyone can open the page, drag-and-drop a `result.json`, and see a rendered report. No installation required.
2. **CLI integration (phase 2)** — `argue view result.json` opens a local preview or exports a self-contained HTML file.

## 2. Package

New workspace package: `packages/argue-viewer` (`@onevcat/argue-viewer`).

- Lives in the existing monorepo, same `npm install` / workspace conventions.
- Not published to npm — it is a deployable application, not a library.
- Depends on `@onevcat/argue` for `ArgueResultSchema`, `ARGUE_RESULT_VERSION`, and TypeScript types.

## 3. Tech stack

| Layer             | Choice                                                                                             | Rationale                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework         | **Preact** + preact/signals                                                                        | Tiny runtime (~4 KB), React-compatible API, enough component model for future interactive features (timeline, animations, collapsible panels) |
| Build             | **Vite**                                                                                           | Fast dev loop, tree-shaking, single `dist/` output                                                                                            |
| Styling           | **CSS Modules** or **vanilla-extract**                                                             | Scoped styles, zero runtime cost, easy to extend                                                                                              |
| Animation         | **CSS transitions** initially; add **Motion One** or **Framer Motion (preact-compat)** when needed | Keep bundle small at v0, upgrade path is clear                                                                                                |
| Schema validation | `ArgueResultSchema.safeParse()` from `@onevcat/argue`                                              | Single source of truth, catches version mismatches at load time                                                                               |

### Why Preact over Vanilla TS

The viewer will evolve toward richer interactions — debate timeline visualization, claim merge animations, stance shift charts, collapsible round details. A component model pays off quickly once any of these land. Preact keeps the cost near-zero while providing the same ergonomics as React.

## 4. Result version contract

The `resultVersion` field (added in this iteration) is the viewer's compatibility gate:

- Viewer declares which versions it supports (initially just `1`).
- On file load: `ArgueResultSchema.safeParse(json)` validates structure.
- **Missing `resultVersion` is tolerated** and treated as version `1`, so result artifacts generated before the version field existed still load cleanly. Any explicitly set version must still match the current one.
- If `resultVersion` is explicitly set to an unsupported value → clear error message with the version mismatch details.
- Future schema changes bump `ARGUE_RESULT_VERSION`; viewer adds migration or multi-version support as needed.

## 5. Features (v0)

### 5.1 File input

- Drag-and-drop zone (full-page drop target).
- File picker button as fallback.
- Paste JSON from clipboard.
- All processing is client-side — JSON never leaves the browser.

### 5.2 Rendered sections

Map to the existing information hierarchy in `buildResultSummary` (artifacts.ts) and `printVerboseResult` (output.ts), but with richer presentation:

| Section            | Content                                                                                       | Notes                                   |
| ------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Header**         | Status badge, requestId, sessionId, elapsed time                                              | Color-coded status                      |
| **Conclusion**     | `report.finalSummary`                                                                         | Prominent, top of page                  |
| **Representative** | participantId, score, speech                                                                  | Highlighted card                        |
| **Claims**         | Card per active claim: title, statement, category, proposedBy, vote results, stance breakdown | Merged claims shown dimmed or collapsed |
| **Scoreboard**     | Ranked participant table: total, per-round scores, breakdown dimensions                       | Bar chart or simple table               |
| **Rounds**         | Collapsible per-round detail: each participant's summary, judgements, extracted claims        | Collapsed by default                    |
| **Disagreements**  | List with claimId, participant, reason                                                        | Only shown when present                 |
| **Eliminations**   | List with participant, round, reason                                                          | Only shown when present                 |
| **Action**         | Actor, status, summary, error                                                                 | Only shown when present                 |
| **Metrics**        | Elapsed, rounds, turns, retries, timeouts, early stop, deadline                               | Footer-style                            |

### 5.3 Interactions (v0 scope)

- Expand/collapse round details.
- Click a claim card to highlight related votes and judgements.
- Hover scoreboard row to highlight that participant's contributions.

### 5.4 Future interactions (post-v0, informing architecture)

These are not in v0 scope but the component architecture should not block them:

- Animated debate timeline (rounds as a horizontal axis, stances shifting over time).
- Claim lifecycle visualization (proposed → debated → merged / voted).
- Opinion shift animation (Sankey or flow diagram).
- Side-by-side participant comparison.
- Share via URL with embedded JSON (base64 or compressed hash fragment).

## 6. Directory structure

```
packages/argue-viewer/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx              # mount point
    ├── app.tsx               # top-level state: idle → loading → loaded | error
    ├── validate.ts           # safeParse + version check
    ├── components/
    │   ├── drop-zone.tsx     # file input UI
    │   ├── result-view.tsx   # orchestrates all sections
    │   ├── header.tsx
    │   ├── conclusion.tsx
    │   ├── claims.tsx
    │   ├── scoreboard.tsx
    │   ├── rounds.tsx
    │   ├── disagreements.tsx
    │   ├── eliminations.tsx
    │   ├── action.tsx
    │   └── metrics.tsx
    └── styles/
        ├── global.css
        └── *.module.css
```

## 7. Dependency wiring

```jsonc
// packages/argue-viewer/package.json
{
  "name": "@onevcat/argue-viewer",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "check": "tsc --noEmit"
  },
  "dependencies": {
    "preact": "^10.x"
  },
  "devDependencies": {
    "@onevcat/argue": "workspace:*",
    "@preact/preset-vite": "^2.x",
    "typescript": "^5.x",
    "vite": "^6.x"
  }
}
```

Notes:

- `@onevcat/argue` is a **devDependency** — Vite tree-shakes only the schema/type code into the bundle. The viewer is not published, so dev vs prod distinction is only about the build.
- `workspace:*` is fine here because `argue-viewer` is never published to npm (it is `"private": true`). The dependency rule in CLAUDE.md about avoiding `workspace:` applies only to `argue-cli` which must be installable outside the repo.

## 8. Build output

`vite build` → `packages/argue-viewer/dist/`

- `index.html` + hashed JS/CSS assets.
- Fully static, no server runtime.
- Deployable to Netlify, GitHub Pages, Cloudflare Pages, Vercel, or any static host via simple directory upload.
- Base path configurable via `vite.config.ts` `base` option at build time.

## 9. Development workflow

```bash
# from repo root
npm install
npm run -w packages/argue-viewer dev    # starts Vite dev server on localhost
```

Add to root `package.json` scripts:

```jsonc
"dev:viewer": "npm run -w packages/argue-viewer dev"
```

## 10. CLI integration (phase 2, out of v0 scope)

Two possible commands in `argue-cli`:

- `argue view <result.json>` — starts a local Vite preview server or opens the online viewer URL with the file.
- `argue view --export <result.json> -o report.html` — bundles the viewer + JSON into a single self-contained HTML file (Vite library mode or inline script).

This phase depends on v0 viewer being stable. Implementation details deferred.

## 11. Deployment (deferred)

Deployment target is intentionally not decided yet. The build output is a static SPA directory, compatible with any static hosting. Candidate options:

- Netlify (drag-and-drop deploy or git integration)
- GitHub Pages (Actions workflow)
- Cloudflare Pages

Decision will be made after v0 is functional.

## 12. Implementation order

1. Scaffold `packages/argue-viewer` with Vite + Preact + TypeScript.
2. Implement `validate.ts` — schema parse + version check.
3. Implement `drop-zone.tsx` — file input with drag-and-drop.
4. Implement `result-view.tsx` + section components — render all ArgueResult data.
5. Styling pass — clean, readable layout.
6. Wire into workspace scripts, verify `npm run ci` still passes.
7. Manual test with real result JSON files.
8. Deploy (separate step, outside v0 scope).
