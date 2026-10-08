import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "./desk-auth";
import { draftEditInput } from "./request-input";

export const saveLeadTopic = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => draftEditInput.pick({ leadId: true, topic: true }).parse(input))
  .handler(async ({ context, data }) => {
    const { saveLeadTopicForEditor } = await import("./lead-topic.server.ts");
    return saveLeadTopicForEditor(context, data);
  });
