import type { ArgueResult } from "@onevcat/argue";
import type { JSX } from "preact";
import { ReportView } from "./ReportView.js";

type ReportLayoutProps = {
  result: ArgueResult;
  onReset: () => void;
};

export function ReportLayout({ result, onReset }: ReportLayoutProps) {
  const handleHomeClick = (event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
    // Let the browser handle modified clicks (cmd/ctrl/middle/shift) so the
    // anchor can still open `/` in a new tab. Hijack only the plain left click
    // for SPA navigation.
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onReset();
  };

  return (
    <div className="report-layout">
      <header className="report-header">
        <a className="report-header-link" href="/" onClick={handleHomeClick} aria-label="Argue — back to home">
          <span className="report-header-mark" aria-hidden="true" />
          <span className="report-header-wordmark">Argue</span>
        </a>
      </header>

      <ReportView result={result} />

      <div className="report-reset">
        <button type="button" onClick={onReset}>
          ← Check Another Report
        </button>
      </div>
    </div>
  );
}
