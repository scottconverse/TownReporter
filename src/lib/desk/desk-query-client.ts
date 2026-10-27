import { MutationCache, QueryClient } from "@tanstack/react-query";

/*
  G23-QA-6: right after a Publish the side nav said "Drafts 1" while the Drafts
  page said "All · 0". The nav's count and the Drafts page's list are two reads
  of the same drafts, both under the `["drafts-desk"]` prefix, and Publish only
  refreshed the story, the leads and the paper -- so each read corrected itself
  whenever its own timer next fired, not together.

  The rule is made once, here, instead of in every press that can move a draft
  out of Drafts (Publish, Hold, Kill, Discard, Restore, the opinion desk's
  Publish, ...): when ANY desk action succeeds, both reads are asked again at
  once. Only reads that are on screen are re-fetched; the rest are marked stale
  and load when their page opens.
*/
export function refreshDraftsLists(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: ["drafts-desk"] }).catch(() => {});
}

export function createDeskQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false } },
    mutationCache: new MutationCache({
      onSuccess: () => {
        void refreshDraftsLists(client);
      },
    }),
  });
  return client;
}
