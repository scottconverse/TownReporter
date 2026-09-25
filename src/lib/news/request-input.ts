import { z } from "zod";
// Type-only: `ModelEffort` is the registry's own list, so the enum below cannot
// drift from it without a compile error. Erased at runtime, so this file still
// imports nothing but zod.
import type { ModelEffort } from "./provider-registry.ts";

/*
  Bounded input for the server functions this unit was scoped to: publish,
  sign-in/sign-up, paper settings, and provider/model connections.

  WHY A SEPARATE MODULE. Nine of those functions live in modules that open a
  database connection at import time, and two of those cannot be loaded by
  `node --experimental-strip-types` at all -- so a check written inline in a
  `.validator()` cannot be tested for what it does. `provider-settings-input.ts`
  set this pattern first, for the same reason and with the same comment; this
  file is that idea for the rest of the scoped surface. Nothing here imports
  anything but zod, so it loads anywhere.

  THREE RULES THIS MODULE KEEPS.

  1. Nothing here throws unless the caller it replaces already threw. The
     connection form rejected a malformed body with an Error and still does;
     `saveLocalModelFn` degraded an unparseable pick to the shipped default and
     still does. Turning a recoverable form mistake into a 500 is a worse
     editor experience than the hole it closes.

  2. The bounds are ceilings far above any real value, and the numbers are
     stated once in `LIMITS` so a refusal reads as "this is 40 times the
     longest address I have ever stored", not as a magic number.

  3. It does NOT decide authorisation. Every function here is a shape check;
     `requireEditor` / `assertOwner` still run after it, in the handler.

  ON TRUNCATION. Where the value is a display string the oversize case is cut
  to the ceiling, which is the house style for display strings (`slice(0, 80)`
  on beat entities, `slice(0, 8)` on supplied URLs). Where the value must stay
  well-formed to be usable -- a URL, an email address -- the oversize case
  becomes blank instead, because half a URL is worse than none: both fields
  already document blank as a real answer (paper-settings.ts:459-462), so this
  loses no meaning that the editor did not already have.
*/

