import type { ReportingPackage } from "@/lib/news/civic-reporting";
import { reportingRunSummary } from "@/lib/news/reporting-run-summary";

/** The reporting result shown before the story and its source ledgers. */
export function ReportingRunSummary({
  report,
  methodDetails,
}: {
  report: ReportingPackage;
  methodDetails: string;
}) {
  const summary = reportingRunSummary(report);
  return (
    <>
      <section
        className={`reporting-run reporting-run-${summary.tone} text-base`}
        role="status"
        aria-label="Reporting result"
      >
        <strong>{summary.label}</strong>
        <dl className="mt-2 space-y-2">
          <div>
            <dt className="font-semibold">What was read</dt>
            <dd>{summary.read}</dd>
          </div>
          <div>
            <dt className="font-semibold">What was established</dt>
            <dd>{summary.established}</dd>
          </div>
          <div>
            <dt className="font-semibold">What still needs checking</dt>
            <dd>{summary.stillToCheck}</dd>
          </div>
          <div>
            <dt className="font-semibold">Next action</dt>
            <dd>{summary.nextAction}</dd>
          </div>
        </dl>
      </section>
      <details className="reporting-run-details text-base">
        <summary className="cursor-pointer font-medium">Technical run details</summary>
        <div className="mt-2 space-y-2">
          <p>{methodDetails}</p>
          <p>{report.runNote || "No technical run note was saved."}</p>
        </div>
      </details>
    </>
  );
}
