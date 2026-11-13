import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deskMiddleware } from "./desk-auth.ts";

export const importTownrecordEvidence = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => z.object({ json: z.string().max(2_000_000) }).strict().parse(input))
  .handler(async ({ context, data }) => {
    const { withTransaction } = await import("../db.ts");
    const { receiveTownrecordEvidence } = await import("./townrecord-handoff.ts");
    return withTransaction(sql => receiveTownrecordEvidence(sql, context, JSON.parse(data.json)));
  });
