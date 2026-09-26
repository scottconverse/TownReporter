import { DraftScopePicker } from "@/components/draft-scope-picker";
import { useEditorSections } from "@/lib/use-sections";
import { StoryDocumentUpload, type StoryUpload } from "@/components/story-documents";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { firstRunSetupState } from "@/lib/news/paper-settings";
import { Busy, Chip, DeskMoreMenu, InkButton, JobSlot, Score, SecHead } from "@/components/desk-chrome";
import { useNowMs, type RunningJob } from "@/components/desk-jobs";
import {
  areaClass,
  announceToDesk,
  inputClass,
  leadOrigin,
} from "@/components/desk-chrome-utils";
import { LeadFlags } from "@/components/desk-leads";
import { formatAge } from "@/lib/paper";
import { DeskShell } from "@/components/desk-chrome";
import { ListSkeleton, ScreenError } from "@/components/states";
import {
  dropFollowUp,
  draftLead,
  importFinishedStories,
  listDraftsDesk,
  listFollowUps,
  listLeads,
  listRecentStoryWork,
  listMemory,
  listPublishedDesk,
  listScans,
  listSources,
  nudgeFollowUp,
  recordFollowUpReply,
  runScan,
  setLeadStatus,
  setSourceStatus,
  writeStoryFromInput,
} from "@/lib/news/desk";
import { FollowUpItem } from "@/components/follow-up-item";
import {
  IMPORT_DISCLOSURES,
  IMPORT_LIMITS,
  htmlToText,
  type DisclosureKey,
} from "@/lib/news/import-stories";
import {
  IMPORT_PASTE_KEY,
  NO_SECTION,
  SECTION_REQUIRED,
  cardProblems,
  duplicateNote,
  findDuplicate,
  selectionFromCard,
  type DuplicateWarning,
} from "@/lib/news/import-review";
import { PASTE_ONE_DISCLOSURE, pasteOneStoryCard } from "@/lib/news/paste-one-story";
import { listInvestigations, listWorthALook, openDarkInvestigation } from "@/lib/news/dark";
import {
  editorKindLabel,
  editorDraftError,
  editorFetchError,
  editorScanError,
  editorStatus,
  flakyFailureCopy,
  followUpsRailCopy,
  investigationStopKind,
  nearDuplicate,
  openLeads,
  pileForStatus,
  scanCountsLine,
  scanZeroWhy,
  sourceErrorKind,
  suggestedByLabel,
  workingQueueEmptyCopy,
  worthItemOnDesk,
} from "@/lib/news/desk-copy";
import {
  deskDraftAction,
  deskDraftElapsed,
  deskDraftState,
  type DeskDraftState,
} from "@/lib/news/desk-drafts";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context-state";
import { ModelPicker } from "@/components/model-picker";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { looksLikeProviderAuthFailure } from "@/lib/news/preflight";

export const Route = createFileRoute("/desk/")({ component: DeskHome });

const OPEN_KEY = "townreporter.dark.openId";

type DraftRow = Awaited<ReturnType<typeof listDraftsDesk>>[number];

/** The tone a state chip is drawn in: the words carry the state, the border
 *  carries the tone. Same mapping as the Drafts screen. */
function stateTone(state: DeskDraftState): string {
  if (state.failed) return "d-danger";
  if (state.running) return "d-run";
  if (state.needsYou) return "d-warn";
  if (state.key === "ready") return "d-ok";
  return "d-quiet";
}

/**
 * "Saturday, Sep 26" in the paper's own timezone.
 *
 * The desk's own formatters print the long month ("Saturday, September 26,
 * 2026"); the drawing's date line is the short one, because it sits in the
 * 14px kicker above the greeting. An unusable timezone name falls back to the
 * browser's, which is what the desk would have used before the paper was set
 * up at all -- a bad setting must not blank the header.
 */
function deskDateLine(nowMs: number, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "short", day: "numeric" };
  try {
    return new Date(nowMs).toLocaleDateString("en-US", { ...opts, timeZone: timezone });
  } catch {
    return new Date(nowMs).toLocaleDateString("en-US", opts);
  }
}

/**
 * The triage keys the drawn legend bar prints under the list (README "1.
 * Today"): "J/K next/previous · S start story · H hold · X kill · U undo ·
 * Enter open lead". The words are the drawing's, and every one of them is a
 * key the window listener below actually acts on.
 *
 * N, ⌘S and ? are bound too, and are in the "?" sheet rather than in this
 * bar: ⌘S is the story workbench's save and not this screen's, and the bar is
 * the drawing's, so it carries the drawing's six.
 */
const TRIAGE_KEYS: [string, string][] = [
  ["J / K", "next / previous"],
  ["S", "start story"],
  ["H", "hold"],
  ["X", "kill"],
  ["U", "undo"],
  ["Enter", "open lead"],
];

