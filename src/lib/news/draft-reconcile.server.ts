import { getSql } from "../db.ts";
import { aiEvidenceReadiness, judgeEvidenceClaims, quoteCoversClaim, type AiEvidenceReview, type EvidenceClaim } from "./evidence-ai.ts";
import { grokChat, parseJsonBlock, providerBudget } from "./ai.ts";
import { coerceDraft } from "./coerce-draft.ts";
import { evidenceReviewToken, publicEvidenceWasRemoved } from "./draft-evidence.ts";
import { topicConfirmationFingerprint } from "./notes.ts";
import { withClaimedLeadDraftLock } from "./draft-order.server.ts";
import { enqueueJob, progressReporterFor, setJobFailoverNote, setJobModelRuntime, waitForModel, type DeskJob } from "./jobs.ts";
import { parseClaims, parseFindings, serializeFindings, REPORT_EDIT_SYSTEM, STORY_FORMS, type ReportChat } from "./report.ts";
import { sanitizeJsonLeaves, storableText } from "./storable-text.ts";
import { effectiveStoryModelChoice, modelChoiceLabel } from "./model-choice.ts";
import { storyModelChoice } from "./model-choice.ts";
import { probeProvider } from "./ai.ts";
import { scanPreflight } from "./preflight.ts";
import { readProviderOverrides } from "./provider-settings.ts";
import { modelEffort, providerEntry, type ModelEffort, type ProviderOverrides } from "./provider-registry.ts";
import { initialModelRuntimeReceipt } from "./model-runtime-receipt.ts";
import { runPinnedCallWithFailover } from "./desk-model-run.ts";
import { failoverNoteSentence, failoverReasonPhrase, planAutomaticFailover } from "./automatic-failover.ts";
/* SG1b finding 1: the reconcile commit boundary refuses an un-set-up paper (see the gate inside requestDraftReconciliation). */
import { requirePaperSetUp } from "./paper-settings.ts";
import { canonicalPublicUrl } from "./fetch-outcome.ts";
import { applyJobLocalModelSnapshot, pinnedLocalModelForJob } from "./job-local-model.ts";
import type { DraftRow } from "./types.ts";
import { checkStoryNames } from "./name-check-work.ts";
import { nameCheckNotes, nameCheckText } from "./name-check.ts";
import { ensureStoryDocuments } from "./story-documents.server.ts";
import { documentReviewManifest, parseDocumentClaims, prepareDocumentReconcileEvidence, type ReconcileDocument } from "./document-reconcile-evidence.ts";
import type { ReportingReviewClaim } from "./reporting-evidence-adapter.ts";
import { sha256 } from "./url-guard.ts";
import { carryReconciledEvidenceJudgments } from "./finding-evidence-review.ts";

