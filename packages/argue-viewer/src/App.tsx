import { useEffect, useRef, useState } from "preact/hooks";
import type { ArgueResult } from "@onevcat/argue";
import { Landing } from "./components/Landing.js";
import { ReportLayout } from "./components/ReportLayout.js";
import { SiteFooter } from "./components/SiteFooter.js";
import { decodeHashPayload } from "./lib/decode-hash.js";
import { validateArgueResult } from "./lib/validate.js";

const EXAMPLE_URL = "examples/spaces-vs-tabs.json";
const EXAMPLE_SOURCE = "example:spaces-vs-tabs";

type Route = "home" | "example" | "report";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading-example" }
  | { kind: "loaded"; source: string; result: ArgueResult }
  | { kind: "error"; source: string; error: string };

type CachedReport = { source: string; result: ArgueResult };

function routeFromPath(pathname: string): Route {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/example") return "example";
  if (normalized === "/report") return "report";
  return "home";
}

function pathFromRoute(route: Route): string {
  switch (route) {
    case "example":
      return "/example";
    case "report":
      return "/report";
    case "home":
    default:
      return "/";
  }
}

function pushRoute(route: Route) {
  if (typeof window === "undefined") return;
  const target = pathFromRoute(route);
  if (window.location.pathname !== target) {
    window.history.pushState(null, "", target);
  }
}

function replaceRoute(route: Route) {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", pathFromRoute(route));
}

export function App() {
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const reportCacheRef = useRef<CachedReport | null>(null);
  const exampleCacheRef = useRef<CachedReport | null>(null);
  const fetchGenRef = useRef(0);

  // Parse + validate JSON text and update state. Returns the parsed
  // result on success so the caller can cache it per-route.
  const applyText = (text: string, source: string): ArgueResult | null => {
    if (!text.trim()) {
      setState({ kind: "error", source, error: "Input is empty." });
      return null;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON syntax.";
      setState({ kind: "error", source, error: `Cannot parse JSON: ${message}` });
      return null;
    }
    const validation = validateArgueResult(raw);
    if (!validation.ok) {
      setState({ kind: "error", source, error: validation.error });
      return null;
    }
    setState({ kind: "loaded", source, result: validation.data });
    return validation.data;
  };

  const fetchExampleText = async (): Promise<{ text: string } | { error: string }> => {
    try {
      const response = await fetch(EXAMPLE_URL, { cache: "no-cache" });
      if (!response.ok) {
        return { error: `Failed to load example: HTTP ${response.status}` };
      }
      const text = await response.text();
      return { text };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown fetch error.";
      return { error: `Failed to load example: ${message}` };
    }
  };

  const showExample = async (pushHistory: boolean) => {
    if (pushHistory) {
      pushRoute("example");
    }
    if (exampleCacheRef.current) {
      const cached = exampleCacheRef.current;
      setState({ kind: "loaded", source: cached.source, result: cached.result });
      return;
    }
    const gen = ++fetchGenRef.current;
    setState({ kind: "loading-example" });
    const outcome = await fetchExampleText();
    // Ignore stale fetches — user may have navigated away mid-request.
    if (gen !== fetchGenRef.current) return;
    if ("error" in outcome) {
      setState({ kind: "error", source: EXAMPLE_SOURCE, error: outcome.error });
      return;
    }
    const result = applyText(outcome.text, EXAMPLE_SOURCE);
    if (result) {
      exampleCacheRef.current = { source: EXAMPLE_SOURCE, result };
    }
  };

  const loadText = (text: string, source: string) => {
    pushRoute("report");
    const result = applyText(text, source);
    if (result) {
      reportCacheRef.current = { source, result };
    }
  };

  const handleReadError = (source: string, error: string) => {
    setState({ kind: "error", source, error });
  };

  const reset = () => {
    pushRoute("home");
    setState({ kind: "idle" });
  };

  useEffect(() => {
    const consumeHash = async (): Promise<boolean> => {
      // Snapshot the hash so concurrent navigation cannot desync the decoded
      // payload from the URL we eventually strip.
      const capturedHash = window.location.hash;

      try {
        const decoded = await decodeHashPayload(capturedHash);
        if (!decoded) return false;
        pushRoute("report");
        const result = applyText(decoded, "hash");
        if (result) {
          reportCacheRef.current = { source: "hash", result };
        }
        // Strip the hash — it was a one-shot delivery mechanism, not a persistent route.
        const cleanPath = window.location.pathname + window.location.search;
        window.history.replaceState(null, "", cleanPath || "/");
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to decode report hash.";
        setState({ kind: "error", source: "hash", error: message });
        const cleanPath = window.location.pathname + window.location.search;
        window.history.replaceState(null, "", cleanPath || "/");
        return true;
      }
    };

    const syncFromPath = () => {
      const route = routeFromPath(window.location.pathname);
      if (route === "home") {
        setState({ kind: "idle" });
        return;
      }
      if (route === "example") {
        void showExample(false);
        return;
      }
      // route === "report"
      const cached = reportCacheRef.current;
      if (cached) {
        setState({ kind: "loaded", source: cached.source, result: cached.result });
        return;
      }
      replaceRoute("home");
      setState({ kind: "idle" });
    };

    if (window.location.hash && window.location.hash !== "#") {
      // Hash present: go async to decode it. No need to call syncFromPath —
      // consumeHash will either load the report or surface an error.
      void consumeHash();
    } else {
      syncFromPath();
    }

    const onPopState = () => {
      void (async () => {
        const consumed = await consumeHash();
        if (!consumed) syncFromPath();
      })();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const shellClass = `app-shell is-${state.kind === "loaded" ? "report" : "landing"}`;

  return (
    <div className={shellClass}>
      {state.kind === "loaded" ? (
        <ReportLayout result={state.result} onReset={reset} />
      ) : (
        <Landing
          error={state.kind === "error" ? { source: state.source, message: state.error } : null}
          loadingExample={state.kind === "loading-example"}
          onLoadText={loadText}
          onReadError={handleReadError}
          onOpenExample={() => showExample(true)}
        />
      )}

      <SiteFooter />
    </div>
  );
}