/** Ceilings, stated once. Every one is far above the longest real value. */
export const LIMITS = {
  /** A registry key or a provider id (`claude`, `codex`, a local provider). */
  providerId: 64,
  /** A local model server's base URL. `http://127.0.0.1:1234/v1` is 25. */
  modelBaseUrl: 500,
  /** A model id in a local catalog. The longest in the registry is under 40. */
  modelId: 300,
  /** A saved connection's display name. `normalizeConnectionInput` allows 80. */
  connectionName: 120,
  /** An API key. `normalizeConnectionInput` allows 4096. */
  apiKey: 5_000,
  paperName: 120,
  paperCity: 120,
  paperState: 120,
  timezone: 64,
  tagline: 300,
  /** A URL the paper prints or fetches. */
  url: 500,
  email: 320,
  watchlistEntries: 50,
  seedTitle: 200,
  channelOrKeywordEntries: 50,
  meetingKeywordEntries: 100,
  listItem: 200,
  meetingKeyword: 120,

  /*
    0.6.63, the full sweep. The first group was written against the column
    types until the schema was read: there are no bounded columns at all --
    599 `text` and 293 `integer` across migrations/, and not one `varchar`,
    `smallint` or length CHECK. So the boundary is the only bound there is,
    and each number below is taken from the tightest app-level limit already
    in the code, named beside it. Where the handler already refuses a size,
    the ceiling is that exact number, so the answer at the boundary does not
    move -- it just arrives before the work instead of after it.
  */
  /** An article slug. `views.ts:73` trims a view target to 300. */
  slug: 300,
  /** `desk.ts:348` `(topic || "council").slice(0, 40)`, `schema.ts` topic 40. */
  topic: 40,
  /** `public.ts:147` already slices the search box to 80; the UI caps 80 too. */
  searchQuery: 80,
  /** sources.kind / sources.tier are short keys ("council", "primary"). */
  sourceKind: 60,
  sourceTier: 40,
  /** `schema.ts:113` proposed_sources[].title max 200. */
  sourceTitle: 200,
  /** `schema.ts:114` proposed_sources[].why max 400. */
  sourceWhy: 400,
  /**
   * A paste of many "Title | URL" lines into the source box. `desk.ts:187`
   * splits it and inserts a row per line, so the ceiling is what bounds the
   * number of rows; 200,000 characters is a page of links.
   */
  bulkSourceText: 200_000,
  /** `schema.ts:17` headline max 180, `desk.ts:340` slice(0, 180). */
  leadHeadline: 180,
  /** `schema.ts:21` why max 800, `desk.ts:341` slice(0, 800). */
  leadWhy: 800,
  /** `desk.ts:348` topic slice(0, 40). */
  leadTopic: 40,
  /**
   * A draft headline and dek, hand-typed in the story editor. No store bounds
   * either, and the textareas have no `maxLength` -- so the ceiling is a
   * generous multiple (10x) of what the machine itself writes for the same
   * two fields, `coerce-draft.ts:60-61` (headline 240, dek 400). Anything an
   * editor could plausibly type passes; a 4 MB paste does not.
   */
  draftHeadline: 2_400,
  draftDek: 4_000,
  /**
   * The editor's pasted story text. This is the one size the product already
   * refuses: `model-request-commit.server.ts:635` rejects a text over
   * 20,000,000, and the two opinion textareas are `maxLength={20_000_000}`.
   * The same number here moves that refusal to the boundary.
   */
  storyText: 20_000_000,
  /** A draft body. `desk.ts:1661` cuts a supplied document at 2,000,000. */
  storyBody: 2_000_000,
  /** `desk.ts:1993` slice(0, 1000); the story UI `maxLength` is 1000. */
  storyDirection: 1000,
  /** `write-story.ts:11` `WRITE_STORY_SCRATCH_LIMIT = 8000`. */
  scratch: 8000,
  /** desk.ts:415 cuts the whole notes JSON at 8000, so one note is under it. */
  noteAdd: 8000,
  /** `desk.ts:2022` `data.query.trim().slice(0, 240)`. */
  pullQuery: 240,
  /** `scan-source-packs.server.ts:138` `name.trim().slice(0, 120)`. */
  packName: 120,
  /** `sections.server.ts:177` refuses `sourceIds.length > 200`. */
  packSources: 200,
  /** `follow-ups.ts:91/92/111`: who 200, what 400, replyText 2000. */
  followUpWho: 200,
  followUpWhat: 400,
  followUpReply: 2000,
  /**
   * A correction body. The form caps it at 2000 (`correction-form.tsx:71`)
   * and the server checked only a minimum, so there was no upper bound at all.
   */
  correctionBody: 2000,
  /** `finding-evidence-review.ts:867` refuses a reason over 2000. */
  reviewNote: 2000,
  /** One index per transcript segment: a long meeting has a few hundred. */
  segmentIndexes: 5000,
  /** `claim.ts`'s reader claim link: an opaque marker, not a serialized row. */
  evidenceToken: 200,
  /**
   * The evidence token the *draft* editors send -- and this one is not a
   * marker. `draft-evidence.ts:45` `evidenceReviewToken` is
   * `JSON.stringify([...])` of the whole draft row, body included, and both
   * editors send back exactly what the loader handed them
   * (`desk.story.$leadId.tsx:530`, `opinion.ts:231`). Under it the desk
   * refuses its own token, and the editor's "I checked: keep this evidence"
   * dies as `too_big` -- which is what the story and corrections walks hit on
   * 2026-09-25 (a fixture token measured 7,947 chars against a 200 ceiling).
   * Size the same way as `storyText`: the body this token wraps, plus a
   * margin for the row's other text columns (`source_urls`,
   * `provenance_json`, `found_note`, `unanswered`, `research_json`), which are
   * serialized alongside it. The value is only ever compared for equality
   * (`draft-edit.server.ts:15`), never stored.
   */
  draftEvidenceToken: 24_000_000,
  /** A named outlet, e.g. "Longmont Leader". */
  outlet: 200,
  /** `legal-removal-store.ts:458` case ref regex allows exactly 120. */
  caseRef: 120,
  /** `legal-removal-store.ts:675` refuses an identifier over 200. */
  backupIdentifier: 200,
  /** `legal-removal-store.ts:37` refuses a selection over 200 rows. */
  caseRefList: 200,
  /** A county name. */
  county: 80,
  /** `dark.ts:1848` cuts a pasted investigation subject at 14,000. */
  darkPaste: 200_000,
  /** A Reddit post's title and body. */
  redditTitle: 300,
  redditExcerpt: 4000,
  /** `story-documents.server.ts:123` refuses more than 22 ids. */
  documentIds: 22,
  /** `sections.server.ts:154/170/173/175` and the key regex at :162 (40). */
  sectionCount: 100,
  sectionName: 80,
  sectionBrief: 3000,
  sectionInstructions: 6000,
  sectionKey: 40,
  /** `routine-notice-checks.server.ts:191` refuses a sourceUrl over 4000. */
  sourceUrl: 4000,
  /** An ops action id: one of six short constants. */
  opsActionId: 64,
  /** `views.ts:73` trims a view target to 300. */
  viewTarget: 300,
  /** `opinion.ts:376` refuses written editorial text over 400,000. */
  editorialBody: 400_000,
  /** A reporting-notes todo list. The whole note JSON is cut at 8000 (desk.ts:415). */
  noteList: 500,
  /** A removal fingerprint: a hash or a JSON digest, far under 200. */
  fingerprint: 200,
  /**
   * A pasted finished report. `import-stories.ts:131` states the same ceiling
   * as `IMPORT_LIMITS.text` and the paste box enforces it with `maxLength`,
   * so an editor meets the limit in the box rather than at the server.
   */
  importText: 400_000,
  /** `import-stories.ts` `IMPORT_LIMITS.stories` — cards in one paste. */
  importStories: 200,
  /** Links on one imported story. A report story cites a handful. */
  importLinks: 100,
  /** A reader-facing disclosure line the editor typed themselves. */
  disclosureOther: 400,
} as const;

/*
  ---------------------------------------------------------------------------
  The model-use scope (provider/model connections)
  ---------------------------------------------------------------------------

  Moved here from provider-settings.ts:96-111, which kept it private -- so the
  allow-list that decides whether a scope is real could not be tested without
  loading the settings module and its database. `provider-settings.ts`
  re-exports both names, so every existing importer is unchanged.
*/

export const LOCAL_MODEL_SCOPES = ["story", "scan", "opinion", "dark", "forced"] as const;

export type LocalModelScope = (typeof LOCAL_MODEL_SCOPES)[number];

const modelScopeSchema = z.enum(LOCAL_MODEL_SCOPES);

/**
 * An allow-list, not a length check: an unknown scope is `undefined`, which
 * every caller reads as "the paper-wide default".
 */
