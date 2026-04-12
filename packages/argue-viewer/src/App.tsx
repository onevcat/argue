import { useState } from "preact/hooks";
import type { ArgueResult } from "@onevcat/argue";
import { FileIngress } from "./components/FileIngress.js";
import { ReportView } from "./components/ReportView.js";
import { validateArgueResult } from "./lib/validate.js";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; source: string }
  | { kind: "loaded"; source: string; result: ArgueResult }
  | { kind: "error"; source: string; error: string };

export function App() {
  const [state, setState] = useState<ViewState>({ kind: "idle" });

  const loadText = (text: string, source: string) => {
    if (!text.trim()) {
      setState({ kind: "error", source, error: "Input is empty." });
      return;
    }

    setState({ kind: "loading", source });

    queueMicrotask(() => {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid JSON syntax.";
        setState({ kind: "error", source, error: `Cannot parse JSON: ${message}` });
        return;
      }

      const validation = validateArgueResult(raw);
      if (!validation.ok) {
        setState({ kind: "error", source, error: validation.error });
        return;
      }

      setState({ kind: "loaded", source, result: validation.data });
    });
  };

  return (
    <div className="app-shell">
      <FileIngress loading={state.kind === "loading"} onLoadText={loadText} />

      {state.kind === "idle" ? (
        <section className="state-panel">
          <h2>No Result Loaded</h2>
          <p>Load an argue result JSON file to render a stable report page.</p>
        </section>
      ) : null}

      {state.kind === "loading" ? (
        <section className="state-panel loading">
          <h2>Loading</h2>
          <p>Reading {state.source} and validating schema...</p>
        </section>
      ) : null}

      {state.kind === "error" ? (
        <section className="state-panel error">
          <h2>Validation Error</h2>
          <p>
            source: <strong>{state.source}</strong>
          </p>
          <p>{state.error}</p>
        </section>
      ) : null}

      {state.kind === "loaded" ? (
        <>
          <p className="source-note">
            source: <span className="mono">{state.source}</span>
          </p>
          <ReportView result={state.result} />
        </>
      ) : null}
    </div>
  );
}
