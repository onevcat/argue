import type { ArgueResult } from "@onevcat/argue";
import { ReportView } from "./ReportView.js";

type ReportLayoutProps = {
  result: ArgueResult;
  onReset: () => void;
};

export function ReportLayout({ result, onReset }: ReportLayoutProps) {
  return (
    <div className="report-layout">
      <header className="report-header">
        <span className="report-header-mark" aria-hidden="true" />
        <span className="report-header-wordmark">Argue</span>
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
