/**
 * The words the robot recheck sends to the model, and the reader for what comes
 * back. Plain, so a test can check the prompt and the parser without a model.
 *
 * The model is given the stored key facts and the page it just read, and asked
 * for the scan's own `resource_changes` shape -- the same shape a scan batch
 * returns -- so a changed fact travels the same apply-and-publish path.
 */

import { ScanResourceChangeSchema, type ParsedResourceChange } from "../schema.ts";
import type { KeyFacts } from "./registry-verify.server.ts";
import type { RecheckTarget } from "./registry-recheck.server.ts";

/** How much of the page the model is shown; the recheck only needs key facts. */
export const RECHECK_PAGE_CHARS = 24_000;

export function recheckUserMessage(input: {
  target: RecheckTarget;
  facts: KeyFacts;
  pageTitle: string;
  pageText: string;
}): string {
  const { target, facts } = input;
  return `You are rechecking one community-resource entry against the page it came from.

The entry is the service "${target.serviceName}" (HSDS id ${target.serviceHsdsId}) at "${target.organizationName}".
The facts below are what the registry stores today. Read the page text and compare ONLY these key facts:
status, fees, application process, organization name, each place's name and address, each phone,
hours, eligibility and required documents.

Return ONLY a JSON object of this shape:
{"resource_changes":[{"entity_type":"service","entity_hsds_id":"${target.serviceHsdsId}","entity_name":"${target.serviceName}","field_name":"phone","before_value":"the stored value","after_value":"the value the page states","change_kind":"contact_change","summary":"one sentence","quote":"the page's own sentence that states it","model_confidence":0.9,"source_url":"${target.sourceUrl}"}]}

Rules:
- Include a change ONLY for a fact the page states differently from the stored value. If every stored fact still matches the page, return {"resource_changes":[]}. Never invent a change.
- Use the exact stored value in before_value and the page's own words in after_value.
- Copy the page's sentence that states the fact into "quote", word for word. A change with no after_value and no quote is thrown away.
- entity_type is one of organization, service, location, service_at_location, schedule, contact, eligibility, required_document, language, accessibility, taxonomy. For a phone, email or website use "contact"; for hours use "schedule"; for eligibility use "eligibility"; for a required document use "required_document".
- change_kind is one of field_change, eligibility_change, hours_change, closure, move, contact_change, funding_change, non_informational.
- source_url is always ${target.sourceUrl}.

STORED KEY FACTS:
${JSON.stringify(facts, null, 1)}

PAGE (${input.pageTitle || target.sourceUrl}):
${input.pageText.slice(0, RECHECK_PAGE_CHARS)}`;
}

/** The first top-level JSON object in a reply, or null. */
function jsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * The changes a recheck reply states, with the shape the scan's commit step
 * takes. A reply that is not a JSON object with a `resource_changes` array is
 * unreadable -- the caller records a failure rather than "same", because "I
 * could not read the answer" is not "nothing changed".
 */
export function parseRecheckChanges(raw: string): ParsedResourceChange[] {
  const parsed = jsonObject(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The recheck reply was not readable JSON.");
  }
  const list = (parsed as { resource_changes?: unknown }).resource_changes;
  if (!Array.isArray(list)) {
    throw new Error("The recheck reply did not name its changes.");
  }
  const changes: ParsedResourceChange[] = [];
  for (const item of list.slice(0, 40)) {
    const read = ScanResourceChangeSchema.safeParse(item);
    if (read.success) changes.push(read.data);
  }
  return changes;
}
