import { getSql } from "../db.ts";
import { grokChat, parseJsonBlock, providerBudget } from "./ai.ts";
import { coerceDraft } from "./coerce-draft.ts";
import { evidenceReviewToken, publicEvidenceWasRemoved } from "./draft-evidence.ts";
import { withClaimedLeadDraftLock } from "./draft-order.server.ts";
import { enqueueJob, setJobStage, type DeskJob } from "./jobs.ts";
import { parseClaims, parseFindings, serializeFindings, REPORT_EDIT_SYSTEM, STORY_FORMS, type ReportChat } from "./report.ts";
import { effectiveStoryModelChoice } from "./model-choice.ts";
import { storyModelChoice } from "./model-choice.ts";
import { probeProvider } from "./ai.ts";
import { scanPreflight } from "./preflight.ts";
import { readProviderOverrides } from "./provider-settings.ts";
import type { ProviderOverrides } from "./provider-registry.ts";
import { canonicalPublicUrl } from "./fetch-outcome.ts";
import type { DraftRow } from "./types.ts";
import { checkStoryNames } from "./name-check-work.ts";
import { nameCheckNotes, nameCheckText } from "./name-check.ts";
import { ensureStoryDocuments } from "./story-documents.server.ts";
import { documentReviewManifest, parseDocumentClaims, prepareDocumentReconcileEvidence, type ReconcileDocument } from "./document-reconcile-evidence.ts";

type ReconcileDeps = {
  chat?: ReportChat;
  enqueue?: typeof enqueueJob;
  stage?: typeof setJobStage;
  probe?: typeof probeProvider;
};

