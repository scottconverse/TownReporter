import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DeskShell, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, ScreenError } from "@/components/states";
import { getSourceInventory } from "@/lib/news/desk";

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

  WHY A NEW ROUTE AND NOT A PANEL ON /desk/sources. That screen is owned by the
  editor-workflow worker alongside `desk.ts`; adding here keeps the two from
  colliding. `/desk/inventory` renders inside the same desk shell.
*/
export const Route = createFileRoute("/desk/inventory")({
  component: InventoryPage,
});

function InventoryPage() {
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["source-inventory"],
    queryFn: () => getSourceInventory(),
  });

  if (isPending) return <ListSkeleton rows={8} />;
  if (error) return <ScreenError message="The source inventory could not be loaded." onRetry={() => void refetch()} />;

  const rows = data?.rows ?? [];
  const counts = data?.counts;

  return (
    <DeskShell
      title="Source inventory"
      kicker="What the desk knows about every source it watches"
      hideTitle
    >
      <SecHead
        title="Source inventory"
        count={data?.total ?? 0}
        sub="Read-only. Nothing here is removed; a suggestion is for the editor to decide."
      />
      <div className="flex flex-wrap gap-6 py-3 text-sm">
        <span>{counts?.unreadable ?? 0} could not be read</span>
        <span>{counts?.replacementCandidates ?? 0} replacement candidates</span>
        <span>{counts?.duplicates ?? 0} duplicate addresses</span>
        <span>{counts?.neverChecked ?? 0} never checked</span>
      </div>
      <div className="overflow-x-auto">
        <table className="source-inventory w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink text-left">
              <th className="p-2">Source</th>
              <th className="p-2">Purpose</th>
              <th className="p-2">Last observation</th>
              <th className="p-2">Review</th>
              <th className="p-2">Last read</th>
              <th className="p-2">Still unverified</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-rule align-top">
                <td className="p-2" data-label="Source">
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted"
                  >
                    {row.title || row.host}
                  </a>
                  <div className="text-sm text-ink-3">{row.url}</div>
                </td>
                <td className="p-2" data-label="Purpose">{row.purpose}</td>
                <td className="p-2" data-label="Last observation">{row.observation}</td>
                <td className="p-2" data-label="Review">
                  {row.reviewStatus}
                  {row.duplicateOf ? ` (repeats ${row.duplicateOf})` : ""}
                </td>
                <td className="p-2" data-label="Last read">{row.lastReadAt ? row.lastReadAt.slice(0, 10) : "never"}</td>
                <td className="p-2 text-sm text-ink-3" data-label="Still unverified">{row.unverified}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DeskShell>
  );
}