type ReconcileDeps = {
  chat?: ReportChat;
  enqueue?: typeof enqueueJob;
  stage?: (text: string) => Promise<void>;
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
  /*
    Every boundary in this worker goes through one reporter, which carries the
    sentence AND the stage index that sentence implies -- see
    `progressReporterFor`. `deps.stage` stays the seam the adversarial tests
    inject, now one-argument, because the job id was always the same one.
  */
  /*
    FB1: `stagePct` gives this worker the 0 / 50 the brief asks for, from the
    two arrivals it has -- "Checking the saved draft against the evidence" and
    "Reconciling the draft with the saved evidence" -- with 100 written by
    `executeJob` when the job completes. Nothing else here can count: the model
    call in the middle has no denominator, and a number invented for it would be
    a lie the editor could catch by watching.
  */
  const stage = deps.stage ?? progressReporterFor(job, { stagePct: true });
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
  await stage("Checking the saved draft against the evidence");
  const evidence = captures.map(c => `SOURCE ${c.url}\nCAPTURE VERSION ${c.id}\nCAPTURED ${c.captured_at}\n${c.title}\n${c.full_text}`).join("\n\n") || "(No saved captured evidence matched this draft.)";
  const choice = effectiveStoryModelChoice(job.model_choice);
  let savedEffort: ModelEffort | null = null;
  try { savedEffort = modelEffort(choice, (JSON.parse(job.result_json || "{}") as {modelEffort?: unknown}).modelEffort); }
  catch { savedEffort = modelEffort(choice, null); }
  let active = { modelChoice: choice, modelEffort: savedEffort };
  const overrides: ProviderOverrides = applyJobLocalModelSnapshot(
    job,
    await readProviderOverrides(job.newsroom_id, "story").catch(() => ({})),
  );
  const budget = providerBudget(choice, overrides);
  // The rung reconciliation is actually on. `active` is only reassigned once a
  // failed call returns, so a ticker reading it would name the model that has
  // already failed for the whole of the wait.
  let liveLabel = modelChoiceLabel(choice);
  const runChat: ReportChat = async (system,user,maxTokens,_modelChoice,options) => {
    const attempted = await runPinnedCallWithFailover({
      snapshot: active,
      source: job.model_choice_source ?? "editor",
      run: (snapshot) => {
        const timeoutMs = Math.max(options?.timeoutMs ?? 0, providerBudget(snapshot.modelChoice, overrides).callMs);
        return deps.chat
          ? deps.chat(system,user,maxTokens,snapshot.modelChoice,{ timeoutMs })
          : grokChat(system,user,maxTokens,{choice:snapshot.modelChoice,newsroomId:job.newsroom_id,timeoutMs,noTools:true,localModel:overrides["local-model"]?.localModel,reasoningEffort:snapshot.modelEffort});
      },
      probe: (candidate) => (deps.probe ?? probeProvider)(candidate, job.newsroom_id, undefined, "story", pinnedLocalModelForJob(job) ?? undefined),
      resolve: async (candidate) => ({ modelChoice: candidate, modelEffort: modelEffort(candidate, active.modelEffort) }),
      onSwitch: async ({previousLabel,nextLabel,nextChoice,reason}) => {
        const nextEffort = modelEffort(nextChoice, active.modelEffort);
        liveLabel = nextLabel;
        await setJobModelRuntime(job.id,nextChoice,nextEffort);
        await stage(`Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel,reason)}`);
        await setJobFailoverNote(job.id,failoverNoteSentence(nextLabel,previousLabel,reason));
      },
    });
    active = attempted.snapshot;
    return attempted.result;
  };
  const draftToEdit = JSON.stringify({headline:draft.headline,dek:draft.dek,body:draft.body,topic:draft.topic,source_urls:json(draft.source_urls),form:draft.form,found:json(draft.found_note),unanswered:json(draft.unanswered)});
  const documentEvidence = await prepareDocumentReconcileEvidence(documents, draftToEdit, runChat, active.modelChoice, text => stage(text), budget.callMs);
  await stage("Reconciling the draft with the saved evidence");
  const prompt = `Also return evidence_judgments:{"rows":[{"index":0,"verdict":"Supported|Not supported|Needs a human","quote":"exact retained words","sourceUrl":"","reason":"one line"}]}. Index the output found rows first, then output claims. Judge every row against the supplied saved evidence, never upgrade submitted to approved, and never invent a quote. RESEARCH QUESTIONS AND UNKNOWNS ARE NOT EVIDENCE. Reconcile only against the saved captures and original document text below. Do not search, fetch, research, or rewrite from outside material. Uploaded documents are valid evidence without public URLs. Cite their filenames and the tightest page/character locator around the supporting passage; never cite an entire document range merely because a name appears somewhere inside it. Never expose private document IDs, download paths or invented URLs in the story or source_urls. A supplied segment establishes what that segment discusses, not that a different policy, benefit, event or action did not exist elsewhere; narrow negative language to the scope of the evidence unless a source affirmatively supports the negative. Remove or qualify unsupported claims and retain unresolved OCR/name uncertainty. Return document_claims for selected load-bearing claims supported by uploads as [{"fact":"claim","kind":"primary|record","documentId":"exact private document ID from the evidence label","excerpt":"exact supporting passage"}]. This is a verified passage inventory, not a claim that every sentence was exhaustively inventoried. Do not put an uploaded document in URL-based claims and do not invent a URL.\n\nDraft JSON to edit:\n${draftToEdit}\n\nSAVED URL-LABELED EVIDENCE:\n${evidence}\n\nRETAINED UPLOADED DOCUMENT EVIDENCE:\n${documentEvidence.text}`;
  const response = await waitForModel({
    jobId: job.id,
    label: () => liveLabel,
    run: () => runChat(REPORT_EDIT_SYSTEM, prompt, 1800, active.modelChoice, {timeoutMs:budget.callMs}),
  });
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
    stage: text => stage(text),
    chat: (system, user, maxTokens) => runChat(system, user, maxTokens, active.modelChoice, { timeoutMs: Math.min(budget.callMs, Math.max(6000, budget.wallMs - (Date.now() - nameCheckStarted) - 2000)) }),
  });
  Object.assign(edited, names.draft);
  let judgmentOffset = 0;
  const aiEvidenceReview = {
    checkedText: edited.body,
    rows: await judgeEvidenceClaims(
      [
        ...parseFindings(parsed.found).map((finding) => ({
          text: finding.text,
          urls: finding.source_urls,
          quote: finding.excerpt,
        })),
        ...parseClaims(parsed.claims).map((claim) => ({ text: claim.fact, urls: [claim.url] })),
      ],
      captures.map((capture) => ({ url: capture.url, text: capture.full_text })),
      async () => {
        const answer = parsed.evidence_judgments as { rows?: Record<string, unknown>[] } | undefined;
        const offset = judgmentOffset;
        judgmentOffset += 10;
        const rows = Array.isArray(answer?.rows) ? answer.rows
          .filter(row => typeof row.index === "number" && row.index >= offset && row.index < offset + 10)
          .map(row => ({ ...row, index: Number(row.index) - offset })) : [];
        return { ok: true, text: JSON.stringify({ rows }) };
      },
    ),
  };
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
    // A model's omission is not a disposition. Keep the prior inventory in
    // order (including reporting metadata), then append newly returned claims.
    const claimsInput = Array.isArray(parsed.claims) ? parsed.claims : [];
    const priorClaims = research.reportedClaims as { version: number; rows: ReportingReviewClaim[] } | undefined;
    const claims = [...(priorClaims?.rows ?? [])];
    for (const claim of parseClaims(claimsInput).filter(claim => allowedCaptureUrls.some(url => sameCaptureUrl(url,claim.url)))) {
      if (!claims.some(prior => prior.fact === claim.fact && sameCaptureUrl(prior.url, claim.url))) claims.push(claim);
    }
    if (priorClaims?.version !== 2 && claims.length > 16)
      throw new Error("The retained claim inventory exceeds the draft claim limit. The draft was preserved for human review.");
    const documentClaims = parseDocumentClaims(parsed.document_claims, documents);
    const findings = parseFindings(draft.found_note);
    const returnedFindings = parseFindings(parsed.found).flatMap(finding => {
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
    for (const finding of returnedFindings) {
      if (!findings.some(prior => prior.text === finding.text && JSON.stringify(prior.source_urls) === JSON.stringify(finding.source_urls))) findings.push(finding);
    }
    if (findings.length > 6)
      throw new Error("The retained finding inventory exceeds the draft finding limit. The draft was preserved for human review.");
    const inventory: EvidenceClaim[] = [
      ...findings.map(finding => ({ text: finding.text, urls: finding.source_urls, quote: finding.excerpt })),
      ...claims.map(claim => ({ text: claim.fact, urls: [claim.url] })),
    ];
    const priorAi = research.aiEvidenceReview as AiEvidenceReview | undefined;
    const answer = parsed.evidence_judgments as { rows?: { index?: unknown; verdict?: unknown }[] } | undefined;
    const sameClaim = (left: EvidenceClaim, right: EvidenceClaim) => left.text === right.text &&
      left.urls.length === right.urls.length && left.urls.every(url => right.urls.some(other => sameCaptureUrl(url, other)));
    const defaults = await judgeEvidenceClaims(inventory, [], async () => ({ ok: true, text: '{"rows":[]}' }));
    const explicitlyJudged = new Set<string>();
    aiEvidenceReview.rows = await Promise.all(inventory.map(async (claim, index) => {
      const returnedIndex = aiEvidenceReview.rows.findIndex(row => sameClaim(row, claim));
      // Only a unique, explicit answer can replace a recorded disposition.
      // The judge has already checked that answer against retained passages.
      const explicit = Array.isArray(answer?.rows) ? answer.rows.filter(row => row?.index === returnedIndex) : [];
      if (returnedIndex >= 0 && explicit.length === 1 && ["Supported", "Not supported", "Needs a human"].includes(String(explicit[0].verdict))) {
        const claimIndex = index - findings.length;
        const row = claims[claimIndex];
        explicitlyJudged.add(index < findings.length ? `finding:${index}` :
          `claim:${claimIndex}:${await sha256(JSON.stringify([row.fact, row.url, row.kind, ...(row.reporting ? [row.reporting] : [])]))}`);
        return aiEvidenceReview.rows[returnedIndex];
      }
      const previous = priorAi?.checkedText === draft.body && Array.isArray(priorAi.rows)
        ? priorAi.rows.find(row => sameClaim(row, claim)) : undefined;
      if (!previous || previous.verdict === "Needs a human") return previous ?? defaults[index];
      const normalized = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
      const retained = captures.find(capture => capture.url === previous.sourceUrl && previous.quote?.trim().length >= 8 &&
        normalized(capture.full_text).includes(normalized(previous.quote)));
      if (retained && await sha256(retained.full_text) === previous.sourceHash &&
          (previous.verdict !== "Supported" || quoteCoversClaim(claim.text, previous.quote))) return previous;
      return { ...defaults[index], reason: "The retained passage changed or is unavailable." };
    }));
    const unanswered = Array.isArray(parsed.unanswered)
      ? parsed.unanswered.map(value => String(value).trim()).filter(Boolean).slice(0,12)
      : (Array.isArray(json(draft.unanswered)) ? (json(draft.unanswered) as unknown[]).map(String).slice(0,12) : []);
    const form = typeof parsed.form === "string" && (STORY_FORMS as readonly string[]).includes(parsed.form.trim()) ? parsed.form.trim() : draft.form;
    const { writerCheckpoint: _completedWriterCheckpoint, ...currentResearch } = research;
    /*
      The reconciler's row: the rewritten headline, dek and body are the model's
      words in `text` columns, `integrityNotes` is its note plus the editor's,
      and the `research_json` blob is read back by the desk screen through
      `::jsonb` -- so a NUL in the claim rows or the name-check rows would not
      fail here but at every later read of the column. `sanitizeJsonLeaves`
      before the stringify is what stops that.

      `sourceUrls` and `provenanceJson` are the captured-page side of the row
      and are left as they are.
    */
    const reconcileResearchJson = JSON.stringify(sanitizeJsonLeaves({
      ...currentResearch,
      ...(documents.length ? {documentEvidenceReview:documentEvidence.receipt,reportedDocumentClaims:{version:1,checkedText:nameCheckText(names.draft),rows:documentClaims}} : {}),
      nameCheck:names.check,
      aiEvidenceReview,
      storyReadiness: aiEvidenceReadiness(aiEvidenceReview),
      reportedClaims:{version:priorClaims?.version ?? 1,rows:claims},
      evidenceReconciledAt:new Date().toISOString(),
    }));
    /*
      The reconcile pass rewrites the body and files a new row; `model_body`
      (0119) records the model's own rewrite, so a later editor save on THIS row
      cannot erase it. Hoisted once: the same bytes go into `body` and
      `model_body`, and they must not drift.
    */
    const editedBody = storableText(edited.body);
    const [saved] = await tx<DraftRow>`insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json,model_body)
      values(${job.user_id},${job.newsroom_id},${draft.lead_id},${storableText(edited.headline)},${storableText(edited.dek)},${editedBody},${draft.topic},${sourceUrls},${storableText(integrityNotes)},${provenanceJson},${form},${serializeFindings(findings)},${JSON.stringify(sanitizeJsonLeaves(unanswered))},${reconcileResearchJson},${editedBody}) returning *`;
    const carried = sanitizeJsonLeaves(JSON.parse(carryReconciledEvidenceJudgments(draft, saved, explicitlyJudged))) as Record<string, unknown>;
    /* Unit ZC: the identity of the draft THIS run saved, over the FINAL carried
       memo (which may add judgment rows), so a later edit takes the completed
       check back in the zero-claims case. `evidenceReviewToken` ignores its own
       stamp (and the derived style record), so writing it does not move the
       identity it is written to match. */
    const carriedResearchJson = JSON.stringify({
      ...carried,
      evidenceReviewVersion: topicConfirmationFingerprint(evidenceReviewToken({ ...saved, research_json: JSON.stringify(carried) })),
    });
    await tx`update drafts set research_json=${carriedResearchJson} where id=${saved.id} and newsroom_id=${job.newsroom_id}`;
    // The Done card's Open button, written in the same statement as the receipt
    // (0099) so a completed reconcile row is never briefly linkless. It points
    // at the draft this run SAVED, not the one it read.
    await tx`update desk_jobs set result_json=(coalesce(nullif(result_json,'')::jsonb,'{}'::jsonb) || ${JSON.stringify({originalDraftId:draft.id,newDraftId:saved.id,evidenceCheckIncomplete:false})}::jsonb)::text, result_href=${`/desk/story/draft/${saved.id}`} where id=${job.id} and claim_token=${job.claim_token}`;
  });
}

