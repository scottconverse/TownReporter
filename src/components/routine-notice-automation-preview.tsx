export type RoutineNoticePreviewSource = {
  sourceId: number;
  formatKey: string;
  issuer: string;
  locality: string;
  publicSourceUrl: string;
};

export function RoutineNoticeAutomationPreview({
  sources,
}: {
  sources: RoutineNoticePreviewSource[];
}) {
  return (
    <div className="mt-4 border border-rule p-4 text-sm">
      <p className="font-medium">Publication settings preview</p>
      {sources.length ? (
        <ul className="mt-1 list-disc pl-5">
          {sources.map((source) => (
            <li key={`${source.sourceId}:${source.formatKey}`}>
              {source.issuer || "Issuer required"} · {source.locality || "Locality required"} · {source.formatKey} ·{" "}
              Source: <span className="break-all">{source.publicSourceUrl || "public URL required"}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-muted">Select a source to preview its exact attribution.</p>
      )}
      <p className="mt-2">Today uses events and services on the newsroom-local date.</p>
      <p>This weekend publishes Friday for Friday–Sunday logistics.</p>
      <p>Deadlines approaching includes only new or changed deadlines in the next seven days.</p>
    </div>
  );
}