function DeskHome() {
  const sectionQuery = useEditorSections();
  const { city, timezone } = usePaper();
  const { formatDate, formatDateTime, formatShortDate } = usePaperDateFormatters();
  const qc = useQueryClient();
  const navigate = useNavigate();
  /*
    CITY-SETUP final slice: the owner sees the first-run setup screen
    exactly once, right after claiming a fresh desk. `needsSetup` goes
    false the moment completeFirstRunSetup runs (see paper-settings.ts) and
    stays false, so re-visiting the desk later never redirects again --
    only the Server page's "Paper setup" section reaches /desk/setup after
    that, on purpose.
  */
  const setupState = useQuery({
    queryKey: ["first-run-setup"],
    queryFn: () => firstRunSetupState(),
  });
  useEffect(() => {
    if (setupState.data?.needsSetup) {
      void navigate({ to: "/desk/setup" });
    }
  }, [setupState.data, navigate]);

  const sources = useQuery({ queryKey: ["sources"], queryFn: () => listSources() });
  const recentStories = useQuery({
    queryKey: ["recent-story-work"],
    queryFn: () => listRecentStoryWork(),
    refetchInterval: 5000,
  });
  /*
    THE GATE STATE, for Tonight's edition (README "1. Today": the checklist
    "reads the existing gate state"). Same query key as the Drafts screen, same
    server function, same 5s cadence, so the two screens cannot disagree about
    what a draft is waiting on -- and one poll serves both.
  */
  const drafts = useQuery({
    queryKey: ["drafts-desk"],
    queryFn: () => listDraftsDesk(),
    refetchInterval: 5000,
  });
  const leads = useQuery({ queryKey: ["leads"], queryFn: () => listLeads() });
  const scans = useQuery({
    queryKey: ["scans"],
    queryFn: () => listScans(),
    refetchInterval: (q) => {
      const row = q.state.data?.rows?.[0];
      if (row && !row.finished_at && !row.error) return 2000;
      return false;
    },
  });
  const investigations = useQuery({
    queryKey: ["investigations"],
    queryFn: () => listInvestigations(),
  });
  const worth = useQuery({ queryKey: ["worth-a-look"], queryFn: () => listWorthALook() });
  const published = useQuery({ queryKey: ["published-desk"], queryFn: () => listPublishedDesk() });
  const memory = useQuery({ queryKey: ["memory"], queryFn: () => listMemory() });
  const followUps = useQuery({
    queryKey: ["follow-ups", "open"],
    queryFn: () => listFollowUps({ data: { status: "open" } }),
  });
  const replyFollowUp = useMutation({
    mutationFn: (input: { id: number; replyText: string; repliedOn: string }) =>
      recordFollowUpReply({ data: input }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["follow-ups"] });
      announceToDesk(
        res?.ok
          ? "Reply recorded."
          : (res && "error" in res && res.error) || "Could not save that reply.",
      );
    },
  });
  const nudgeFollow = useMutation({
    mutationFn: (id: number) => nudgeFollowUp({ data: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["follow-ups"] });
      announceToDesk("Nudge stamped.");
    },
  });
  const dropFollow = useMutation({
    mutationFn: (id: number) => dropFollowUp({ data: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["follow-ups"] });
      announceToDesk("Follow-up dropped.");
    },
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: number; status: "held" | "killed" | "new" }) =>
      setLeadStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
  const srcStatus = useMutation({
    mutationFn: (input: { id: number; status: "accepted" | "rejected" }) =>
      setSourceStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
  const scan = useMutation({
    mutationFn: () => runScan(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
  const [darkErr, setDarkErr] = useState<string | null>(null);
  const startDark = useMutation({
    mutationFn: (item: { seed: string; title: string }) =>
      openDarkInvestigation({ data: { paste: item.seed, title: item.title } }),
    onSuccess: (res) => {
      if (res?.ok && res.investigationId) {
        setDarkErr(null);
        try {
          sessionStorage.setItem(OPEN_KEY, String(res.investigationId));
          sessionStorage.setItem("townreporter.dark.autodig", String(res.investigationId));
        } catch {
          /* ignore */
        }
        void navigate({ to: "/desk/dark" });
        return;
      }
      setDarkErr(
        res && "error" in res && res.error ? String(res.error) : "Could not open that file.",
      );
    },
    onError: (err) => {
      setDarkErr(err instanceof Error ? err.message : "Could not open that file.");
    },
  });

  /*
    "Write a story" -- one box, one click, the way Opinion already works.

    Before this, the only path from a URL or an idea to a draft was Queue's
    four-field form (Headline, Why now, Topic, one Source URL) followed by a
    separate trip to the story page to paste the same text again as
    Reporting notes. That is three fields' worth of paraphrasing a link the
    editor could just paste. This box parses whatever lands in it -- see
    write-story.ts -- and files it exactly like the form does, with the full
    text kept so the draft reads it as evidence.
  */
  const [storyText, setStoryText] = useState("");
  const [storyInstructions, setStoryInstructions] = useState("");
  const storyInput = [storyInstructions.trim(), storyText.trim()].filter(Boolean).join("\n\n");
  const [storyDocuments, setStoryDocuments] = useState<StoryUpload[]>([]);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  const [storyScope, setStoryScope] = useState<"public" | "supplied">("public");
  const [storySection, setStorySection] = useState("");
  const [storyModel, setStoryModel] = useState<StoryModelChoice>("auto");
  const [storyModelEffort, setStoryModelEffort] = useState<ModelEffort | null>(
    defaultModelEffort("auto"),
  );
  const [storyNotice, setStoryNotice] = useState<{
    text: string;
    kind: "error" | "info";
    authDetail?: string | null;
    leadId?: number;
  } | null>(null);
  /*
    A finished story or a whole report, on its way to the import screen. Kept
    here rather than typed straight into that screen because this is the box the
    editor is already looking at; see IMPORT_PASTE_KEY for the handoff.
  */
  const [importText, setImportText] = useState("");
  /*
    "Paste a story I already have": one story, straight into the Queue, no
    review screen and no model. See paste-one-story.ts for why it is the import
    path and not a second one.
  */
  const [pasteText, setPasteText] = useState("");
  const [pasteHeadline, setPasteHeadline] = useState("");
  const [pasteSection, setPasteSection] = useState(NO_SECTION);
  const [pasteDisclosure, setPasteDisclosure] = useState<DisclosureKey>(PASTE_ONE_DISCLOSURE);
  const [pasteOther, setPasteOther] = useState("");
  const [pasteNotice, setPasteNotice] = useState<string>("");
  const [pasted, setPasted] = useState<
    { headline: string; leadId: number; duplicate?: DuplicateWarning } | null
  >(null);
  const pasteStory = useMutation({
    mutationFn: () => {
      const card = pasteOneStoryCard({
        text: pasteText,
        headline: pasteHeadline,
        section: pasteSection,
        disclosureKey: pasteDisclosure,
        disclosureOther: pasteOther,
      });
      /*
        The section is asked for here, in the review screen's own words and by
        the review screen's own rule, because a draft cannot be filed without
        one: the database refuses an empty topic outright (the
        resolve_story_section trigger on `drafts`, sections.server.ts:37), and
        every other way into the Queue -- the write box, the import screen --
        picks a section first. The placeholder in the select is a question, not
        an answer, so leaving it is answered with the question again rather
        than with a section nobody chose.
      */
      const problems = cardProblems(card);
      if (problems.length > 0) throw new Error(problems.join(" "));
      /*
        The duplicate is looked up BEFORE the story is filed, from the lists the
        Queue screen has already loaded. Checked afterwards it would find the
        lead this very click just created and call every paste a duplicate of
        itself. It is shown after the add, as a warning, because the paste is
        already in the Queue either way -- nothing is merged, killed or renamed
        behind the editor's back.
      */
      const duplicate = findDuplicate(card, {
        leads: leads.data?.map((l) => ({ id: l.id, headline: l.headline ?? "" })),
        published: published.data?.map((p) => ({ slug: p.slug, headline: p.headline })),
      });
      return importFinishedStories({
        data: { text: pasteText, tool: "", stories: [selectionFromCard(card)] },
      }).then((result) => ({ result, duplicate }));
    },
    onSuccess: ({ result, duplicate }) => {
      if (!result.ok) {
        const line = result.error || "That story was not added. Nothing was changed.";
        setPasteNotice(line);
        announceToDesk(line);
        return;
      }
      const first = result.imported[0];
      setPasted({ headline: first?.headline ?? "", leadId: first?.leadId ?? 0, duplicate });
      setPasteNotice("");
      setPasteText("");
      setPasteHeadline("");
      setPasteOther("");
      announceToDesk("Added to the Queue as a draft. Nothing is published.");
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["published-desk"] });
    },
    onError: (err) => {
      const line =
        err instanceof Error ? err.message : "That story was not added. Nothing was changed.";
      setPasteNotice(line);
      announceToDesk(line);
    },
  });
  async function readImportFile(file: File | undefined) {
    if (!file) return;
    const raw = await file.text();
    const isHtml = /\.html?$/i.test(file.name) || /^\s*<(!doctype|html)/i.test(raw);
    setImportText(isHtml ? htmlToText(raw) : raw);
    announceToDesk(`${file.name} is ready. Read the stories when you are.`);
  }
  const writeStory = useMutation({
    mutationFn: () =>
      writeStoryFromInput({
        data: {
          text: storyInput,
          documentIds: storyDocuments.map((d) => d.id),
          modelChoice: storyModel,
          modelEffort: storyModelEffort,
          researchScope: storyScope,
          sectionKey: storySection || undefined,
        },
      }),
    onSuccess: (res) => {
      if (!res?.ok) {
        const raw = res?.error ?? "That did not file.";
        const leadId = res && "leadId" in res ? res.leadId : undefined;
        setStoryNotice({
          text: editorDraftError(raw) ?? raw,
          kind: "error",
          authDetail: raw,
          leadId,
        });
        if (leadId) {
          // Filing succeeded even when the provider refused. Keep one saved
          // story and make its recovery path visible instead of filing twice.
          setStoryText("");
          setStoryInstructions("");
          setStoryDocuments([]);
          void qc.invalidateQueries({ queryKey: ["leads"] });
        }
        return;
      }
      setStoryText("");
      setStoryInstructions("");
      setStoryDocuments([]);
      setStoryNotice(null);
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void navigate({ to: "/desk/story/$leadId", params: { leadId: String(res.leadId) } });
      void qc.invalidateQueries({ queryKey: ["recent-story-work"] });
    },
    onError: (err) => {
      const raw = err instanceof Error ? err.message : "That did not file.";
      setStoryNotice({ text: editorDraftError(raw) ?? raw, kind: "error", authDetail: raw });
    },
  });

  const src = sources.data ?? [];
  const allLeads = leads.data ?? [];
  const queue = openLeads(allLeads).sort(
    (a, b) => (b.newsworthiness ?? 0) - (a.newsworthiness ?? 0),
  );
  const publishedCount = allLeads.filter((l) => l.status === "published").length;
  const accepted = src.filter((s) => s.status === "accepted");
  const proposed = src.filter((s) => s.status === "proposed");
  const officialFail = accepted.filter((s) => s.last_error && sourceErrorKind(s) === "official");
  const flakyFail = accepted.filter((s) => s.last_error && sourceErrorKind(s) === "flaky");
  const last = scans.data?.rows?.[0];
  const scanning = scan.isPending || Boolean(last && !last.finished_at && !last.error);
  const invs = investigations.data ?? [];
  const onDesk = invs.filter((r) => pileForStatus(r.status) === "desk");
  const aside = invs.filter((r) => pileForStatus(r.status) === "aside");
  const inbox = (worth.data ?? []).filter((item) => !worthItemOnDesk(item, invs));
  const errStops = onDesk.filter((i) => investigationStopKind(i) === "error");
  const roundStops = onDesk.filter((i) => investigationStopKind(i) === "round");
  const drafted = allLeads.filter((l) => l.status === "drafted").length;
  const scanStale =
    last?.error ||
    (last?.started_at && Date.now() - new Date(last.started_at).getTime() > 24 * 3600_000);
  const printed = published.data ?? [];

  const needs: { t: string; to: string; openDark?: number; quiet?: boolean }[] = [];
  if (drafted)
    needs.push({
      t: `${drafted} draft${drafted > 1 ? "s" : ""} on the desk`,
      to: "/desk/drafts",
    });
  if (errStops.length) {
    needs.push({
      t: `${errStops.length} Dark Desk file${errStops.length === 1 ? "" : "s"} stopped on an error — what it found is saved`,
      to: "/desk/dark",
      openDark: errStops[0]!.id,
    });
  }
  if (proposed.length) {
    needs.push({
      t: `${proposed.length} suggested source${proposed.length === 1 ? "" : "s"} await${proposed.length === 1 ? "s" : ""} review`,
      to: "/desk/sources",
    });
  }
  if (officialFail.length) {
    needs.push({
      t: `${officialFail.length} official source${officialFail.length === 1 ? "" : "s"} failing to fetch`,
      to: "/desk/sources",
    });
  }
  if (scanStale && last?.error) {
    needs.push({
      t:
        last.sources_fetched > 0
          ? "Last scan fetched sources but did not file leads"
          : "Last scan failed",
      to: "/desk/scan",
    });
  } else if (scanStale) needs.push({ t: "No scan in the last day", to: "/desk/scan", quiet: true });
  if (roundStops.length) {
    needs.push({
      t: `${roundStops.length} Dark Desk file${roundStops.length === 1 ? "" : "s"} ready for another round`,
      to: "/desk/dark",
      openDark: roundStops[0]!.id,
      quiet: true,
    });
  }

  /*
    TODAY'S WORK, counted from what the desk already knows. Nothing here is a
    new source of truth: "new today" comes off `leads`, the writing/checking
    counts off the same draft rows the Drafts screen prints, and "ready to
    print" is that screen's `ready` state -- a draft that has cleared both
    checks. The four step numbers on the strip and the lists below them are the
    same numbers, so the page cannot say two things at once.
  */
  const draftRows = drafts.data ?? [];
  const nowMs = useNowMs(
    draftRows.some((r) => r.job_status === "running" || r.job_status === "queued") ||
      Boolean(recentStories.data?.some((s) => s.status === "running" || s.status === "queued")),
  );
  const draftStates: DeskDraftState[] = draftRows.map((row) =>
    deskDraftState(row, deskDraftElapsed(row.job_started_at ?? row.job_updated_at, nowMs)),
  );
  const writingNow = draftStates.filter((s) => s.running).length;
  const readyToCheck = draftStates.filter((s) => s.needsYou).length;
  const readyToPrint = draftStates.filter((s) => s.key === "ready").length;
  const runningJobs = (recentStories.data ?? []).filter(
    (story) => story.status === "running" || story.status === "queued",
  );
  const today = formatDate(new Date(nowMs));
  const newToday = allLeads.filter((l) => formatDate(l.created_at) === today).length;
  const heldCount = allLeads.filter((l) => l.status === "held").length;
  const newLeads = queue.slice(0, 8);
  const sectionName = (topic: string | null) =>
    (topic && sectionQuery.sections.find((s) => s.key === topic)?.name) || topic || "";

  /*
    The four steps of the strip, in the order the drawing draws them. The step
    that has work waiting is the yellow one -- and when none of the first three
    does, it is the fourth, because the paper is the step that is always left.
  */
  const currentStep = newToday > 0 ? 1 : writingNow > 0 ? 2 : readyToCheck > 0 ? 3 : 4;
  const STEPS: {
    n: number;
    name: string;
    count: number;
    unit: string;
    act: string;
    to: "/desk/queue" | "/desk/drafts" | "/desk";
    hash?: "tonight";
  }[] = [
    { n: 1, name: "Pick leads", count: newToday, unit: "new today", act: "Review leads", to: "/desk/queue" },
    { n: 2, name: "Draft", count: writingNow, unit: "writing now", act: "Watch progress", to: "/desk/drafts" },
    { n: 3, name: "Check", count: readyToCheck, unit: "ready to check", act: "Check draft", to: "/desk/drafts" },
    { n: 4, name: "Publish", count: readyToPrint, unit: "ready to print", act: "Tonight’s edition", to: "/desk", hash: "tonight" },
  ];

  /*
    The checklist chips, one per gate the desk actually stores. A gate that was
    never run says so ("not run") instead of borrowing the look of a pass, and
    the section chip names the section the draft is filed under rather than
    asking the editor to confirm something the desk already knows.
  */
  const tonightChips = (row: DraftRow) => ({
    evidence: row.evidence_required
      ? row.evidence_decision
        ? { text: "✓ Evidence checked", tone: "d-ok" }
        : { text: "! Evidence to check", tone: "d-warn" }
      : { text: "○ Evidence check not run", tone: "d-quiet" },
    names:
      row.names_unresolved > 0
        ? {
            text: `! ${row.names_unresolved} name${row.names_unresolved === 1 ? "" : "s"} to review`,
            tone: "d-warn",
          }
        : row.name_check_complete
          ? { text: "✓ Names checked", tone: "d-ok" }
          : { text: "○ Names not checked", tone: "d-quiet" },
    section: row.topic
      ? { text: `✓ Section: ${sectionName(row.topic)}`, tone: "d-ok" }
      : { text: "○ No section yet", tone: "d-quiet" },
  });

  /** The stories tonight actually turns on: through their checks, or waiting
   *  on the editor. Newest work first within each group. */
  const tonightRows = draftRows
    .map((row, index) => ({ row, state: draftStates[index]! }))
    .filter(({ state }) => state.key === "ready" || state.needsYou)
    .sort((a, b) => Number(b.state.key === "ready") - Number(a.state.key === "ready"))
    .slice(0, 3);

  const startDraft = useMutation({
    mutationFn: (leadId: number) =>
      draftLead({ data: { leadId, modelChoice: "auto", modelEffort: defaultModelEffort("auto") } }),
    onSuccess: (res) => {
      announceToDesk(
        res?.ok
          ? "Draft queued — it is writing now."
          : (res && "error" in res && res.error) || "That draft did not start.",
      );
      void qc.invalidateQueries({ queryKey: ["recent-story-work"] });
      void qc.invalidateQueries({ queryKey: ["drafts-desk"] });
    },
    onError: (err) =>
      announceToDesk(err instanceof Error ? err.message : "That draft did not start."),
  });

  /*
    KEYBOARD TRIAGE (README "Interactions & behavior": J/K move, S start,
    H hold, X kill, U back, Enter open, N new lead, ? the sheet).

    Page level, and it stands down the moment the editor is typing: three
    textareas and a file picker live on this page, and a J that moved the list
    instead of typing a letter would make the composer unusable. It also stands
    down for any modified key, so the shell's Ctrl-K and the browser's own
    shortcuts keep working.
  */
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing =
        el?.isContentEditable === true ||
        (el ? /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) : false);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const at = (i: number) => newLeads[Math.max(0, Math.min(i, newLeads.length - 1))];
      const move = (next: number) => {
        if (newLeads.length === 0) return;
        const i = Math.max(0, Math.min(next, newLeads.length - 1));
        setCursor(i);
        announceToDesk(`Selected: ${newLeads[i]!.headline}`);
      };
      const lead = at(cursor);
      switch (e.key.toLowerCase()) {
        case "j":
          move(cursor + 1);
          break;
        case "k":
          move(cursor - 1);
          break;
        case "s":
          if (lead) startDraft.mutate(lead.id);
          break;
        case "h":
          if (lead) setStatus.mutate({ id: lead.id, status: "held" });
          break;
        case "x":
          if (lead) setStatus.mutate({ id: lead.id, status: "killed" });
          break;
        case "u":
          if (lead) setStatus.mutate({ id: lead.id, status: "new" });
          break;
        case "enter":
          if (lead) void navigate({ to: "/desk/story/$leadId", params: { leadId: String(lead.id) } });
          break;
        case "n":
          void navigate({ to: "/desk/queue", hash: "file-lead" });
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const booting = (leads.isPending && !leads.data) || (sources.isPending && !sources.data);
  // The two queries the front page cannot render anything useful without.
  // Everything else on this page degrades gracefully to "empty"; these two
  // don't, so a failed fetch needs its own terminal state rather than an
  // infinite `booting` skeleton or a silently empty desk. Audit UIUX-02.
  const bootFailed = (leads.isError && !leads.data) || (sources.isError && !sources.data);

  return (
    <DeskShell
      title="Good morning. Here’s today’s paper."
      kicker={`${deskDateLine(nowMs, timezone)} · ${city}`}
      lede={
        <div className="today-head-acts">
          <Link to="/desk/queue" hash="file-lead" className="btn">
            + Add a lead
          </Link>
          <Link to="/desk" hash="story-composer" className="btn solid">
            + New story <kbd>N</kbd>
          </Link>
          <Link to="/desk/opinion" className="btn">
            + Opinion
          </Link>
        </div>
      }
    >
      {/*
        Above the two-column grid: the strip, the jobs and tonight's checklist
        run the full width of the desk (their drawn margins are the block-flow
        ones -- `.today-steps`, `.today-running`, `.today-edition`), and the
        grid below them holds the work on the left and the rail on the right.
      */}
      {/*
        THE STEP STRIP (README "1. Today"). Four equal cells with 1px gaps: the
        step's number, its name, the big count and the unit, and the one button
        that goes there. Each count is read off the data below it on this page:
        new today off `leads`, writing off the draft rows' jobs, ready to check
        off the drafts waiting on the editor, ready to print off the drafts that
        have cleared both checks. The cell whose work is waiting is the yellow
        one; when nothing is waiting it is the last one, because the paper is
        the step that is always left.
      */}
      <nav className="today-steps" aria-label="Today’s work">
        {STEPS.map((step) => {
          const on = step.n === currentStep;
          return (
            <div className={"today-step" + (on ? " now" : "")} key={step.n}>
              <span className="today-step-n" aria-hidden>
                {step.n}
              </span>
              <span className="today-step-name">{step.name}</span>
              <span className="today-step-count">{step.count}</span>
              <span className="today-step-unit">{step.unit}</span>
              <Link to={step.to} hash={step.hash} className={"btn" + (on ? " solid" : "")}>
                {step.act}
              </Link>
            </div>
          );
        })}
      </nav>

      {/*
        RUNNING NOW. Every long job the desk is running, read from the same
        ["recent-story-work"] query the shell's Running box and the Drafts
        screen poll -- so the elapsed time in the shell's footer and the time on
        these cards come from one clock (`useNowMs`) and one formatter.
      */}
      {runningJobs.length > 0 ? (
        <section aria-label="Running now">
          <SecHead
            title="Running now"
            count={runningJobs.length}
            sub="Every long job the desk is running, with the stage it is on."
            aside={
              <Link to="/desk/drafts" className="np-link">
                All drafts
              </Link>
            }
          />
          <div className="today-running">
            {runningJobs.map((story) => {
              const job: RunningJob = {
                id: story.id,
                headline: story.headline,
                status: story.status,
                stage: story.stage,
                started_at: story.started_at,
                updated_at: story.updated_at,
              };
              return (
                <div key={story.id}>
                  {/* LANE-2 SLOT: lane 2's Job card replaces this JobSlot. The
                      screen hands it the job row and the clock and renders
                      nothing else, so the swap is one line. The Open press
                      stays outside the slot and goes when the card lands --
                      the drawn card owns its own Open in the Done state, and
                      until then a running job on Today must not be a dead
                      end. */}
                  <JobSlot job={job} nowMs={nowMs} compact />
                  <Link
                    className="btn"
                    to="/desk/story/$leadId"
                    params={{ leadId: String(story.lead_id) }}
                  >
                    Open
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/*
        TONIGHT'S EDITION. The checklist the editor needs before the paper goes
        out, built from the drafts' own gate fields -- never from a second
        opinion about them. Every chip is a fact the desk stored: the evidence
        review's required/decision, the name check, and the section the draft is
        filed under. A chip with nothing behind it says "not run" rather than
        claiming a pass. "Preview viewed" is in the drawing and has no backend;
        it is deliberately absent (see the unit report).
      */}
      <section id="tonight" aria-label="Tonight’s edition">
        <SecHead
          title="Tonight’s edition"
          count={readyToPrint + readyToCheck}
          sub="What still has to be true before the paper goes out."
          aside={
            <Link to="/desk/drafts" className="np-link">
              All drafts
            </Link>
          }
        />
        {tonightRows.length === 0 ? (
          <p className="wire-sum">
            No story is through its checks yet. A draft arrives here once it is written and you
            have checked its evidence and its names.
          </p>
        ) : (
          <div className="today-edition">
            {tonightRows.map(({ row, state }) => {
              const chips = tonightChips(row);
              return (
                <div className="today-edition-row" key={row.id}>
                  <div>
                    <span className="today-edition-sec">
                      {sectionName(row.topic) || "No section"}
                    </span>
                    <Link
                      to="/desk/story/$leadId"
                      params={{ leadId: String(row.lead_id) }}
                      className="today-edition-hl hl-link"
                    >
                      {row.headline}
                    </Link>
                    <span className="today-edition-chips">
                      <span className={"chip " + stateTone(state)}>{state.label}</span>
                      <span className={"chip " + chips.evidence.tone}>{chips.evidence.text}</span>
                      <span className={"chip " + chips.names.tone}>{chips.names.text}</span>
                      <span className={"chip " + chips.section.tone}>{chips.section.text}</span>
                    </span>
                  </div>
                  {/*
                    The one next-action button on the row, in the draft's own
                    vocabulary (lib/news/desk-drafts.ts) -- the same word the
                    Drafts screen puts on the same draft.
                  */}
                  <div className="today-edition-act">
                    <Link
                      to="/desk/story/$leadId"
                      params={{ leadId: String(row.lead_id) }}
                      className="btn"
                    >
                      {deskDraftAction(state)}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* The two columns of the rest of Today: the work, and the rail beside
          it. Everything below to the closing tag is an item in this grid
          (`display:contents` on .desk-cc-grid keeps the nested sections in it
          too), and each one is pinned by its own class -- see the grid rules
          in desk-astra.css. */}
      <div className="desk-home">
        <section className="recent-story-work in-progress" aria-label="In progress">
          <SecHead
            title="In progress"
            count={(recentStories.data ?? []).length}
            sub="Nothing here prints until you press Publish."
            aside={
              <Link to="/desk/drafts" className="np-link">
                All drafts
              </Link>
            }
          />
          {recentStories.isError ? (
            <p role="alert">
              Recent drafts could not load.{" "}
              <button type="button" className="btn" onClick={() => void recentStories.refetch()}>
                Try again
              </button>
            </p>
          ) : recentStories.isPending ? (
            <p role="status">Loading your drafts…</p>
          ) : !recentStories.data?.length ? (
            <p>No drafts started yet. Add your sources below to begin.</p>
          ) : (
            <div className="today-cards">
              {recentStories.data.map((story) => (
                /*
                  The drawn card carries the stage in its 4px top rule: yellow
                  while the desk is writing, ink once the draft is ready to
                  edit, line for everything else (queued, or stopped with a
                  reason). The stage is also in words, because the rule alone
                  is a colour and the desk never says a state in colour only.
                */
                <article
                  className={
                    "today-card " +
                    (story.status === "running"
                      ? "live"
                      : story.status === "completed"
                        ? "mine"
                        : "idle")
                  }
                  key={story.id}
                >
                  <span className="today-card-stage">
                    {story.status === "completed"
                      ? "Ready to edit"
                      : story.status === "failed"
                        ? "Needs attention"
                        : story.status === "queued"
                          ? "Queued"
                          : "Writing in progress"}
                  </span>
                  <h3 className="today-card-hl">
                    <Link
                      to="/desk/story/$leadId"
                      params={{ leadId: String(story.lead_id) }}
                      className="hl-link"
                    >
                      {story.headline}
                    </Link>
                  </h3>
                  <p className="meta">
                    {story.status === "completed"
                      ? "Draft saved. Review it before publishing."
                      : story.status === "failed"
                        ? "Open the story to see what stopped and resume."
                        : story.stage || "Waiting to start"}
                  </p>
                  {/*
                    One press, not two: the drawn card's "next action and
                    Open" both land on the story page, and two buttons that go
                    to the same place make the editor choose for nothing.
                  */}
                  <Link
                    to="/desk/story/$leadId"
                    params={{ leadId: String(story.lead_id) }}
                    className="btn"
                  >
                    {story.status === "running" || story.status === "queued"
                      ? "View progress"
                      : "Open draft"}
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>

        <section
          id="story-composer"
          className="composer story-composer"
          aria-labelledby="story-composer-title"
        >
          <header className="story-composer-heading">
            <div>
              <p className="composer-eyebrow">Start a draft</p>
              <h2 id="story-composer-title">Write a story</h2>
            </div>
            <p>
              Bring your sources. Tell us the angle.
              <br />
              You review the draft before anything is published.
            </p>
          </header>
          <div className="composer-sources">
            <StoryDocumentUpload
              documents={storyDocuments}
              onChange={setStoryDocuments}
              onBusy={setUploadingDocuments}
              disabled={writeStory.isPending}
            />
            <div className="composer-pasted">
              <label htmlFor="story-source-text">Links or source text</label>
              <p>
                Paste website, PDF or YouTube links, or a full transcript. You can combine these
                with attached files.
              </p>
              <textarea
                id="story-source-text"
                className={areaClass}
                rows={6}
                value={storyText}
                disabled={writeStory.isPending}
                onChange={(e) => setStoryText(e.target.value)}
                placeholder="Paste source links or text here…"
              />
              <span className="composer-source-note">
                Original documents are saved in full. Scanned pages and images are read with OCR.
              </span>
            </div>
          </div>
          <div className="composer-instructions">
            <label htmlFor="story-instructions">What story do you want?</label>
            <span>Give an angle, a question to answer, or points to emphasize.</span>
            <textarea
              id="story-instructions"
              className={areaClass}
              rows={3}
              value={storyInstructions}
              disabled={writeStory.isPending}
              onChange={(e) => setStoryInstructions(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (
                    !writeStory.isPending &&
                    !uploadingDocuments &&
                    (storyInput.length >= 8 || storyDocuments.length)
                  )
                    writeStory.mutate();
                }
              }}
              placeholder="For example: Explain what the council decided, what it will cost, and what happens next."
            />
          </div>
          <details className="composer-options">
            <summary>
              Research & section{" "}
              <span>
                {storyScope === "public" ? "Public research enabled" : "Supplied material only"} ·{" "}
                {storySection || "Section suggested automatically"}
              </span>
            </summary>
            <div className="composer-options-grid">
              <DraftScopePicker
                value={storyScope}
                onChange={setStoryScope}
                disabled={writeStory.isPending}
              />
              <label>
                <span>Section (optional)</span>
                <select
                  value={storySection}
                  onChange={(e) => setStorySection(e.target.value)}
                  disabled={writeStory.isPending || sectionQuery.isPending}
                >
                  <option value="">Suggest from text — current default</option>
                  {sectionQuery.sections
                    .filter((s) => s.key !== "about" && s.key !== "opinion")
                    .map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name}
                      </option>
                    ))}
                  {storySection && !sectionQuery.sections.some((s) => s.key === storySection) ? (
                    <option value={storySection}>
                      Previous selection unavailable — choose again
                    </option>
                  ) : null}
                </select>
                <p>
                  {sectionQuery.isPending
                    ? "Loading sections…"
                    : sectionQuery.isError
                      ? "Sections could not load. Automatic selection is still available."
                      : "You can change the section after drafting."}
                </p>
              </label>
            </div>
          </details>
          <footer className="composer-footer">
            <ModelPicker
              scope="story"
              value={storyModel}
              onChange={(choice) => {
                setStoryModel(choice);
                setStoryModelEffort(defaultModelEffort(choice));
              }}
              effort={storyModelEffort}
              onEffortChange={setStoryModelEffort}
              disabled={writeStory.isPending}
            />
            <div className="composer-submit">
              <InkButton
                tone="solid"
                onClick={() => writeStory.mutate()}
                disabled={
                  writeStory.isPending ||
                  uploadingDocuments ||
                  (storyInput.length < 8 && !storyDocuments.length)
                }
              >
                {writeStory.isPending ? "Starting draft…" : "Write draft"}
              </InkButton>
              <p>
                {uploadingDocuments
                  ? "Waiting for your documents to finish uploading."
                  : "Creates a draft for your review."}
              </p>
            </div>
          </footer>
          <div role="alert" aria-live="assertive" aria-atomic="true" className="composer-error">
            {storyNotice?.kind === "error" ? storyNotice.text : ""}
            {storyNotice?.leadId ? (
              <p>
                Your material is saved.{" "}
                <Link
                  to="/desk/story/$leadId"
                  params={{ leadId: String(storyNotice.leadId) }}
                  className="inline-link"
                >
                  Open the saved story to choose a model and continue
                </Link>
                .
              </p>
            ) : null}
            {storyNotice?.kind === "error" &&
            looksLikeProviderAuthFailure(storyNotice.authDetail) ? (
              <ProviderSignInButton detail={storyNotice.authDetail} />
            ) : null}
          </div>
        </section>

        {/*
          The second choice, right where the first one is.

          Before this, a finished story could not be brought to the desk at all
          unless it was an Opinion column. Pasting a report into "Write a story"
          made the model rewrite it, which is the opposite of importing one: the
          owner asked for the words to be kept exactly as written and for no
          model to be run to find the stories. So this panel takes the paste and
          hands it to a screen whose only job is to read it and let an editor
          check every card.
        */}
        <section
          id="import-story"
          className="composer story-composer"
          aria-labelledby="import-story-title"
        >
          <header className="story-composer-heading">
            <div>
              <p className="composer-eyebrow">Or bring one already written</p>
              <h2 id="import-story-title">Import finished stories</h2>
            </div>
            <p>
              Paste one story or a whole report. The text is kept exactly as written.
            </p>
          </header>
          <div className="composer-sources">
            <div className="composer-pasted">
              <label htmlFor="import-source-text">The story, or the whole report</label>
              <p>
                A story on its own, or a report with headings — one story per heading. Its source
                links come across with it. A saved page (.md, .txt, .html) can be chosen instead.
              </p>
              <textarea
                id="import-source-text"
                className={areaClass}
                rows={6}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                maxLength={IMPORT_LIMITS.text}
                placeholder={"# A report title, if it has one\n\n### 1. The headline of the first story\nThe body of the story, exactly as it was written. [A source](https://example.test/record)"}
              />
              <label htmlFor="import-source-file" className="composer-source-note">
                Or choose a file (.md, .txt, .html)
              </label>
              <input
                id="import-source-file"
                type="file"
                accept=".md,.markdown,.txt,.html,.htm,text/plain,text/markdown,text/html"
                className={inputClass}
                onChange={(e) => void readImportFile(e.target.files?.[0])}
              />
              <span className="composer-source-note">
                Nothing is saved or published yet. Next you check each story — its headline, its
                section, its text and its sources — and only the ones you tick are imported.
              </span>
            </div>
          </div>
          <footer className="composer-footer">
            <div className="composer-submit">
              <InkButton
                tone="solid"
                onClick={() => {
                  try {
                    sessionStorage.setItem(IMPORT_PASTE_KEY, importText);
                  } catch {
                    /* ignore */
                  }
                  void navigate({ to: "/desk/import" });
                }}
                disabled={importText.trim().length < 20}
              >
                Read the stories
              </InkButton>
              <p>
                Opens the import screen with this text in the box.{" "}
                <Link to="/desk/import" className="inline-link">
                  Go there on its own
                </Link>
                .
              </p>
            </div>
          </footer>
        </section>

        {/*
          The third choice: one story, already written, straight to the Queue.

          The owner asked for the Opinion desk's "Paste a piece I wrote" on the
          news side (2026-09-24): "just one, to dump in the queue, as a regular
          non-opinion story for massaging later via the queue." No review
          screen, no model, no second save path -- it files the same card the
          import screen files, through the same server function.
        */}
        <section
          id="paste-one-story"
          className="composer story-composer"
          aria-labelledby="paste-one-story-title"
        >
          <header className="story-composer-heading">
            <div>
              <p className="composer-eyebrow">Or one you already wrote</p>
              <h2 id="paste-one-story-title">Paste a story I already have</h2>
            </div>
            <p>One finished story. It goes to the Queue as a draft for you to work on there.</p>
          </header>
          <div className="composer-sources">
            <div className="composer-pasted">
              <label htmlFor="paste-one-text">The story</label>
              <p>
                Paste it as it is. Nothing is rewritten and no AI reads it — the paste becomes the
                draft, with its first line as the headline if you leave that empty. Its links come
                across as the story&rsquo;s sources.
              </p>
              <textarea
                id="paste-one-text"
                className={areaClass}
                rows={14}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                maxLength={IMPORT_LIMITS.text}
                placeholder={
                  "Council votes to bring the rules back for consideration\n\nThe council voted 5-2 on Tuesday. [The packet](https://example.test/packet)"
                }
              />
              <label htmlFor="paste-one-headline" className="composer-source-note">
                Headline — leave it empty and the first line becomes the headline
              </label>
              <input
                id="paste-one-headline"
                className={inputClass}
                value={pasteHeadline}
                onChange={(e) => setPasteHeadline(e.target.value)}
                maxLength={IMPORT_LIMITS.headline}
                placeholder="Taken from the first line if you leave this empty"
              />
              <label htmlFor="paste-one-section" className="composer-source-note">
                Section
              </label>
              <select
                id="paste-one-section"
                className={inputClass}
                value={pasteSection}
                disabled={sectionQuery.sections.length === 0}
                onChange={(e) => setPasteSection(e.target.value)}
              >
                <option value={NO_SECTION}>{SECTION_REQUIRED}</option>
                {sectionQuery.sections.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="composer-source-note">
                {sectionQuery.sections.length === 0
                  ? "Your sections could not load, and there is nothing to file this under without one. Try again in a moment."
                  : "Pick one to add it — and you still confirm it in the story editor before it can publish."}
              </span>
              <label htmlFor="paste-one-disclosure" className="composer-source-note">
                Who wrote this — the line readers see
              </label>
              <select
                id="paste-one-disclosure"
                className={inputClass}
                value={pasteDisclosure}
                onChange={(e) => setPasteDisclosure(e.target.value as DisclosureKey)}
              >
                {IMPORT_DISCLOSURES.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
              {pasteDisclosure === "other" ? (
                <input
                  className={inputClass}
                  value={pasteOther}
                  onChange={(e) => setPasteOther(e.target.value)}
                  placeholder="The line to print under the story"
                  aria-label="The disclosure line to print"
                />
              ) : (
                <span className="composer-source-note">
                  {IMPORT_DISCLOSURES.find((d) => d.key === pasteDisclosure)?.line}
                </span>
              )}
              <span className="composer-source-note">
                Nothing is published. The story lands in the Queue as a news draft, editable like
                any other — you can publish it whenever it is ready.
              </span>
            </div>
          </div>
          <footer className="composer-footer">
            <div className="composer-submit">
              <InkButton
                tone="solid"
                onClick={() => void pasteStory.mutate()}
                disabled={pasteText.trim().length < 40 || pasteStory.isPending}
              >
                {pasteStory.isPending ? "Adding…" : "Add to Queue"}
              </InkButton>
              <p>No screen to check first. One story in, one draft in the Queue.</p>
            </div>
          </footer>
          {pasteNotice ? (
            <p className="composer-source-note" role="status">
              {pasteNotice}
            </p>
          ) : null}
          {pasted ? (
            <p className="composer-source-note" role="status">
              Added to the Queue as a draft. Nothing is published.{" "}
              <Link to="/desk/story/$leadId" params={{ leadId: String(pasted.leadId) }} className="inline-link">
                Open it
              </Link>
              .
              {pasted.duplicate ? (
                <>
                  {" "}
                  {duplicateNote(pasted.duplicate)}{" "}
                  {pasted.duplicate.slug ? (
                    <Link to="/articles/$slug" params={{ slug: pasted.duplicate.slug }} className="inline-link">
                      Read the printed one
                    </Link>
                  ) : pasted.duplicate.leadId ? (
                    <Link
                      to="/desk/story/$leadId"
                      params={{ leadId: String(pasted.duplicate.leadId) }}
                      className="inline-link"
                    >
                      Open the one on the desk
                    </Link>
                  ) : null}
                </>
              ) : null}
            </p>
          ) : null}
        </section>

        {needs.length > 0 ? (
          <div className="needs">
            <span className="needs-label">Needs you</span>
            {needs.map((n) => (
              <Link
                key={n.t}
                to={n.to}
                className={"needs-item" + (n.quiet ? " quiet" : "")}
                onClick={() => {
                  if (n.openDark == null) return;
                  try {
                    sessionStorage.setItem(OPEN_KEY, String(n.openDark));
                  } catch {
                    /* ignore */
                  }
                }}
              >
                {n.t}
              </Link>
            ))}
          </div>
        ) : null}
        {bootFailed ? (
          <ScreenError
            message={
              (leads.error instanceof Error && leads.error.message) ||
              (sources.error instanceof Error && sources.error.message) ||
              "Could not load the desk."
            }
            onRetry={() => {
              void leads.refetch();
              void sources.refetch();
            }}
            retrying={leads.isRefetching || sources.isRefetching}
          />
        ) : booting ? (
          <ListSkeleton rows={6} />
        ) : (
          <div className="desk-cc-grid">
            <section className="gc-queue" aria-label="New leads">
              <div className="today-leads-head">
                <SecHead
                  title="New leads"
                  sub={last ? `${formatDateTime(last.started_at)} scan · best first` : "Best first"}
                  aside={
                    <span className="today-filters">
                      <span>Open · {queue.length - heldCount}</span>
                      <span>Held · {heldCount}</span>
                      <Link to="/desk/queue" className="np-link">
                        All leads in the Queue
                      </Link>
                    </span>
                  }
                />
              </div>
              {queue.length === 0 ? (
                !last && publishedCount === 0 ? (
                  <p className="wire-sum">
                    Queue is empty —{" "}
                    <Link to="/desk/scan" className="inline-link">
                      run the first scan
                    </Link>{" "}
                    or{" "}
                    <Link to="/desk/queue" className="inline-link">
                      file a lead
                    </Link>
                    .
                  </p>
                ) : (
                  <p className="wire-sum">
                    {workingQueueEmptyCopy({
                      publishedCount,
                      lastScan: last
                        ? {
                            leads_created: last.leads_created,
                            sources_fetched: last.sources_fetched,
                            error: last.error,
                          }
                        : null,
                    })}{" "}
                    <Link to="/desk/scan" className="inline-link">
                      Run the scan again
                    </Link>
                    {publishedCount > 0 ? (
                      <>
                        {" · "}
                        <Link to="/desk/published" className="inline-link">
                          Published
                        </Link>
                      </>
                    ) : null}
                    .
                  </p>
                )
              ) : (
                <>
                  {/*
                    README "Interactions & behavior": the keys are on the screen,
                    not only in the "?" sheet -- an editor triaging a list should
                    not have to open a dialog to learn what J does.
                  */}
                  <p className="today-legend" aria-label="Keys for this list">
                    {TRIAGE_KEYS.map(([key, what]) => (
                      <span key={key}>
                        <kbd>{key}</kbd> {what}
                      </span>
                    ))}
                  </p>
                  {newLeads.map((l, index) => {
                    const dup = nearDuplicate(l, printed);
                    const held = l.status === "held";
                    return (
                      /*
                        The drawn compact row: `52px | 1fr | auto` -- score
                        badge, the title with its why line and its badges, and
                        the three presses an editor makes on a lead. The
                        heavier presses (kill as duplicate, delete, the model
                        picker) stay on the Queue's full row, which is where
                        the desk draws them.
                      */
                      <div
                        className={
                          "today-lead" +
                          (index === cursor ? " sel" : "") +
                          (held ? " acted" : "")
                        }
                        key={l.id}
                      >
                        <Score v={l.newsworthiness ?? 0} />
                        <div>
                          <Link
                            to="/desk/story/$leadId"
                            params={{ leadId: String(l.id) }}
                            className="today-lead-hl hl-link"
                          >
                            {l.headline}
                          </Link>
                          <p className="today-lead-why">{l.why}</p>
                          <div className="today-lead-row2">
                            <span className="meta">
                              {l.topic} · {formatAge(l.created_at)} · {leadOrigin(l)}
                            </span>
                            <Chip s={l.status} />
                            {l.possible_duplicate ? (
                              <Link
                                to="/desk/story/$leadId"
                                params={{ leadId: String(l.id) }}
                                className="chip maybe-same"
                                title={
                                  l.dup_kind === "developing"
                                    ? `This story came back with facts the killed lead "${l.possible_duplicate.headline}" did not have. Open it to compare.`
                                    : `Possible duplicate of ${l.possible_duplicate.headline} (${l.possible_duplicate.status}). Open it to compare.`
                                }
                              >
                                {l.dup_kind === "developing"
                                  ? "New facts · compare"
                                  : "Possible duplicate · compare"}
                              </Link>
                            ) : null}
                          </div>
                          {/*
                            Same component the Queue's row renders, so the two
                            screens cannot drift on what the desk has found.
                          */}
                          <LeadFlags lead={l} dup={dup} />
                        </div>
                        <span className="today-lead-side">
                          <InkButton onClick={() => startDraft.mutate(l.id)}>
                            Start story <kbd>S</kbd>
                          </InkButton>
                          {held ? (
                            <InkButton
                              tone="quiet"
                              onClick={() => setStatus.mutate({ id: l.id, status: "new" })}
                            >
                              Back <kbd>U</kbd>
                            </InkButton>
                          ) : (
                            <InkButton
                              tone="quiet"
                              onClick={() => setStatus.mutate({ id: l.id, status: "held" })}
                            >
                              Hold <kbd>H</kbd>
                            </InkButton>
                          )}
                          <InkButton
                            tone="quiet-danger"
                            onClick={() => setStatus.mutate({ id: l.id, status: "killed" })}
                          >
                            Kill <kbd>X</kbd>
                          </InkButton>
                          <DeskMoreMenu
                            ariaLabel={`More actions for ${l.headline}`}
                            items={[
                              {
                                label: "Open the lead",
                                onSelect: () =>
                                  void navigate({
                                    to: "/desk/story/$leadId",
                                    params: { leadId: String(l.id) },
                                  }),
                              },
                              ...(dup
                                ? [
                                    {
                                      label: "The piece it matches",
                                      onSelect: () =>
                                        void navigate({
                                          to: "/articles/$slug",
                                          params: { slug: dup.slug },
                                        }),
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </section>

            <section className="nightpanel gc-darkdesk">
              <SecHead
                title="Dark Desk"
                aside={
                  <Link to="/desk/dark" className="np-link">
                    Open the desk
                  </Link>
                }
              />
              <p className="np-note">Investigates. Never prints.</p>
              {darkErr ? <p className="note err">{darkErr}</p> : null}
              {inbox.length === 0 && onDesk.length === 0 ? (
                <p className="wire-sum">
                  Nothing new tonight.{" "}
                  <Link to="/desk/dark" className="inline-link">
                    Start from a tip
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <p className="np-pile">To look at · {inbox.length}</p>
                  {inbox.slice(0, 3).map((item) => (
                    <div key={item.id} className="np-item">
                      <p className="np-kind">{editorKindLabel(item.kind)}</p>
                      <p className="np-title">{item.title}</p>
                      {item.source_line ? <p className="np-meta">{item.source_line}</p> : null}
                      <div className="np-acts">
                        <InkButton
                          tone="invert"
                          small
                          disabled={startDark.isPending}
                          onClick={() => startDark.mutate({ seed: item.seed, title: item.title })}
                        >
                          Start digging
                        </InkButton>
                      </div>
                    </div>
                  ))}
                  <p className="np-pile">On the desk · {onDesk.length}</p>
                  {onDesk.slice(0, 3).map((row) => (
                    <div key={row.id} className="np-item">
                      <p className="np-kind">{editorStatus(row.status)}</p>
                      <p className="np-title">{row.title}</p>
                      <p className="np-meta">
                        {Number(row.records ?? 0)} records · {Number(row.still_open ?? 0)} still to
                        open
                      </p>
                      <div className="np-acts">
                        <Link
                          to="/desk/dark"
                          className="btn solid small"
                          onClick={() => {
                            try {
                              sessionStorage.setItem(OPEN_KEY, String(row.id));
                            } catch {
                              /* ignore */
                            }
                          }}
                        >
                          Open file
                        </Link>
                      </div>
                    </div>
                  ))}
                  <p className="np-pile">
                    Set aside · {aside.length}{" "}
                    <Link to="/desk/dark" className="np-link">
                      see the pile
                    </Link>
                  </p>
                </>
              )}
            </section>

            <section id="desk-followups" className="gc-followups">
              <SecHead
                title={`Follow-ups · ${followUps.data?.length ?? 0}`}
                aside={
                  <Link to="/desk/follow-ups" className="np-link">
                    All follow-ups
                  </Link>
                }
                sub={
                  followUpsRailCopy(followUps.isError) ??
                  ((followUps.data ?? []).length === 0
                    ? "No one owes you an answer right now."
                    : undefined)
                }
              />
              {followUps.isError || (followUps.data ?? []).length === 0
                ? null
                : (followUps.data ?? [])
                    .slice(0, 3)
                    .map((f) => (
                      <FollowUpItem
                        key={f.id}
                        item={f}
                        onReply={(replyText, repliedOn) =>
                          replyFollowUp.mutate({ id: f.id, replyText, repliedOn })
                        }
                        onNudge={() => nudgeFollow.mutate(f.id)}
                        onDrop={() => dropFollow.mutate(f.id)}
                        nudging={nudgeFollow.isPending}
                        dropping={dropFollow.isPending}
                        replying={replyFollowUp.isPending}
                      />
                    ))}
            </section>

            <section className="wirecol gc-wire">
              <SecHead
                title="The wire"
                aside={
                  <InkButton small disabled={scanning} onClick={() => scan.mutate()}>
                    {scanning ? "Scanning…" : "Run scan"}
                  </InkButton>
                }
              />
              {scanning ? <Busy label="Fetching the watch list, then one pass for leads." /> : null}
              {last ? (
                <>
                  <p className="wire-line">
                    <b>Last scan</b> · {formatDateTime(last.started_at)} ·{" "}
                    {last.leads_created > 0 ? (
                      scanCountsLine(last)
                    ) : (
                      <>
                        {last.sources_fetched} fetched · <b>filed nothing</b>
                      </>
                    )}
                  </p>
                  {/*
                  The scan note (PrimeGov summary / why-zero explanation) can
                  run to several sentences -- a rail this narrow cannot carry
                  it inline without becoming a wall of text, so it reads
                  collapsed by default. The one-line stat above is always
                  visible; nothing is lost, only tucked behind a click.
                */}
                  {scanZeroWhy(last) ? (
                    <details className="wire-flaky">
                      <summary>Read the scan note</summary>
                      <p className="wire-sum">{scanZeroWhy(last)}</p>
                    </details>
                  ) : null}
                  {last.error && last.leads_created > 0 ? (
                    <p className="wire-warn">{editorScanError(last.error)}</p>
                  ) : null}
                </>
              ) : (
                <p className="wire-sum">No scans yet — the watch list is ready.</p>
              )}
              <div className="wire-block">
                <p className="wire-line">
                  <b>Source health</b> · {accepted.length} on watch
                  {officialFail.length ? ` · ${officialFail.length} failing` : ""}
                  {flakyFail.length ? ` · ${flakyFail.length} flaky` : ""}
                  {" · "}
                  <Link to="/desk/sources" className="np-link">
                    Sources
                  </Link>
                </p>
                {officialFail.map((s) => (
                  <p key={s.id} className="wire-warn">
                    {s.title} — {editorFetchError(s.last_error, s.url) ?? s.last_error}
                  </p>
                ))}
                {flakyFail.length ? (
                  <details className="wire-flaky">
                    <summary>{flakyFailureCopy(flakyFail.length)}</summary>
                    {flakyFail.map((s) => (
                      <p key={s.id}>
                        {s.title} — {editorFetchError(s.last_error, s.url) ?? s.last_error}
                      </p>
                    ))}
                  </details>
                ) : null}
                {!officialFail.length && !flakyFail.length ? (
                  <p className="meta">All quiet.</p>
                ) : null}
              </div>
              {proposed.length ? (
                <div className="wire-block">
                  <p className="wire-line">
                    <b>Suggested sources</b> · {proposed.length}
                  </p>
                  {proposed.slice(0, 5).map((s) => (
                    <div key={s.id} className="wire-row wire-proposed">
                      <span title={s.title}>{s.title}</span>
                      {/* Who found it. The rail is a triage shortcut and has no
                          room for the reason; the list on Sources carries it. */}
                      <span className="meta-inline">{suggestedByLabel(s.proposed_by)}</span>
                      <span className="wire-proposed-acts">
                        <InkButton
                          tone="quiet"
                          small
                          onClick={() => srcStatus.mutate({ id: s.id, status: "accepted" })}
                        >
                          Accept
                        </InkButton>
                        <InkButton
                          tone="quiet"
                          small
                          onClick={() => srcStatus.mutate({ id: s.id, status: "rejected" })}
                        >
                          Drop
                        </InkButton>
                      </span>
                    </div>
                  ))}
                  {proposed.length > 5 ? (
                    <p className="wire-sum">
                      {proposed.length - 5} more suggested ·{" "}
                      <Link to="/desk/sources" search={{ tab: "proposed" }} className="inline-link">
                        Review them in Suggested sources
                      </Link>
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="wire-block">
                <p className="wire-line">
                  <b>On the paper</b>
                </p>
                {(published.data ?? []).slice(0, 3).map((p) => (
                  <p key={p.id} className="wire-row">
                    <Link to="/articles/$slug" params={{ slug: p.slug }} className="hl-link sm">
                      {p.headline}
                    </Link>
                    <span className="meta-inline">
                      {formatShortDate(p.published_at)}
                      {p.corrections.length ? " · corrected" : ""}
                    </span>
                  </p>
                ))}
                {(published.data ?? []).length === 0 ? (
                  <p className="meta">Empty until you publish.</p>
                ) : null}
              </div>
              <div className="wire-block">
                <p className="wire-line">
                  <b>Beat memory</b> · what we already covered
                </p>
                {(memory.data ?? []).slice(0, 4).map((m) => (
                  <p key={m.id} className="wire-row wire-mem-row" title={m.last_angle}>
                    <b className="mem-e">{m.entity}</b>
                  </p>
                ))}
                {/* Every sibling widget explains its empty state; this one rendered
                  a bare heading over nothing (UX-002). */}
                {(memory.data ?? []).length === 0 ? (
                  <p className="meta">No beat memory yet — it builds as you publish.</p>
                ) : null}
              </div>
            </section>
          </div>
        )}
      </div>
    </DeskShell>
  );
}