export function cleanModelScope(value: unknown): LocalModelScope | undefined {
  const parsed = modelScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/*
  ---------------------------------------------------------------------------
  Publish (desk.ts publishLead, opinion.ts publishEditorial)
  ---------------------------------------------------------------------------

  Both were `.validator((leadId: number) => leadId)`. That is a TypeScript
  annotation and nothing else: at runtime the body arrived as whatever JSON
  the client sent, and the only thing between it and `where id = $1` was the
  driver. The queries are parameterised, so this was never injection -- it was
  a declared type that nothing enforced, which is the kind of guarantee that
  reads as a check to everyone who has not looked.
*/

const publishId = z.preprocess(
  (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN),
  z.number().int().positive().max(2_147_483_647),
);

/** A row id, or `null` for anything that is not a positive 32-bit integer. */
export function cleanPublishId(raw: unknown): number | null {
  const parsed = publishId.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/*
  ---------------------------------------------------------------------------
  A local model choice (provider-settings.ts saveLocalModelFn)
  ---------------------------------------------------------------------------

  The base URL and id were taken as-is when both were non-empty strings, with
  no ceiling: `saveLocalModel` writes them into newsroom_local_model_choices
  (provider-settings.ts:284-317) and that module has no length check anywhere.
  A bound is added, and the oversize case is refused rather than truncated --
  a truncated model server address is a different server.
*/

export type SaveLocalModelInput = {
  choice: { baseUrl: string; id: string } | null;
  scope: LocalModelScope | undefined;
  /** A scope was supplied and is not one of the five. */
  invalidScope: boolean;
  /** Both halves were supplied as text, and one is longer than a real one. */
  invalidInput: boolean;
};

export function cleanLocalModelInput(raw: unknown): SaveLocalModelInput {
  const v = (raw ?? {}) as { baseUrl?: unknown; id?: unknown; scope?: unknown };
  const scope = cleanModelScope(v.scope);
  const invalidScope = v.scope !== undefined && !scope;
  if (typeof v.baseUrl === "string" && typeof v.id === "string" && v.baseUrl && v.id) {
    const invalidInput =
      v.baseUrl.length > LIMITS.modelBaseUrl || v.id.length > LIMITS.modelId;
    return { choice: invalidInput ? null : { baseUrl: v.baseUrl, id: v.id }, scope, invalidScope, invalidInput };
  }
  // Unchanged: anything else is the existing "reset to the shipped default".
  return { choice: null, scope, invalidScope, invalidInput: false };
}

/*
  ---------------------------------------------------------------------------
  Provider logins (provider-login.ts)
  ---------------------------------------------------------------------------

  `startProviderLogin` and `testProvider` were `.validator((provider: string)
  => provider)`, and the two id calls `.validator((id: number) => id)` -- again
  annotations. The handlers do check (`isProviderId`, `Number.isInteger`), so
  nothing unsafe got through; this moves the check to the boundary where the
  other four areas have it, and gives it a ceiling.

  `cleanWriteProvider` returns `""` rather than throwing, because the handler
  already answers an unknown provider with "There is no such writing model."
  and that is a better answer than a 500. `cleanLoginId` returns `null`, which
  the handlers already return for a non-integer.
*/

const WRITE_PROVIDERS = ["claude", "codex"] as const;
export type WriteProvider = (typeof WRITE_PROVIDERS)[number];

const writeProvider = z.preprocess(
  (v) => (typeof v === "string" ? v : ""),
  z.enum(WRITE_PROVIDERS),
);

/** One of the two provider ids, or `""` for anything else including oversize. */
export function cleanWriteProvider(raw: unknown): WriteProvider | "" {
  if (typeof raw === "string" && raw.length > LIMITS.providerId) return "";
  const parsed = writeProvider.safeParse(raw);
  return parsed.success ? parsed.data : "";
}

const loginId = z.preprocess(
  (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN),
  z.number().int().nonnegative().max(2_147_483_647),
);

/** A login-token id, or `null` for anything that is not a non-negative integer. */
export function cleanLoginId(raw: unknown): number | null {
  const parsed = loginId.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/*
  ---------------------------------------------------------------------------
  Connections (custom-ai-settings.ts)
  ---------------------------------------------------------------------------

  These already threw, and they still do -- a malformed connection body was an
  Error before this file existed and the same Error comes out now, which is why
  `custom-ai-settings.test.ts` keeps passing.

  WHAT IS NEW is what the check returns and what it bounds. It used to return
  the raw object cast to the input type (`return v as ...`), so every key the
  client sent was carried through to the store; it now returns the six keys the
  type names, and nothing else. And the string ceilings are applied at the
  boundary.

  Honest note: the STORE already bounded these -- `normalizeConnectionInput`
  (custom-ai-connections.server.ts:26-47) refuses a name over 80, an API key
  over 4096 and a model id over 200. So this is not a hole being closed, it is
  the same decision made earlier: 4 MB of name was parsed, passed through
  `new URL` and only then refused.
*/

export type CleanConnectionInput = {
  name: string;
  baseUrl: string;
  id?: string;
  apiKey?: string;
  modelId?: string;
  removeApiKey?: boolean;
};

export function cleanConnectionInput(raw: unknown): CleanConnectionInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid connection request.");
  }
  const v = raw as Record<string, unknown>;
  for (const key of ["name", "baseUrl"] as const) {
    if (typeof v[key] !== "string") throw new Error(`${key} is required.`);
  }
  for (const key of ["id", "apiKey", "modelId"] as const) {
    if (v[key] !== undefined && typeof v[key] !== "string") throw new Error(`${key} must be text.`);
  }
  if (v.removeApiKey !== undefined && typeof v.removeApiKey !== "boolean") {
    throw new Error("removeApiKey must be true or false.");
  }
  const name = v.name as string;
  const baseUrl = v.baseUrl as string;
  if (name.length > LIMITS.connectionName) {
    throw new Error(`A connection name must be ${LIMITS.connectionName} characters or fewer.`);
  }
  if (baseUrl.length > LIMITS.modelBaseUrl) {
    throw new Error(`A base URL must be ${LIMITS.modelBaseUrl} characters or fewer.`);
  }
  for (const [key, max] of [["id", LIMITS.modelId], ["apiKey", LIMITS.apiKey], ["modelId", LIMITS.modelId]] as const) {
    const value = v[key] as string | undefined;
    if (value !== undefined && value.length > max) {
      throw new Error(`A connection ${key} must be ${max} characters or fewer.`);
    }
  }
  return {
    name,
    baseUrl,
    ...(v.id !== undefined ? { id: v.id as string } : {}),
    ...(v.apiKey !== undefined ? { apiKey: v.apiKey as string } : {}),
    ...(v.modelId !== undefined ? { modelId: v.modelId as string } : {}),
    ...(v.removeApiKey !== undefined ? { removeApiKey: v.removeApiKey as boolean } : {}),
  };
}

/** The connection id the enable / delete / discover / test calls send. */
export function cleanConnectionId(raw: unknown): { id: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid connection request.");
  }
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== "string" || !id.trim()) throw new Error("Connection id is required.");
  const trimmed = id.trim();
  if (trimmed.length > LIMITS.modelId) {
    throw new Error(`A connection id must be ${LIMITS.modelId} characters or fewer.`);
  }
  return { id: trimmed };
}

