import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DeskShell, SecHead } from "@/components/desk-chrome";
import { countPress } from "@/components/desk-chrome-utils";
import { ListSkeleton, ScreenError } from "@/components/states";
import { getSourceInventory } from "@/lib/news/desk";
import { SourceMovesPanel } from "@/components/source-moves";
import type { SourceFilter } from "@/lib/news/source-table";

/*
  THE SOURCE INVENTORY SCREEN.

  The brief's first required outcome is "inventory all accepted source records
  with evidence-backed review status ... purpose/watch versus static reference,
  duplicates/replacement candidates, last check, and what is still unverified",
  and the deliverable is the CSV an editor reads once. This screen is that CSV
  as a page: the same rows, the same review status, so the editor does not have
  to download a file to see what the desk knows.

  IT IS READ-ONLY AND IT DOES NOT CULL. Every row here is a SUGGESTION about what
  to look at -- a quiet source is labelled quiet, a repeatedly unreadable one is
  a replacement CANDIDATE, and nothing is removed. Retirement stays an editor
  action on the Sources screen.

  ONE TABLE, NOT TWO (dynamic sources unit 8, spec 6a/6b). This page used to draw
  the read-only inventory table AND, above it, the ranked source table from
  `source-moves.tsx`. Both listed the same sources with the same facts, and the
  editor had to look in two places. The ranked table is now THE source table:
  it carries the status, the score, the reads, the last lead, the last
  observation and the move buttons, sorts on any column, and the counts strip
  below narrows it. The old table is gone; the counts strip stays because its
  remaining numbers -- unreadable, duplicates, never checked -- are not in the
  ranked table at all.
*/
export const Route = createFileRoute("/desk/inventory")({
  component: InventoryPage,
});

function InventoryPage() {
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["source-inventory"],
    queryFn: () => getSourceInventory(),
  });
  /*
    Spec 6b, the press Scott asked for: "replacement candidates" is no longer a
    number beside a table, it is a control that narrows THE table to the sources
    on trial, highest score first. The filter lives here because the counts
    strip that sets it (below) and the table that reads it are two components.
  */
  const [filter, setFilter] = useState<SourceFilter>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const narrowToTrial = () => {
    setFilter(filter === "trial" ? null : "trial");
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (isPending) return <ListSkeleton rows={8} />;
  if (error) return <ScreenError message="The source inventory could not be loaded." onRetry={() => void refetch()} />;

  const counts = data?.counts;

  return (
    <DeskShell
      title="Source inventory"
      kicker="What the desk knows about every source it watches"
      hideTitle
    >
      {/* Dynamic sources unit 8 (D169): the ranked table, the chips, the
          clickable trial list, and every button with its own progress. */}
      <div ref={tableRef}>
        <SourceMovesPanel filter={filter} onFilter={setFilter} />
      </div>
      <SecHead
        title="What still needs a look"
        count={(counts?.unreadable ?? 0) + (counts?.duplicates ?? 0) + (counts?.neverChecked ?? 0)}
        sub="Read-only numbers about the whole watch list. The table above is where a source is moved."
      />
      <div className="flex flex-wrap gap-6 py-3">
        <span>{counts?.unreadable ?? 0} could not be read</span>
        <button
          type="button"
          className={countPress + (filter === "trial" ? " font-bold" : "")}
          aria-pressed={filter === "trial"}
          onClick={narrowToTrial}
        >
          {counts?.replacementCandidates ?? 0} replacement candidates
        </button>
        <span>{counts?.duplicates ?? 0} duplicate addresses</span>
        <span>{counts?.neverChecked ?? 0} never checked</span>
        {filter ? (
          <button type="button" className="underline" onClick={() => setFilter(null)}>
            Show all
          </button>
        ) : null}
      </div>
    </DeskShell>
  );
}
