/**
 * The newsroom's own API connections: read them, and wire every action the
 * `CustomAiConnections` component offers to its server function and to the
 * cached reads that depend on it.
 *
 * MOVED HERE from `CustomAiSettings` in routes/desk.ops.tsx (unit BG). The
 * Models screen's "Frontier · API key" group draws the same cards, and the
 * wiring is not cosmetic: enabling or removing a connection has to invalidate
 * `provider-availability` in the same breath, or every picker on the desk
 * keeps offering a model that is now switched off. Two copies of that would
 * drift; one copy cannot.
 *
 * The enclosing heading and the section's own border stay with the route, so
 * each screen frames the panel the way its design draws it.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import { CustomAiConnections } from "@/components/custom-ai-connections";
import { PROVIDER_AVAILABILITY_QUERY_KEY } from "@/lib/news/provider-availability-key";
import {
  deleteCustomAiConnectionFn,
  discoverCustomAiModelsFn,
  enableCustomAiConnectionFn,
  getCustomAiConnectionsFn,
  removeCustomAiConnection,
  saveCustomAiConnectionAndCache,
  saveCustomAiConnectionFn,
  testCustomAiConnectionFn,
  updateCustomAiConnectionEnabled,
  type PublicCustomAiConnection,
} from "@/lib/news/custom-ai-settings";

export function CustomAiConnectionsPanel({
  showHeading = true,
  /**
   * Hand the form a saved connection to open in edit. The Models screen's card
   * Settings buttons pass one; every other caller gets the blank form.
   */
  initialEditId,
}: {
  showHeading?: boolean;
  initialEditId?: string;
}) {
  const qc = useQueryClient();
  const connections = useQuery({
    queryKey: ["custom-ai-connections"],
    queryFn: () => getCustomAiConnectionsFn(),
  });
  function refresh() {
    void qc.invalidateQueries({ queryKey: ["custom-ai-connections"] }).catch(() => undefined);
  }
  if (connections.isPending) {
    return <p role="status">Loading your API connections…</p>;
  }
  if (connections.isError && !connections.data) {
    return (
      <div role="alert">
        <p>Could not load your API connections. Existing writing models are unchanged.</p>
        <InkButton tone="quiet" onClick={() => void connections.refetch()}>
          Try again
        </InkButton>
      </div>
    );
  }
  return (
    <CustomAiConnections
      connections={connections.data ?? []}
      showHeading={showHeading}
      initialEditId={initialEditId}
      onSave={async (data) => {
        const saved = await saveCustomAiConnectionAndCache(
          data,
          (input) => saveCustomAiConnectionFn({ data: input }),
          qc,
        );
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["custom-ai-connections"] }),
          qc.invalidateQueries({
            queryKey: PROVIDER_AVAILABILITY_QUERY_KEY,
            refetchType: "all",
          }),
        ]);
        return saved;
      }}
      onEnable={async (id, enabled) => {
        await enableCustomAiConnectionFn({ data: { id, enabled } });
        qc.setQueryData<PublicCustomAiConnection[] | undefined>(
          ["custom-ai-connections"],
          (current) => updateCustomAiConnectionEnabled(current, id, enabled),
        );
        refresh();
        void qc.invalidateQueries({
          queryKey: PROVIDER_AVAILABILITY_QUERY_KEY,
          refetchType: "all",
        });
      }}
      onDelete={async (id) => {
        await deleteCustomAiConnectionFn({ data: { id } });
        qc.setQueryData<PublicCustomAiConnection[] | undefined>(
          ["custom-ai-connections"],
          (current) => removeCustomAiConnection(current, id),
        );
        refresh();
        void qc.invalidateQueries({
          queryKey: PROVIDER_AVAILABILITY_QUERY_KEY,
          refetchType: "all",
        });
      }}
      onDiscover={(id) => discoverCustomAiModelsFn({ data: { id } })}
      onTest={(id) => testCustomAiConnectionFn({ data: { id } })}
    />
  );
}