export function cleanConnectionEnabled(raw: unknown): { id: string; enabled: boolean } {
  const enabled = (raw && typeof raw === "object" ? (raw as { enabled?: unknown }).enabled : undefined);
  if (typeof enabled !== "boolean") throw new Error("Enabled must be true or false.");
  return { ...cleanConnectionId(raw), enabled };
}

/*
  ---------------------------------------------------------------------------
  The sign-in / sign-up route (src/routes/api/auth/$.ts)
  ---------------------------------------------------------------------------

  There is no app-owned sign-in or sign-up server function: Better Auth owns
  those routes. The only app code on that path is the route handler, which
  clones the request and parses its JSON to read `email` before deciding
  whether the desk is closed. It parsed the body first and asked questions
  afterwards, so a sign-up POST of any size was deserialised in full.

  The handler cannot be imported by a plain node test -- it reaches
  `@/lib/auth/server`, which `--experimental-strip-types` rejects (see
  grok-federation.test.ts:38-44) -- so the cap and its predicate live here,
  where that decision can be stated and tested.

  256 KB is roughly a thousand times the largest real auth body (a sign-up is
  a name, an address and a password, a few hundred bytes). It is generous on
  purpose: the goal is that the size is bounded at all, not that the limit is
  tight, because a limit set too close to a real request breaks sign-in.
*/

export const MAX_AUTH_BODY_BYTES = 256 * 1024;

/**
 * True when the request declares a body larger than the cap. An absent or
 * unparseable `Content-Length` (a chunked upload) is NOT treated as large --
 * the body cannot be measured from the header, and better-auth applies its own
 * limit downstream. Refusing on an unmeasurable header would break a legitimate
 * flow for no gain.
 */
export function authBodyTooLarge(contentLength: string | null): boolean {
  if (contentLength === null || contentLength === "") return false;
  const bytes = Number(contentLength);
  return Number.isFinite(bytes) && bytes > MAX_AUTH_BODY_BYTES;
}

/*
  ---------------------------------------------------------------------------
  0.6.63: the full sweep -- the rest of the surface
  ---------------------------------------------------------------------------

  Unit K (0.6.62) did this for publish, auth, paper settings and connections.
  This is every other server function in `src/` that carried a `.validator()`
  whose only runtime work was a TypeScript annotation: `(id: number) => id`,
  `(input: {...}) => input`, `(v) => String(v ?? "")`. 83 of them, in 15 files.
  A `.validator()` in TanStack Start is a runtime boundary -- its return value
  is what the handler receives as `data` -- so `(input: T) => input` is a shape
  check that does not check anything. Nothing here was ever injection (every
  query is parameterised); what was missing was the bound, so a 4 MB headline
  or a `"abc"` where an id belongs travelled as far as the driver.

  THE BOUNDS. There are no bounded columns to copy: across `migrations/` there
  are 599 `text` and 293 `integer` columns and not one `varchar`, `smallint` or
  length CHECK, so every string column takes any length and every id column is
  a 4-byte integer. Each ceiling below therefore comes from the tightest limit
  the app already applies -- a store's refusal, a UI `maxLength`, a `slice()` --
  and the comment beside it names that signal. Where a handler already refused
  a size, the ceiling is that exact number, so the answer at the boundary does
  not move; it arrives before the work instead of after it.

  WHAT IS NOT HERE. Hand checks stay hand checks (`dark.ts` artifactOcrRequest,
  `desk.ts` listScans, `dark.ts` saveDarkDials, `opinion.ts` opinionModelChoice,
  `public.ts:147`'s slice, and the two meeting settings normalisers): they do
  real work -- clamping, allow-listing, a fallback -- that a schema would have
  to reimplement and then keep in step. `story-document-api.ts:5` still takes a
  raw `FormData`: its handler already refuses a missing file and a part over
  4 MB, and a `z.instanceof(FormData)` cannot be checked without exercising the
  upload route.

  STRICT OR FORGIVING. Most of these functions do not throw today -- they reach
  a store or a query and fail, or answer a friendly refusal. So a thrown
  ZodError is only used where the row was a scalar id or a string that could
  not produce a working answer anyway: refusing an id that is not an integer
  at the boundary is the same observable outcome as the query erroring, one
  round trip earlier and with a clearer message. Where a function answers
  friendly text (`claim.ts`'s `String(v ?? "")`, `legalRemovalCaseId`,
  `opsAction`), the schema degrades the same way instead of throwing. And the
  six rows whose checks live in the module they delegate to (`draft-batch.ts`,
  `routine-notice-checks.ts`, `routine-notice-policy.ts`,
  `routine-notice-automation.ts`) cannot throw at all: their stores answer
  "Choose between one and five leads." where a 500 would be worse, so those use
  `cleanOrRaw`.
*/

/* --- the pieces every group shares --------------------------------------- */

/** A row id. Every `id` column here is a 4-byte integer. */
export const rowId = z.number().int().positive().max(2_147_483_647);
/** A revision or run counter: same column, but 0 is a real value. */
export const counter = z.number().int().nonnegative().max(2_147_483_647);
export const optionalId = rowId.optional();
export const nullableId = rowId.nullable();
/** A model choice: a registry key, a saved custom model id, or `auto`. */
export const modelChoiceText = z.string().max(LIMITS.modelId);
/** A short opaque id that arrives as text (a document id, a job key). */
export const idText = z.string().max(LIMITS.modelId);
/** `provider-registry.ts:58` is the same six names. */
export const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ModelEffort[];
export const modelEffortValue = z.enum(EFFORTS);
export const modelEffortOrNull = modelEffortValue.nullable();
/**
 * An effort the registry is allowed to reinterpret. `modelEffort(choice, v)`
 * already reads a value it does not know as "the model's own default", so junk
 * becomes `null` -- which that function reads the same way -- rather than a
 * 4 MB string travelling to the registry to be ignored there.
 */
