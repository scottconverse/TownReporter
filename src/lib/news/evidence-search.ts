import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "./desk-auth.ts";

/**
 * The two server calls behind evidence search on the Story page (D285/D286).
 *
 * The work lives in `evidence-search.server.ts` and `lead-edit.server.ts` so it
 * can be called directly from a test with a real (PGlite) archive; this file is
 * only the wire. The heavy modules are imported inside the handlers because
 * this file reaches the CLIENT bundle through `src/components/evidence-search.tsx`.
 */

/** Same limit `searchEvidence` enforces; the wire refuses it a step earlier. */
const QUERY_MAX = 200;

const searchInput = z.object({
  q: z.string().max(QUERY_MAX).default(""),
});

const addSourceInput = z.object({
  leadId: z.number().int().positive(),
  url: z.string().min(1).max(4_000),
  override: z.array(z.string()).optional(),
});

/** Exact words plus close in meaning, for one newsroom. */
export const searchEvidenceFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => searchInput.parse(input))
  .handler(async ({ context, data }) => {
    const { searchEvidence } = await import("./evidence-search.server.ts");
    return searchEvidence({ newsroomId: context.newsroomId }, data.q);
  });

/** "Add to this story": put a captured page's address on the lead. */
export const addEvidenceToLeadFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => addSourceInput.parse(input))
  .handler(async ({ context, data }) => {
    const { addLeadSourceUrl } = await import("./lead-edit.server.ts");
    return addLeadSourceUrl(
      { userId: context.userId, newsroomId: context.newsroomId },
      { leadId: data.leadId, url: data.url, override: data.override },
    );
  });
