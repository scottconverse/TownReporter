import { createServerFn } from "@tanstack/react-start";
import { assertOwner, deskMiddleware } from "./desk-auth.ts";
import type { LocalCatalog } from "./local-models.ts";

export { PROVIDER_AVAILABILITY_QUERY_KEY } from "./provider-availability-key.ts";
export type { LocalCatalog } from "./local-models.ts";

export const providerAvailability = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) =>
    (await import("./provider-availability.server.ts")).getProviderAvailability(
      context.newsroomId,
    ),
  );

export const localModelCatalog = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async (): Promise<LocalCatalog> =>
    (await import("./provider-availability.server.ts")).getLocalModelCatalog(),
  );

export const refreshLocalModelCatalog = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async (): Promise<LocalCatalog> =>
    (await import("./provider-availability.server.ts")).refreshLocalModelCatalog(),
  );

export const testCloudUsageWarnings = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    assertOwner(context.role);
    return (await import("./provider-availability.server.ts")).testOllamaCloudWarnings();
  });