export const modelEffortLoose = modelEffortValue.nullable().catch(null);
export const researchScopeValue = z.enum(["public", "supplied"]);
export const EVIDENCE_DECISIONS = ["keep", "remove"] as const;

/**
 * For a row whose real check is downstream. `safeParse` and, on failure, the
 * value as it arrived: those stores hand-check and answer a friendly refusal
 * ("Choose between one and five leads.", "Routine notice check filters were
 * malformed.") where a thrown ZodError is a 500. The ceiling still applies --
 * each text leaf carries its own `.catch`, so an oversize string is cut to
 * something the downstream check already refuses instead of being carried.
 *
 * `T` is named by the caller rather than inferred from the schema: on the pass
 * path the parsed value is handed on, and on the fail path the raw value is,
 * and both have to be the shape the delegate already takes -- which is the
 * shape the `.validator()` annotation promised before this change. The schema
 * is what does the bounding; `T` is what the handler was already typed for.
 */
export function cleanOrRaw<T>(schema: z.ZodType): (raw: unknown) => T {
  return (raw: unknown) => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? (parsed.data as T) : (raw as T);
  };
}

/* --- claim.ts (5 rows) ---------------------------------------------------- */

/** `String(v ?? "")`: junk already became "", so an oversize token does too. */
export const claimToken = z.string().max(LIMITS.evidenceToken).catch("");
export const claimEmail = z.string().max(LIMITS.email).catch("");

/* --- desk.ts (29 rows) --------------------------------------------------- */

/** `desk.ts:167` addSource. */
export const addSourceInput = z.object({
  url: z.string().max(LIMITS.url),
  title: z.string().max(LIMITS.sourceTitle),
  kind: z.string().max(LIMITS.sourceKind),
  tier: z.string().max(LIMITS.sourceTier),
});

/** `desk.ts:187` addSourcesFromText: one row per line, so this is the row cap. */
export const bulkSourceInput = z.object({ text: z.string().max(LIMITS.bulkSourceText) });

/** `desk.ts:220` setSourceStatus. */
export const sourceStatusValue = z.enum(["accepted", "rejected", "proposed"]);
export const sourceStatusInput = z.object({ id: rowId, status: sourceStatusValue });

/** `desk.ts:338` fileLead (`desk.ts:340-348` slice the same three fields). */
export const fileLeadInput = z.object({
  headline: z.string().max(LIMITS.leadHeadline),
  why: z.string().max(LIMITS.leadWhy),
  topic: z.string().max(LIMITS.leadTopic),
  url: z.string().max(LIMITS.url).optional(),
});

/** `desk.ts:586` saveScanSourcePackFn (`sections.server.ts:177` refuses > 200). */
export const packSaveInput = z.object({
  name: z.string().max(LIMITS.packName),
  sourceIds: z.array(rowId).max(LIMITS.packSources),
  packId: rowId.optional(),
});

/** `desk.ts:603` renameScanSourcePackFn. */
export const packRenameInput = z.object({ packId: rowId, name: z.string().max(LIMITS.packName) });

/** `desk.ts:617` deleteScanSourcePackFn. */
export const packDeleteInput = z.object({ packId: rowId });

/** `desk.ts:625` runScan (`input ?? {}` -- a no-arg call is a real call). */
export const runScanInput = z.preprocess(
  (v) => (v === undefined || v === null ? {} : v),
  z.object({
    modelChoice: modelChoiceText.optional(),
    modelEffort: modelEffortOrNull.optional(),
    sectionKey: z.string().max(LIMITS.sectionKey).optional(),
    customSourceIds: z.array(rowId).max(LIMITS.packSources).optional(),
    packId: rowId.optional(),
  }),
);

/** `desk.ts:1880` draftLead: a bare id, or the full four-field form. */
export const draftLeadInput = z.union([
  rowId,
  z.object({
    leadId: rowId,
    modelChoice: modelChoiceText.optional(),
    modelEffort: modelEffortOrNull.optional(),
    researchScope: researchScopeValue.optional(),
  }),
]);

/** `desk.ts:1934` writeStoryFromInput (`story-documents.server.ts:123` caps 22). */
export const writeStoryInput = z.object({
  text: z.string().max(LIMITS.storyText),
  documentIds: z.array(idText).max(LIMITS.documentIds).optional(),
  modelChoice: modelChoiceText.optional(),
  modelEffort: modelEffortOrNull.optional(),
  researchScope: researchScopeValue.optional(),
  sectionKey: z.string().max(LIMITS.sectionKey).optional(),
});

/**
 * A stored todo, read back and written whole: loose, because the list is the
 * editor's own notes and a key this file does not know must still round-trip
 * (`notes.ts:13-24` names the five that exist today).
 */
export const noteTodo = z.looseObject({
  t: z.string().max(LIMITS.listItem),
  done: z.boolean(),
  src: z.enum(["you", "machine", "gate"]),
  q: z.string().max(LIMITS.listItem).optional(),
  queries: z
    .array(z.looseObject({ query: z.string().max(LIMITS.listItem), hit: z.boolean() }))
    .max(50)
    .optional(),
});