export async function requestDraftReconciliation(
  context: { userId: string; newsroomId: number },
  input: { leadId: number; modelChoice?: string; modelEffort?: ModelEffort | null },
  deps: Pick<ReconcileDeps,"enqueue"|"probe"> = {},
): Promise<DeskJob> {
  /*
    SG1b finding 1, the reconcile half. `requestDraftReconciliationFn` (the
    desk’s own button) already refuses before it reaches this function, but
    `retryStoryJob` calls this one directly for a failed reconcile row -- so the
    check belongs at the boundary too, exactly as it does in
    `model-request-commit.server.ts`. Thrown rather than returned because this
    function’s contract is to throw its refusals ("No saved draft is available
    to reconcile in this newsroom.") and both callers already surface that.
  */
  await requirePaperSetUp(context.newsroomId, "check this draft's evidence");
  const sql = await getSql();
  const [draft] = await sql<{id:number}>`select d.id from drafts d join leads l on l.id=d.lead_id and l.newsroom_id=d.newsroom_id join newsroom_members m on m.newsroom_id=d.newsroom_id and m.user_id=${context.userId} and m.role in ('owner','editor') where d.lead_id=${input.leadId} and d.newsroom_id=${context.newsroomId} order by d.updated_at desc,d.id desc limit 1`;
  if (!draft) throw new Error("No saved draft is available to reconcile in this newsroom.");
  const requested = storyModelChoice(input.modelChoice);
  if (input.modelChoice && requested === "auto" && input.modelChoice !== "auto") throw new Error("The selected model is not available for Story work.");
  const probe = deps.probe ?? probeProvider;
  let provider = await probe(requested, context.newsroomId, undefined, "story");
  let preflight: null | { stage: string; note: string; requested: string; resolved: string } = null;
  let ready = scanPreflight(provider, requested);
  if (!ready.ok) {
    const firstError = provider.ok ? ready.guidance : provider.error;
    const plan = await planAutomaticFailover({
      source: requested === "auto" ? "auto" : "editor",
      current: requested,
      error: firstError,
      probe: (candidate) => probe(candidate, context.newsroomId, undefined, "story"),
    });
    if (!plan) throw new Error(ready.guidance);
    provider = await probe(plan.next, context.newsroomId, undefined, "story");
    ready = scanPreflight(provider, plan.next);
    if (!ready.ok || !provider.ok) {
      throw new Error(!ready.ok ? ready.guidance : provider.ok ? firstError : provider.error);
    }
    const previousLabel = modelChoiceLabel(requested);
    preflight = {
      requested,
      resolved: plan.next,
      stage: `Switched to ${plan.label}: ${failoverReasonPhrase(previousLabel, plan.reason)}`,
      note: failoverNoteSentence(plan.label, previousLabel, plan.reason),
    };
  }
  const choice = provider.ok ? provider.choice : requested;
  const localModel = provider.ok ? provider.localModel : undefined;
  /*
    0.6.69 (Unit AL item 4): the guard covers a rung that picks its model at
    call time too. Such a rung names no model in the registry, so the pair the
    probe just verified is the ONLY record of what this job will call -- a job
    enqueued without it would ask LM Studio for nothing in particular, which is
    the one thing the brief forbids outright.
  */
  if ((choice === "local-model" || providerEntry(choice)?.picksLoadedLocalModel) && !localModel) {
    throw new Error("The selected local model could not be pinned to its exact server and model before enqueueing.");
  }
  const job = await (deps.enqueue ?? enqueueJob)({userId:context.userId,newsroomId:context.newsroomId,kind:"reconcile",subjectId:draft.id,modelChoice:choice,modelChoiceSource:requested === "auto" ? "auto" : "editor",resultJson:JSON.stringify(initialModelRuntimeReceipt({requestedRuntime:requested,requestedEffort:modelEffort(requested,input.modelEffort),actualRuntime:choice,actualEffort:modelEffort(choice,input.modelEffort),localModel,preflightFailover:preflight}))});
  if (preflight) {
    /*
      The preflight switch happens before the row is claimed, so it has no stage
      list yet and `stageIndexFor` finds nothing -- the sentence and the beat are
      still worth recording, and this is the same reporter every boundary inside
      the worker uses rather than a second way to write a stage.
    */
    await progressReporterFor(job)(preflight.stage);
    await setJobFailoverNote(job.id, preflight.note);
  }
  return job;
}