function object(raw: string | null | undefined): Record<string, unknown> {
  try { const value = JSON.parse(raw ?? "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
function json(raw: string | null | undefined): unknown {
  try { return JSON.parse(raw ?? "null"); } catch { return null; }
}

function urlsFrom(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) out.add(value);
    else { try { urlsFrom(JSON.parse(value), out); } catch { /* prose, not JSON */ } }
  } else if (Array.isArray(value)) value.forEach(item => urlsFrom(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach(item => urlsFrom(item, out));
  return out;
}
function sameCaptureUrl(left: string, right: string): boolean {
  try { return canonicalPublicUrl(left) === canonicalPublicUrl(right); } catch { return false; }
}

export async function performDraftReconcileWork(job: DeskJob, deps: ReconcileDeps = {}): Promise<void> {
  if (job.kind !== "reconcile") throw new Error("Expected a reconcile job.");
  const sql = await getSql();
  const [member] = await sql<{user_id:string}>`select user_id from newsroom_members where newsroom_id=${job.newsroom_id} and user_id=${job.user_id} and role in ('owner','editor')`;
  if (!member) throw new Error("Draft reconciliation requires an active newsroom editor.");
  const [draft] = await sql<DraftRow>`select * from drafts where id=${job.subject_id} and newsroom_id=${job.newsroom_id}`;
  if (!draft) throw new Error("The saved draft is no longer available in this newsroom.");
  const [lead] = await sql<{id:number;headline:string;why:string;topic:string}>`select id,headline,why,topic from leads where id=${draft.lead_id} and newsroom_id=${job.newsroom_id}`;
  if (!lead) throw new Error("The draft's lead is no longer available in this newsroom.");
  const snapshotToken = evidenceReviewToken(draft);
  const snapshotUpdated = String(draft.updated_at);
  const research = object(draft.research_json);
  await ensureStoryDocuments(sql);
  // The lead and newsroom are server-authorized above. Never look up uploads
  // by filename or by model-supplied identifiers, and never use reading notes
  // as if they were the retained source text.
  const documents = await sql<ReconcileDocument>`select id,filename,mime,status,full_text,md5(original) as original_hash,source_url from story_documents where newsroom_id=${job.newsroom_id} and lead_id=${draft.lead_id} and mime <> 'application/x-townreporter-source-links' order by id`;
  const documentSnapshot = JSON.stringify(documentReviewManifest(documents));
  const priorDocumentReview = research.documentEvidenceReview as {documents?: {id:string}[]} | undefined;
  if (Array.isArray(priorDocumentReview?.documents) && priorDocumentReview.documents.some(ref => !documents.some(doc => doc.id === ref.id))) {
    throw new Error("A previously checked uploaded document is no longer attached to this story. The draft was preserved.");
  }
  const provenance = json(draft.provenance_json);
  const publicUrls = urlsFrom(json(draft.source_urls));
  const publicResearchUrls = urlsFrom(research.captured);
  const evidenceUrls = urlsFrom([json(draft.source_urls), provenance, json(draft.found_note), json(draft.unanswered), research]);
  const urls = [...evidenceUrls];
  const refs = Array.isArray(provenance) ? provenance.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string,unknown>, id=Number(row.version_id), url=String(row.url ?? ""), captureEventId=Number(row.capture_event_id);
    return Number.isInteger(id) && id > 0 && /^https?:\/\//i.test(url) ? [{id,url,captureEventId:Number.isInteger(captureEventId) && captureEventId > 0 ? captureEventId : null}] : [];
  }) : [];
  const versionIds = refs.map(ref => ref.id);
  const exact = versionIds.length ? await sql<{url:string;title:string;full_text:string;extraction_method:string;id:number;captured_at:string}>`select id,url,title,full_text,coalesce(to_jsonb(artifact_versions)->>'extraction_method','') as extraction_method,captured_at::text as captured_at from artifact_versions where newsroom_id=${job.newsroom_id} and id=any(${versionIds}) order by id` : [];
  for (const ref of refs) if (!exact.some(row => row.id === ref.id && sameCaptureUrl(row.url,ref.url))) throw new Error("A saved evidence capture is missing or no longer matches this newsroom. The draft was preserved.");
  const referencedUrls = refs.map(ref => ref.url);
  const fallbackUrls = urls.filter(url => !referencedUrls.some(reference => sameCaptureUrl(reference,url)));
  const fallback = fallbackUrls.length ? await sql<{url:string;title:string;full_text:string;extraction_method:string;id:number;captured_at:string}>`select distinct on(url) id,url,title,full_text,coalesce(to_jsonb(artifact_versions)->>'extraction_method','') as extraction_method,captured_at::text as captured_at from artifact_versions where newsroom_id=${job.newsroom_id} and url=any(${fallbackUrls}) order by url,captured_at desc,id desc` : [];
  const captures = [...exact,...fallback];
  if (!captures.length && !documents.length) throw new Error("No matching saved capture or uploaded document is available for this draft. The draft was preserved without calling the model.");
  await (deps.stage ?? setJobStage)(job.id, "Checking the saved draft against the evidence");
  const evidence = captures.map(c => `SOURCE ${c.url}\nCAPTURE VERSION ${c.id}\nCAPTURED ${c.captured_at}\n${c.title}\n${c.full_text}`).join("\n\n") || "(No saved captured evidence matched this draft.)";
  const choice = effectiveStoryModelChoice(job.model_choice);
  const overrides: ProviderOverrides = await readProviderOverrides(job.newsroom_id).catch(() => ({}));
  const budget = providerBudget(choice, overrides);
  const runChat: ReportChat = deps.chat ?? ((system,user,maxTokens,modelChoice,options) => grokChat(system,user,maxTokens,{choice:modelChoice,newsroomId:job.newsroom_id,timeoutMs:options?.timeoutMs,noTools:true,localModel:overrides["local-model"]?.localModel}));
  const draftToEdit = JSON.stringify({headline:draft.headline,dek:draft.dek,body:draft.body,topic:draft.topic,source_urls:json(draft.source_urls),form:draft.form,found:json(draft.found_note),unanswered:json(draft.unanswered)});
  const documentEvidence = await prepareDocumentReconcileEvidence(documents, draftToEdit, runChat, choice, text => (deps.stage ?? setJobStage)(job.id, text), budget.callMs);
  await (deps.stage ?? setJobStage)(job.id, "Reconciling the draft with the saved evidence");
  const prompt = `RESEARCH QUESTIONS AND UNKNOWNS ARE NOT EVIDENCE. Reconcile only against the saved captures and original document text below. Do not search, fetch, research, or rewrite from outside material. Uploaded documents are valid evidence without public URLs. Cite their filenames and the tightest page/character locator around the supporting passage; never cite an entire document range merely because a name appears somewhere inside it. Never expose private document IDs, download paths or invented URLs in the story or source_urls. A supplied segment establishes what that segment discusses, not that a different policy, benefit, event or action did not exist elsewhere; narrow negative language to the scope of the evidence unless a source affirmatively supports the negative. Remove or qualify unsupported claims and retain unresolved OCR/name uncertainty. Return document_claims for selected load-bearing claims supported by uploads as [{"fact":"claim","kind":"primary|record","documentId":"exact private document ID from the evidence label","excerpt":"exact supporting passage"}]. This is a verified passage inventory, not a claim that every sentence was exhaustively inventoried. Do not put an uploaded document in URL-based claims and do not invent a URL.\n\nDraft JSON to edit:\n${draftToEdit}\n\nSAVED URL-LABELED EVIDENCE:\n${evidence}\n\nRETAINED UPLOADED DOCUMENT EVIDENCE:\n${documentEvidence.text}`;
  const response = await runChat(REPORT_EDIT_SYSTEM, prompt, 1800, choice, {timeoutMs:budget.callMs});
  if (!response.ok) throw new Error(response.error);
  const edited = coerceDraft(response.text, {headline:draft.headline,dek:draft.dek,topic:draft.topic});
  if (!edited.body) throw new Error("Evidence reconciliation returned an unreadable draft. The saved draft was preserved.");
  const parsed = parseJsonBlock<Record<string,unknown>>(response.text) ?? {};
  const nameCheckStarted = Date.now();
  const names = await checkStoryNames({
    draft: edited, city: "Use the locality identified in the saved draft and sources", domains: [],
    docs: [
      ...captures.map(capture => ({ url: capture.url, title: capture.title, text: capture.full_text, extraction_method: capture.extraction_method, version_id: capture.id, extras: [] })),
      ...documents.map(doc => ({evidenceKind:"uploaded-document" as const,documentId:doc.id,filename:doc.filename,mime:doc.mime,text:doc.full_text ?? "",sourceUrl:doc.source_url})),
    ],
    searchAllowed: false, search: async () => [], open: async () => {},
    timeLeft: () => budget.wallMs - (Date.now() - nameCheckStarted),
    stage: text => (deps.stage ?? setJobStage)(job.id, text),
    chat: (system, user, maxTokens) => runChat(system, user, maxTokens, choice, { timeoutMs: Math.min(budget.callMs, Math.max(6000, budget.wallMs - (Date.now() - nameCheckStarted) - 2000)) }),
  });
  Object.assign(edited, names.draft);
  await withClaimedLeadDraftLock(job, draft.lead_id, async tx => {
    const [current] = await tx<DraftRow>`select * from drafts where lead_id=${draft.lead_id} and newsroom_id=${job.newsroom_id} order by updated_at desc,id desc limit 1 for update`;
    if (!current || current.id !== draft.id || String(current.updated_at) !== snapshotUpdated || evidenceReviewToken(current) !== snapshotToken) throw new Error("The draft or its evidence changed while reconciliation was running. The saved draft was preserved.");
    const currentDocuments = await tx<ReconcileDocument>`select id,filename,mime,status,full_text,md5(original) as original_hash,source_url from story_documents where newsroom_id=${job.newsroom_id} and lead_id=${draft.lead_id} and mime <> 'application/x-townreporter-source-links' order by id for share`;
    if (JSON.stringify(documentReviewManifest(currentDocuments)) !== documentSnapshot) throw new Error("The uploaded documents changed while reconciliation was running. The saved draft was preserved.");
    const mayAddPublicResearch = publicUrls.size > 0 && research.researchScope === "public" && !publicEvidenceWasRemoved(draft);
    const acceptedSourceUrls = Array.isArray(parsed.source_urls)
      ? (edited.source_urls as unknown[]).map(String).filter(url =>
          [...publicUrls].some(reference => sameCaptureUrl(reference,url)) ||
          (mayAddPublicResearch && [...publicResearchUrls].some(reference => sameCaptureUrl(reference,url)) && fallback.some(capture => sameCaptureUrl(capture.url,url))),
        )
      : [...publicUrls];
    const sourceUrls = Array.isArray(parsed.source_urls) ? JSON.stringify(acceptedSourceUrls) : draft.source_urls;
    const priorProvenance = Array.isArray(provenance) ? provenance : [];
    const addedProvenance = acceptedSourceUrls.flatMap(url => {
      if (priorProvenance.some(item => item && typeof item === "object" && sameCaptureUrl(String((item as Record<string,unknown>).url ?? ""),url))) return [];
      const capture = fallback.find(row => sameCaptureUrl(row.url,url));
      return capture ? [{url:capture.url,title:capture.title,version_id:capture.id,captured_at:capture.captured_at,role:"followed"}] : [];
    });
    const provenanceJson = addedProvenance.length ? JSON.stringify([...priorProvenance,...addedProvenance]) : draft.provenance_json;
    const obsoleteCheckpointNote = "Evidence reconciliation not completed within the available edit pass. Draft retained; verify its claims and citations before publication.";
    const staleMissingTopicNote = "No configured Topic key was supplied with the lead; assign the editorial section before publication.";
    const [configuredTopic] = draft.topic === lead.topic
      ? await tx<{key:string}>`select key from newsroom_sections where newsroom_id=${job.newsroom_id} and key=${lead.topic} and replacement_key is null limit 1`
      : [];
    const priorNotes = String(draft.integrity_notes ?? "").split(/\r?\n/).map(line => line.trim()).filter(line =>
      line && line !== obsoleteCheckpointNote && !(configuredTopic && line === staleMissingTopicNote),
    );
    const integrityNotes = [...new Set([...priorNotes, edited.integrity_notes, nameCheckNotes(names.check)].map(value => String(value ?? "").trim()).filter(Boolean))].join("\n");
    const allowedCaptureUrls = captures.map(capture => capture.url);
    // Claims describe this newly edited body. Missing output cannot safely
    // inherit claims recorded for the older body, even when their URLs remain valid.
    const claimsInput = Array.isArray(parsed.claims) ? parsed.claims : [];
    const claims = parseClaims(claimsInput).filter(claim => allowedCaptureUrls.some(url => sameCaptureUrl(url,claim.url)));
    const documentClaims = parseDocumentClaims(parsed.document_claims, documents);
    const findings = parseFindings(parsed.found).flatMap(finding => {
      const sourceUrls = finding.source_urls.filter(url => allowedCaptureUrls.some(allowed => sameCaptureUrl(allowed,url)));
      if (!sourceUrls.length) return [];
      const matchedCaptures = captures.filter(capture => sourceUrls.some(url => sameCaptureUrl(capture.url,url)));
      const matchedRefs = refs.filter(ref => matchedCaptures.some(capture => capture.id === ref.id && sameCaptureUrl(capture.url,ref.url)));
      return [{
        ...finding,
        source_urls: sourceUrls,
        artifact_version_ids: [...new Set(matchedCaptures.map(capture => capture.id))],
        capture_event_ids: [...new Set(matchedRefs.map(ref => ref.captureEventId).filter((id): id is number => id != null))],
      }];
    });
    const unanswered = Array.isArray(parsed.unanswered)
      ? parsed.unanswered.map(value => String(value).trim()).filter(Boolean).slice(0,12)
      : (Array.isArray(json(draft.unanswered)) ? (json(draft.unanswered) as unknown[]).map(String).slice(0,12) : []);
    const form = typeof parsed.form === "string" && (STORY_FORMS as readonly string[]).includes(parsed.form.trim()) ? parsed.form.trim() : draft.form;
    const { writerCheckpoint: _completedWriterCheckpoint, ...currentResearch } = research;
    const [saved] = await tx<{id:number}>`insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json)
      values(${job.user_id},${job.newsroom_id},${draft.lead_id},${edited.headline},${edited.dek},${edited.body},${draft.topic},${sourceUrls},${integrityNotes},${provenanceJson},${form},${serializeFindings(findings)},${JSON.stringify(unanswered)},${JSON.stringify({...currentResearch,...(documents.length ? {documentEvidenceReview:documentEvidence.receipt,reportedDocumentClaims:{version:1,checkedText:nameCheckText(names.draft),rows:documentClaims}} : {}),nameCheck:names.check,reportedClaims:{version:1,rows:claims},evidenceReconciledAt:new Date().toISOString()})}) returning id`;
    await tx`update desk_jobs set result_json=${JSON.stringify({originalDraftId:draft.id,newDraftId:saved.id,evidenceCheckIncomplete:false})} where id=${job.id} and claim_token=${job.claim_token}`;
  });
}

export async function requestDraftReconciliation(
  context: { userId: string; newsroomId: number },
  input: { leadId: number; modelChoice?: string },
  deps: Pick<ReconcileDeps,"enqueue"|"probe"> = {},
): Promise<DeskJob> {
  const sql = await getSql();
  const [draft] = await sql<{id:number}>`select d.id from drafts d join leads l on l.id=d.lead_id and l.newsroom_id=d.newsroom_id join newsroom_members m on m.newsroom_id=d.newsroom_id and m.user_id=${context.userId} and m.role in ('owner','editor') where d.lead_id=${input.leadId} and d.newsroom_id=${context.newsroomId} order by d.updated_at desc,d.id desc limit 1`;
  if (!draft) throw new Error("No saved draft is available to reconcile in this newsroom.");
  const requested = storyModelChoice(input.modelChoice);
  if (input.modelChoice && requested === "auto" && input.modelChoice !== "auto") throw new Error("The selected model is not available for Story work.");
  const provider = await (deps.probe ?? probeProvider)(requested, context.newsroomId);
  const ready = scanPreflight(provider, requested);
  if (!ready.ok) throw new Error(ready.guidance);
  const choice = provider.ok ? provider.choice : requested;
  return (deps.enqueue ?? enqueueJob)({userId:context.userId,newsroomId:context.newsroomId,kind:"reconcile",subjectId:draft.id,modelChoice:choice,modelChoiceSource:requested === "auto" ? "auto" : "editor"});
}