/** `desk.ts:1959` saveReportingNotes (`desk.ts:415` cuts the JSON at 8000). */
export const reportingNotesInput = z.object({
  leadId: rowId,
  add: z.string().max(LIMITS.noteAdd).optional(),
  toggle: z.number().int().nonnegative().max(1_000).optional(),
  scratch: z.string().max(LIMITS.scratch).optional(),
  storyDirection: z.string().max(LIMITS.storyDirection).optional(),
  researchScope: researchScopeValue.optional(),
  todos: z.array(noteTodo).max(LIMITS.noteList).optional(),
});

/** `desk.ts:2011` pullTodo. */
export const pullTodoInput = z.object({
  leadId: rowId,
  query: z.string().max(LIMITS.pullQuery),
  index: z.number().int().nonnegative().max(1_000).optional(),
});

/** `desk.ts:2065` listPullJobs. */
export const leadIdInput = z.object({ leadId: rowId });

/** `desk.ts:2117` / `desk.ts:2135` (stop, retry) and `desk.ts:2270` / `:2275`. */
export const jobIdInput = z.object({ jobId: rowId });
export const idOnlyInput = z.object({ id: rowId });

/** `desk.ts:2208` setLeadStatus. */
export const leadStatusInput = z.object({
  id: rowId,
  status: z.enum(["held", "killed", "new"]),
});

/** `desk.ts:2236` listFollowUps (`input ?? {}`). */
export const followUpsInput = z.preprocess(
  (v) => (v === undefined || v === null ? {} : v),
  z.object({
    status: z.enum(["open", "answered", "dropped"]).optional(),
    limit: z.number().int().positive().max(1_000).optional(),
  }),
);

/** `desk.ts:2252` createFollowUp (`follow-ups.ts:91-92` bound who/what). */
export const followUpCreateInput = z.object({
  leadId: nullableId.optional(),
  articleId: nullableId.optional(),
  who: z.string().max(LIMITS.followUpWho),
  what: z.string().max(LIMITS.followUpWhat),
  dueOn: z.string().max(40).nullable().optional(),
});

/** `desk.ts:2265` replyToFollowUp (`follow-ups.ts:111` bounds replyText). */
export const followUpReplyInput = z.object({
  id: rowId,
  replyText: z.string().max(LIMITS.followUpReply),
  repliedOn: z.string().max(40).nullable().optional(),
});

/** `desk.ts:2510` overrideNamedOutlet. */
export const outletInput = z.object({ leadId: rowId, outlet: z.string().max(LIMITS.outlet) });

/** `desk.ts:2770` addCorrection (`correction-form.tsx:71` caps the body at 2000). */
export const correctionInput = z.object({
  articleSlug: z.string().max(LIMITS.slug).optional(),
  body: z.string().max(LIMITS.correctionBody),
  meetingReviewId: rowId.optional(),
});

/**
 * A segment index into a transcript: a long meeting is a few hundred, and
 * `LIMITS.segmentIndexes` bounds the list.
 */
export const segmentIndex = z.number().int().nonnegative().max(1_000_000);

/** `desk.ts:2791` resolveMeetingArticleReview (`finding-evidence-review.ts:867`). */
export const meetingArticleReviewInput = z.object({
  reviewId: rowId,
  resolution: z.enum(["still-accurate", "correction-required"]),
  acceptedArtifactId: rowId,
  note: z.string().max(LIMITS.reviewNote),
  confirmedSegmentIndices: z.array(segmentIndex).max(LIMITS.segmentIndexes),
});

/** `desk.ts:2814` resolveDraftMeetingReview. */
export const draftMeetingReviewInput = z.object({
  leadId: rowId,
  draftId: rowId,
  evidenceToken: z.string().max(LIMITS.draftEvidenceToken),
  acceptedArtifactId: rowId,
  confirmedSegmentIndexes: z.array(segmentIndex).max(LIMITS.segmentIndexes),
  note: z.string().max(LIMITS.reviewNote),
});

/** `desk.ts:2893` getDraftHistoryItem. */
export const draftHistoryInput = z.object({ leadId: rowId, draftId: rowId });

/** `desk.ts:3094` deleteArticleBySlug. */
export const slugInput = z.string().max(LIMITS.slug);

/* --- dark.ts (12 rows) --------------------------------------------------- */

/**
 * `dark.ts:1376` is the one row that coerced: `Number(artifactId)`. `z.coerce`
 * keeps a digit-string working, which is the only reason that coercion was
 * there, and refuses "abc" the way `Number` never did.
 */
export const artifactIdInput = z.coerce.number().int().positive().max(2_147_483_647);

/** `dark.ts:2039` runDarkDesk (`dark.ts:1848` cuts a paste at 14,000). */
export const darkRunInput = z.object({
  paste: z.string().max(LIMITS.darkPaste),
  investigationId: rowId.optional(),
  modelChoice: modelChoiceText.optional(),
});

/** `dark.ts:2067` openDarkInvestigation. */
export const darkOpenInput = z.object({
  paste: z.string().max(LIMITS.darkPaste),
  title: z.string().max(LIMITS.leadHeadline).optional(),
});

/** `dark.ts:2217` / `dark.ts:3617`: a bare id, or the step's dials. */
export const darkStepInput = z.union([
  rowId,
  z.object({
    id: rowId,
    modelChoice: modelChoiceText.optional(),
    modelEffort: modelEffortLoose.optional(),
  }),
]);

/**
 * `dark.ts:2875` / `dark.ts:3014`: a bare id, or the queue's tip flag. The
 * store's handler reads `data.id` and `data.asTip`, so the bare id is folded
 * into the object here -- exactly the `typeof input === "number" ? { id: input }
 * : input` the two validators wrote by hand, kept because it is a shape the
 * app produces, not a cast.
 */
export const darkSignalInput = z.preprocess(
  (v) => (typeof v === "number" ? { id: v } : v),
  z.object({ id: rowId, asTip: z.boolean().optional() }),
);

/** `dark.ts:3232` fileRedditTip (`fileRedditTipFor` reads these five). */
export const redditTipInput = z.object({
  url: z.string().max(LIMITS.url),
  title: z.string().max(LIMITS.redditTitle),
  excerpt: z.string().max(LIMITS.redditExcerpt).optional(),
  updated: z.string().max(80).optional(),
  author: z.string().max(200).optional(),
});

