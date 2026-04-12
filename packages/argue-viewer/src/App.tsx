import { useState } from "preact/hooks";
import type { ArgueResult } from "@onevcat/argue";
import { Landing } from "./components/Landing.js";
import { ReportLayout } from "./components/ReportLayout.js";
import { SiteFooter } from "./components/SiteFooter.js";
import { validateArgueResult } from "./lib/validate.js";

type ViewState =
  | { kind: "idle" }
  | { kind: "loaded"; source: string; result: ArgueResult }
  | { kind: "error"; source: string; error: string };

export function App() {
  const [state, setState] = useState<ViewState>({ kind: "idle" });

  const loadText = (text: string, source: string) => {
    if (!text.trim()) {
      setState({ kind: "error", source, error: "Input is empty." });
      return;
    }

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
  };

  const handleReadError = (source: string, error: string) => {
    setState({ kind: "error", source, error });
  };

  const reset = () => {
    setState({ kind: "idle" });
  };

  const shellClass = `app-shell is-${state.kind === "loaded" ? "report" : "landing"}`;

  return (
    <div className={shellClass}>
      {state.kind === "loaded" ? (
        <ReportLayout result={state.result} onReset={reset} />
      ) : (
        <Landing
          error={state.kind === "error" ? { source: state.source, message: state.error } : null}
          onLoadText={loadText}
          onReadError={handleReadError}
        />
      )}

      <SiteFooter />
    </div>
  );
}