/** `dark.ts:3323` saveDarkCounty. */
export const darkCountyInput = z.object({ county: z.string().max(LIMITS.county) });

/* --- evidence.ts (4 rows) ------------------------------------------------ */

/** `evidence.ts:437` / `:441` and the pair inside `:445`. */
export const evidenceUrl = z.string().max(LIMITS.url);
export const evidenceCompareInput = z.object({
  url: evidenceUrl.optional(),
  a: rowId.optional(),
  b: rowId.optional(),
});

/* --- legal-removal.ts (5 rows) ------------------------------------------- */

/** `legal-removal-store.ts:37` refuses a selection over 200 rows per list. */
export const legalIdList = z.array(rowId).max(LIMITS.caseRefList);

export const legalSelectionInput = z.object({
  articleIds: legalIdList,
  draftIds: legalIdList,
  memoryIds: legalIdList,
  auditIds: legalIdList,
  trashIds: legalIdList,
  reviewedLegacy: z.boolean(),
  reviewedEvidence: z.boolean(),
});

/** `legal-removal.ts:33` confirmLegalRemoval (`legal-removal-store.ts:458` caseRef). */
export const legalRemovalInput = z.object({
  selection: legalSelectionInput,
  fingerprint: z.string().max(LIMITS.fingerprint),
  policy: z.enum(["retain", "destroy"]),
  caseRef: z.string().max(LIMITS.caseRef),
});

/** `legal-removal.ts:40` / `:44`: `String(id)` already degraded to "". */
export const legalCaseId = z.string().max(LIMITS.caseRef).catch("");

/** `legal-removal.ts:48` legalBackupAction (`:675` bounds the identifier). */
export const legalBackupInput = z.object({
  caseId: z.string().max(LIMITS.caseRef),
  identifier: z.string().max(LIMITS.backupIdentifier).optional(),
  confirmId: rowId.optional(),
});

/* --- opinion.ts (4 rows) ------------------------------------------------- */

/** `opinion.ts:161` startEditorial. */
export const editorialStartInput = z.object({
  subject: z.string().max(LIMITS.storyText),
  askedFor: z.string().max(LIMITS.storyText).optional(),
  articleSlug: z.string().max(LIMITS.slug).optional(),
  modelChoice: modelChoiceText.optional(),
  modelEffort: modelEffortOrNull.optional(),
  documentIds: z.array(idText).max(LIMITS.documentIds).optional(),
  retryRequestId: rowId.optional(),
});

/**
 * `opinion.ts:230` saveEditorialDraft. The body is the same editor text the
 * commit boundary already caps at 20,000,000, so a draft that could be created
 * can always be saved again.
 */
export const editorialDraftInput = z.object({
  draftId: rowId,
  headline: z.string().max(LIMITS.draftHeadline),
  dek: z.string().max(LIMITS.draftDek),
  body: z.string().max(LIMITS.storyText),
  topic: z.string().max(LIMITS.topic),
  evidenceDecision: z.enum(EVIDENCE_DECISIONS).optional(),
  evidenceToken: z.string().max(LIMITS.draftEvidenceToken).optional(),
});

/**
 * `desk.ts:2200` saveDraft: the same draft as `editorialDraftInput`, keyed by
 * the lead it belongs to rather than the draft id -- `draft-edit.server.ts:5`
 * names the field `leadId`, and the story editor saves through that path.
 */
export const draftEditInput = z.object({
  leadId: rowId,
  headline: z.string().max(LIMITS.draftHeadline),
  dek: z.string().max(LIMITS.draftDek),
  body: z.string().max(LIMITS.storyText),
  topic: z.string().max(LIMITS.topic),
  evidenceDecision: z.enum(EVIDENCE_DECISIONS).optional(),
  evidenceToken: z.string().max(LIMITS.draftEvidenceToken).optional(),
});

/** `opinion.ts:370` fileWrittenEditorial (`opinion.ts:376` refuses over 400,000). */
export const editorialText = z.string().max(LIMITS.editorialBody);

/* --- public.ts, sections.ts, story-document-api.ts, trash.ts ------------- */

/** `public.ts:78` / `:116`. */
export const publicSlug = z.string().max(LIMITS.slug);
export const publicTopic = z.string().max(LIMITS.topic);

/** A stored section, written back whole: loose, for the same reason as `noteTodo`. */
export const sectionEntry = z.looseObject({
  key: z.string().max(LIMITS.sectionKey),
  name: z.string().max(LIMITS.sectionName),
  visible: z.boolean(),
  brief: z.string().max(LIMITS.sectionBrief),
  instructions: z.string().max(LIMITS.sectionInstructions),
  replacementKey: z.string().max(LIMITS.sectionKey).nullable(),
  sourceIds: z.array(rowId).max(LIMITS.packSources),
});

/** `sections.ts:39` saveSectionConfig (`sections.server.ts:154-177`). */
export const sectionConfigInput = z.object({
  revision: counter,
  sections: z.array(sectionEntry).max(LIMITS.sectionCount),
});

/** `story-document-api.ts:25` / `:44`. */
export const storyDocumentListInput = z.object({ leadId: rowId });
export const storyDocumentDownloadInput = z.object({
  id: idText,
  extracted: z.boolean().optional(),
});

/** `trash.ts:122` / `:179`: a row id, sent as the body itself. */
export const trashId = rowId;

/* --- the six delegated rows --------------------------------------------- */

/** `draft-batch.ts:112` startDraftBatch (`cleanDraftBatchInput` owns the answer). */
export const draftBatchStartInput = z.looseObject({
  runtime: z.string().max(LIMITS.modelId).catch(""),
  items: z
    .array(z.looseObject({ leadId: rowId, researchScope: researchScopeValue.optional() }))
    .max(5),
});

/** `draft-batch.ts:140` getDraftBatch. */
export const draftBatchGetInput = z.looseObject({ batchId: rowId.optional() });

/** `routine-notice-checks.ts:93` (`:191` refuses a sourceUrl over 4000). */
export const routineCheckRunInput = z.looseObject({
  sourceId: rowId.optional(),
  sourceUrl: z.string().max(LIMITS.sourceUrl).catch(""),
});

/** `routine-notice-checks.ts:107` getRoutineNoticeChecks (`cleanListInput`). */
export const routineChecksListInput = z.looseObject({
  sourceId: rowId.optional(),
  formatKey: z.string().max(40).optional(),
});

/** `routine-notice-checks.ts:124` getRoutineNoticeCapturedText. */
export const routineCaptureInput = z.looseObject({ checkId: rowId.optional() });

/** `routine-notice-policy.ts:384` saveRoutineNoticePolicy. */
export const routinePolicyInput = z.looseObject({
  expectedRevision: counter,
  paused: z.boolean(),
  approvals: z
    .array(z.looseObject({ sourceId: rowId, sourceUrl: z.string().max(LIMITS.sourceUrl).catch(""), formatKey: z.string().max(40) }))
    .max(LIMITS.caseRefList),
});

/**
 * `routine-notice-automation.ts:396` saveRoutineNoticeAutomation. The stored
 * record (`routine-notice-automation.ts:16-32`) is the editor's whole schedule
 * -- channels, sources, timezone, local time -- so this bounds the two shapes
 * that can grow without naming a channel or a source field, and stays loose so
 * nothing the store knows about is dropped on the way in.
 */
export const routineAutomationInput = z.looseObject({
  expectedRevision: counter,
  enabled: z.boolean(),
  timezone: z.string().max(LIMITS.timezone).catch(""),
  localTime: z.string().max(40).catch(""),
  sections: z.record(z.string().max(LIMITS.sectionKey), z.string().max(LIMITS.modelId)),
  sources: z.array(z.looseObject({})).max(LIMITS.caseRefList),
});

/* --- ops/dashboard.ts (1 row) ------------------------------------------- */

/** `ops/dashboard.ts:42`: `isOpsActionId` already answers "Unknown action." */
export const opsAction = z.string().max(LIMITS.opsActionId).catch("");

/* --- import-stories.server.ts (2) --------------------------------------- */

/**
 * `import-stories.server.ts` readImportStructure: the one structure-only model
 * call, made only when the deterministic reader found no headings. Bounded by
 * the same paste ceiling as the import itself.
 */
export const importStructureInput = z.object({
  text: z.string().max(LIMITS.importText),
  modelChoice: modelChoiceText.optional(),
  modelEffort: modelEffortOrNull.optional(),
});

/**
 * One detected story, as the review screen sends it back.
 *
 * Loose, and every display string degrades rather than refusing: the editor is
 * looking at a form and a mistake in one card must not lose the other nine.
 * The fields that must stay exact to be usable -- `body`, `headline` -- are
 * still checked downstream, where the verbatim test is the real gate and a
 * failure is reported per story rather than as a wall.
 */
export const importStorySelection = z.looseObject({
  headline: z.string().max(LIMITS.draftHeadline).catch(""),
  /**
   * "story" files a lead and a draft; "idea" files a lead only. Anything the
   * client does not say is a story, which is what this box did before ideas.
   */
  kind: z.enum(["story", "idea"]).catch("story"),
  /** A section key, or empty for "Section not chosen — pick one". */
  section: z.string().max(LIMITS.sectionKey).catch(""),
  dek: z.string().max(LIMITS.draftDek).catch(""),
  body: z.string().max(LIMITS.storyBody).catch(""),
  /** Documents the report cited that have no URL, in the report's own words. */
  citations: z.array(z.string().max(LIMITS.sourceTitle)).max(LIMITS.importLinks).catch([]),
  links: z
    .array(
      z.looseObject({
        text: z.string().max(LIMITS.sourceTitle).catch(""),
        url: z.string().max(LIMITS.url).catch(""),
      }),
    )
    .max(LIMITS.importLinks)
    .catch([]),
  /** Editor notes. Never published. */
  score: z.string().max(40).catch(""),
  triage: z.string().max(40).catch(""),
  reporterNextStep: z.string().max(LIMITS.draftDek).catch(""),
  /**
   * The report's own filing label ("S1", "H1"), kept as provenance so the
   * editor can find the packet again. Never published.
   */
  storyId: z.string().max(12).catch(""),
  /**
   * The editorial readiness tier the report stated: 1 ready for edit, 2
   * developing, 3 potential, and 0 for a report that stated none. A v2.6 paste
   * always decides a card's kind and its tick from this, so an out-of-range
   * number is read as unstated rather than as some tier between them.
   */
  readiness: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).catch(0),
  /**
   * The editor notes the card carried: the tier's own qualifier, the claims
   * ledger with its statuses, the next check. Longer than a next step ever was
   * -- `import-stories.server.ts` stores these under the same
   * `editorialAssignment` and applies the same 4000 ceiling -- and never
   * published.
   */
  notes: z.string().max(4_000).catch(""),
  /** A "Hold" triage imports with a visible Hold flag. */
  hold: z.boolean().catch(false),
  disclosureKey: z.enum(["outside-ai", "person", "other"]).catch("outside-ai"),
  disclosureOther: z.string().max(LIMITS.disclosureOther).catch(""),
});

/** `import-stories.server.ts` importFinishedStories. Nothing here publishes. */
export const importStoriesInput = z.object({
  text: z.string().max(LIMITS.importText),
  /** The tool the report names, kept in the lead's provenance. */
  tool: z.string().max(LIMITS.sourceTitle).catch(""),
  /** Only the ticked cards arrive here; the server re-checks every one. */
  stories: z.array(importStorySelection).max(LIMITS.importStories),
});
