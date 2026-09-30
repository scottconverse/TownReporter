import { DraftScopePicker } from "@/components/draft-scope-picker";
import { DeskJobCard } from "@/components/JobCard";
import { useDeskJobs } from "@/components/job-card-state";
import { useEditorSections } from "@/lib/use-sections";
import { StoryDocumentUpload, type StoryUpload } from "@/components/story-documents";
import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { firstRunSetupState } from "@/lib/news/paper-settings";
import { deskRowChecks, evidenceChip, namesChip } from "@/lib/news/check-gates";
import { Busy, InkButton, Score, SecHead } from "@/components/desk-chrome";
import { useNowMs } from "@/components/desk-jobs";
import { areaClass, announceToDesk, inputClass, leadOrigin } from "@/components/desk-chrome-utils";
import { LeadFlags } from "@/components/desk-leads";
import { formatAge, parseUrlList } from "@/lib/paper";
import { DeskShell } from "@/components/desk-chrome";
import { ListSkeleton, ScreenError } from "@/components/states";
import {
  draftLead,
  importFinishedStories,
  listDraftsDesk,
  listFollowUpFindings,
  listFollowUps,
  listLeads,
  listRecentStoryWork,
  listMemory,
  listPublishedDesk,
  listScans,
  listSources,
  runScan,
  setLeadStatus,
  setSourceStatus,
  writeStoryFromInput,
} from "@/lib/news/desk";
import { AddLeadButton, HoldLeadDialog, NewStoryDialog } from "@/components/dialogs";
/*
  Unit BW, item 2: the drawn Kill dialog (phase 2b, `dialog-09-kill.png`) is
  imported from its own module rather than through the `@/components/dialogs`
  barrel, which re-exports `editor-dialogs` only. `/desk/story/$leadId` does the
  same, and that is where this dialog has been mounted since phase 2b.
*/
import { KillDialog } from "@/components/dialogs/KillDialog";
import {
  cardResultLine,
  isAgentKind,
  matchesFollowUpFilter,
  parseFinding,
} from "@/lib/news/follow-up-copy";
import { IMPORT_DISCLOSURES, IMPORT_LIMITS, type DisclosureKey } from "@/lib/news/import-stories";
import {
  NO_SECTION,
  SECTION_REQUIRED,
  cardProblems,
  duplicateNoteAfterSave,
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
  nearDuplicate,
  openLeads,
  parseFailedSources,
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
import { Dialog } from "@/components/dialog";
import { modelChoiceLabel, type StoryModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { looksLikeProviderAuthFailure } from "@/lib/news/preflight";

export const Route = createFileRoute("/desk/")({ component: DeskHome });

const OPEN_KEY = "townreporter.dark.openId";

type DraftRow = Awaited<ReturnType<typeof listDraftsDesk>>[number];

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

/**
 * The two ways into the desk that used to be panels stacked on Today and are
 * now dialogs, each reached by its own hash (defect 2). The name is the hash,
 * so `PanelKey` and the ids the e2e walk looks for cannot drift apart.
 *
 * The third panel, the import drop zone, is not here: it has a screen of its
 * own at /desk/import, linked from this page's composer footer and the nav.
 */
type PanelKey = "story-composer" | "paste-one-story" | null;

function DeskHome() {
  const sectionQuery = useEditorSections();
  /*
    U26b: the paper's own place, from the identity this page already renders.
    The chip below is decided with the same three fields the server's Queue
    counts and the scan's matcher use (`getPaperPlace`), so a lead cannot be
    "already printed" here and not there.
  */
  const { city, state, county, timezone } = usePaper();
  const paperPlace = useMemo(() => ({ city, state, county }), [city, state, county]);
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
  /*
    The two halves of the rail's follow-ups panel, and they are now the same
    half: `listFollowUps` hands back agents only (0.6.81, unit CU -- the manual
    asks it used to include, and the reply/nudge/drop mutations that wrote to
    them, are gone; see DECISIONS.md:38 and :44), and this query reads it for
    the panel's own count. The list itself is the findings query below.
  */
  const followUps = useQuery({
    queryKey: ["follow-ups", "agents"],
    queryFn: () => listFollowUps({ data: {} }),
  });
  /*
    THE RAIL'S OWN HALF OF THE FOLLOW-UPS PANEL (README "1. Today", rail:
    "the latest AI follow-up results").

    A different question from the query above, and a different server
    function: `listFollowUps` is every agent the desk has, and this is what the
    AI agents have already found and are still working -- the rows with a
    `last_state` of `found`. It reads `last_state` and `finding_json` rather
    than the story's notes, so a finding an editor deleted from the notes does
    not come back here. The query is its own key -- `["follow-up-findings"]` is
    not a child of `["follow-ups"]`, so a prefix invalidation reaches one and
    not the other.

    It never publishes and nothing behind it can: a finding is a note and a
    state. Phase 6 (lane 2) wrote the server function; mounting it on Today is
    lane 3's half of that item.
  */
  const findings = useQuery({
    queryKey: ["follow-up-findings"],
    queryFn: () => listFollowUpFindings({ data: {} }),
  });
  /*
    Working agents, by the Follow-ups screen's own definition of "active".

    One query serves both counts on this page: Unit CY's rail pile ("Waiting on
    an AI follow-up") and Unit CU's panel count ("N active"). `listFollowUps`
    returns agent rows only since CU retired the manual asks, so the same list
    answers both -- and reading it once is what keeps the two numbers from
    drifting apart.
  */
  const liveFollowUps = (followUps.data ?? []).filter((row) =>
    matchesFollowUpFilter(row, "active"),
  ).length;

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
  const [pasted, setPasted] = useState<{
    headline: string;
    leadId: number;
    duplicate?: DuplicateWarning;
  } | null>(null);
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
  const inbox = (worth.data ?? []).filter((item) => !worthItemOnDesk(item, invs));
  /*
    CY item 3. "Waiting on an AI follow-up": a live agent that has not reported
    yet. `matchesFollowUpFilter(row, "active")` is the Follow-ups screen's own
    definition of live, and `last_state !== "found"` is the whole difference
    between this pile and the findings list above it. It reads the one
    `followUps` query the rail's count above also reads -- see that query's own
    note -- so the two numbers on this page cannot disagree.
  */
  const waitingOnFollowUp = (followUps.data ?? []).filter(
    (row) =>
      isAgentKind(row.agent_kind) &&
      matchesFollowUpFilter(row, "active") &&
      row.last_state !== "found",
  ).length;
  const printed = published.data ?? [];

  /*
    THE WIRE'S PER-SOURCE ROWS. The drawing gives every watched source one line
    with a state chip and the reason behind it. All three states come from what
    the desk already stored -- never from a second guess about a fetch:

      Could not check  the source is named in the last run's failed_sources,
                       or it carries a last_error from an earlier attempt.
      Changed          the last run filed at least one lead citing this
                       source's URL.
      Checked · no
      change           it was fetched in the last run and filed nothing.

    A source the last run never reached says so instead of claiming a check --
    the same rule the edition's chips follow, and the reason there are four
    states here and three in the drawing.
  */
  const scanFails = parseFailedSources(last?.failed_sources);
  const failReasonFor = (s: (typeof accepted)[number]) => {
    const named = scanFails.find((f) => f.id === s.id || (f.url && f.url === s.url));
    const raw = named?.error ?? s.last_error;
    if (!raw) return null;
    return editorFetchError(raw, s.url) ?? raw;
  };
  const lastRunId = last?.id;
  /*
    Which watched source a lead came from: the run's leads carry the URLs they
    cite, so a source is "changed" exactly when one of the last run's leads
    names its URL. Built as a map so the counting is one pass over the leads
    however many sources are watched.
  */
  const sourceByUrl = new Map(accepted.map((s) => [s.url, s]));
  const citedCount = new Map<number, number>();
  for (const l of allLeads) {
    if (lastRunId == null || l.scan_run_id !== lastRunId) continue;
    const seen = new Set<number>();
    for (const url of (l.source_urls ?? "").split(/[\s,]+/)) {
      const hit = sourceByUrl.get(url);
      if (hit && !seen.has(hit.id)) {
        seen.add(hit.id);
        citedCount.set(hit.id, (citedCount.get(hit.id) ?? 0) + 1);
      }
    }
  }
  const lastStartedAt = last?.started_at ? new Date(last.started_at).getTime() : 0;
  const wireRows = accepted
    .map((s) => {
      const failure = failReasonFor(s);
      if (failure) {
        return { s, tone: "fail", label: "Could not check", note: failure, rank: 0 };
      }
      if (citedCount.has(s.id)) {
        const n = citedCount.get(s.id) ?? 0;
        return {
          s,
          tone: "changed",
          label: "Changed",
          note: n > 0 ? `${n} new item${n === 1 ? "" : "s"} filed` : "New items filed",
          rank: 1,
        };
      }
      const fetched = s.last_fetched_at ? new Date(s.last_fetched_at).getTime() : 0;
      if (fetched && fetched >= lastStartedAt) {
        return {
          s,
          tone: "same",
          label: "✓ Checked · no change",
          note: `Checked ${formatDateTime(s.last_fetched_at)}`,
          rank: 2,
        };
      }
      return {
        s,
        tone: "quiet",
        label: "Not checked yet",
        note: s.last_fetched_at
          ? `Last checked ${formatShortDate(s.last_fetched_at)}; the last scan did not reach it.`
          : "No scan has reached this source yet.",
        rank: 3,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.s.title.localeCompare(b.s.title))
    .slice(0, 6);

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
  /*
    Running now, off the phase 3 desk-jobs query: one poll for the whole
    screen, so three cards cost one request per tick rather than three. Open
    jobs only -- a job that has stopped is not running, and the drafts grid
    below is where a stopped job's story is looked at.
  */
  const deskJobs = useDeskJobs();
  const liveJobs = (deskJobs.data ?? [])
    .filter((row) => row.status === "queued" || row.status === "running")
    .slice(0, 3);
  const today = formatDate(new Date(nowMs));
  const newToday = allLeads.filter((l) => formatDate(l.created_at) === today).length;
  const heldCount = allLeads.filter((l) => l.status === "held").length;
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
    {
      n: 1,
      name: "Pick leads",
      count: newToday,
      unit: "new today",
      act: "Review leads",
      to: "/desk/queue",
    },
    {
      n: 2,
      name: "Draft",
      count: writingNow,
      unit: "writing now",
      act: "Watch drafts",
      to: "/desk/drafts",
    },
    {
      n: 3,
      name: "Check",
      count: readyToCheck,
      unit: "ready to check",
      act: "Check draft",
      to: "/desk/drafts",
    },
    {
      n: 4,
      name: "Publish",
      count: readyToPrint,
      unit: "ready to print",
      act: "Review edition",
      to: "/desk",
      hash: "tonight",
    },
  ];

  /*
    The checklist chips, one per gate the desk actually stores. A gate that was
    never run says so ("not run") instead of borrowing the look of a pass, and
    the section chip names the section the draft is filed under rather than
    asking the editor to confirm something the desk already knows.

    Unit U9 moved the two check chips' words into `lib/news/check-gates.ts` and
    the workbench now reads the same rule, so the desk and the story page
    cannot drift into telling an editor two different things about one draft.
    That rule is the desk home's own reading of a gate -- a pass only from the
    record -- but it is NOT this chip's old output reproduced line for line:
    U9b found two recorded rows it reads differently, and more honestly (see
    `deskRowChecks`). The section chip is this row's own -- the workbench has no
    equivalent -- so it stays here.
  */
  const tonightChips = (row: DraftRow) => {
    /*
      U9b: the facts come from `deskRowChecks`, and its comment names the two
      recorded rows where these chips deliberately print something different
      from the inline chip that used to be written here (`required` alone).
    */
    const facts = deskRowChecks(row);
    const tone = { ok: "d-ok", warn: "d-warn", quiet: "d-quiet" } as const;
    const evidence = evidenceChip(facts);
    const names = namesChip(facts);
    return {
      evidence: { text: evidence.text, tone: tone[evidence.tone] },
      names: { text: names.text, tone: tone[names.tone] },
      section: row.topic
        ? { text: `✓ Section: ${sectionName(row.topic)}`, tone: "d-ok" }
        : { text: "○ No section yet", tone: "d-quiet" },
    };
  };

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
  /*
    WHICH LEADS THE LIST IS SHOWING (defect 6): the drawn header's segmented
    control. "Open" is every lead the desk is still working, "Held" the ones an
    editor set aside. Both are slices of the same `queue`, so the keyboard's
    index, the cursor and the row actions all keep meaning the same thing.
  */
  const [leadSeg, setLeadSeg] = useState<"open" | "held">("open");
  const newLeads = (
    leadSeg === "held"
      ? queue.filter((l) => l.status === "held")
      : queue.filter((l) => l.status !== "held")
  ).slice(0, 8);

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
          // The drawn dialog, not the bare write: H and the row's Hold H are
          // the same press, and it asks for the reason the desk learns from.
          if (lead) setHoldLead({ id: lead.id, headline: lead.headline });
          break;
        case "x":
          // Unit BW, item 2: X and the row's Kill button are the same press, so
          // both open the drawn dialog. The reason the desk learns from is what
          // this key was missing when it wrote the status outright.
          if (lead) setKillLead({ id: lead.id, headline: lead.headline });
          break;
        case "u":
          if (lead) setStatus.mutate({ id: lead.id, status: "new" });
          break;
        case "enter":
          if (lead)
            void navigate({ to: "/desk/story/$leadId", params: { leadId: String(lead.id) } });
          break;
        case "n":
          /*
            Unit BN2, item 6: N is the same press as the header's "+ New story",
            so it opens the same dialog. It no longer writes the hash: the hash
            is the deep link to the composer, and setting it here would open
            that dialog behind this one.
          */
          closePanel();
          setNewStoryOpen(true);
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /*
    WHICH PANEL IS OPEN (defect 2).

    The composer and the paste path are dialogs now instead of panels stacked
    on the page: the drawing of Today has none of them, and each one is
    something an editor does once rather than something to read at a glance.
    "+ New story" and the N key link to /desk#story-composer, and
    #paste-one-story reaches the other the same way, so either can be
    bookmarked. The import drop zone is not a hash here -- it has its own
    screen at /desk/import, which is where the composer footer and the nav
    point.

    The router's own location is what this reads, not a `hashchange` listener:
    the header link goes from /desk to /desk#story-composer, and a same-path
    hash change is a `pushState` the router owns -- no `hashchange` fires, so a
    listener would leave the press looking like it did nothing.
  */
  const [panel, setPanel] = useState<PanelKey>(null);
  const { hash } = useLocation();
  useEffect(() => {
    setPanel(
      hash === "story-composer" || hash === "paste-one-story"
        ? hash
        : null,
    );
  }, [hash]);
  const closePanel = () => {
    /*
      Leave the address tidy: the hash is what opened this, and a stale
      #story-composer in the bar would re-open the dialog on a reload the
      editor did not ask for. Going back through the router (rather than
      `history.replaceState`) keeps the router's location in step, so opening
      the same panel again is still a change the effect above can see.
    */
    if (window.location.hash) void navigate({ to: "/desk", replace: true });
    else setPanel(null);
  };

  /*
    Unit BN2, item 6: the drawn New-story dialog (phase 4), opened by the
    header's "+ New story", by the N key, and by the left rail's own copy in the
    shell. It is mounted with no `onDone`, like the Queue's empty state mounts
    it: the closing sentence stays on the screen it was pressed from, next to
    the button, and the editor closes it when they have read it. Today owns the
    state rather than mounting `NewStoryButton` because the N key has to reach
    the same dialog, and a self-contained button cannot be pressed from the
    keyboard handler.
  */
  const [newStoryOpen, setNewStoryOpen] = useState(false);

  /*
    WHICH LEAD IS BEING HELD (Unit BN, item 2). One dialog, re-pointed by the
    row that opened it -- the same shape the Queue uses -- so a page of eight
    rows does not carry eight shut dialogs, and the two screens open the same
    component on the same lead.

    The row's hold and the H key both come here. `onDone` refreshes `["leads"]`
    for the reason the Queue's mount does: `holdLead` writes and returns, and
    nothing inside the dialog reaches the query cache, so without it the row
    would sit in the open list until the page was reloaded.
  */
  const [holdLead, setHoldLead] = useState<{ id: number; headline: string } | null>(null);

  /*
    KILL, IN ONE PLACE (Unit BW, item 2). The row's Kill X and the X key are the
    same press, so the dialog they open lives in one slot. This is where unit
    BN2 left its one `TODO(BN2)` marker -- the drawn Kill dialog was still on
    phase 2b's branch then, so Today kept writing the status outright. That
    branch is on main now (0.6.76), so the marker is spent: the press opens the
    drawn dialog, which asks for the reason and keeps it on the lead.
    `KillDialog` is the same component `/desk/story/$leadId` and the Queue
    mount, and its `onKilled` refetch is what the bare `setStatus.mutate` gave
    the row for free -- without it the killed row would sit in the open list
    until the page was reloaded.

    Undo stays on the row (the dialog's own doc puts it there): a killed lead is
    dimmed with its way back, which is what the drawing of Today asks for.
  */
  const [killLead, setKillLead] = useState<{ id: number; headline: string } | null>(null);

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
      actions={
        /*
          CY item 1. The drawing's header is a
          `display:flex;flex-wrap:wrap;justify-content:space-between` row: the
          date and headline, then the three create buttons -- and the drawing
          renders the buttons on a SECOND line, starting at the left, because
          the row wraps ("Desk Command.dc.html" lines 17-28). The shell's
          `.ov-head` is that same row, so the wrap is not the problem; sitting
          at the right end until it wraps is. `width:100%` puts the row on its
          own line at every width, so the drawn left start holds however long
          the headline runs, and `.today-create` starts it at the left.
        */
        <div className="today-create">
          {/*
            Unit BN, item 2: the drawn Add-a-lead dialog (phase 4), in the
            drawn secondary style -- `tone="ghost"` is the mapping's plain
            `.btn`, which is what this control was before. It files a lead
            without leaving Today, which is the point of the drawing.

            It replaced a `<Link to="/desk/queue" hash="file-lead">`, i.e. the
            legacy `#file-lead` form on the Queue. That door still exists and
            still opens that form -- ten CI fixtures build their whole setup
            through the exact hash -- so nothing here is the only way in any
            more, and the hash is no longer where this button points. The
            reason is written out on `desk.queue.tsx` and in `questions/BN.md`.
          */}
          <AddLeadButton label="+ Add a lead" />
          {/*
            Unit BN2, item 6: "+ New story" opens the drawn New-story dialog
            (phase 4's three tabs) instead of jumping to `#story-composer`, and
            the N key below opens the same dialog.

            The old composer is still mounted for the hash: `/desk#story-composer`
            is a door the walks and the palette use (`scripts/custom-api-ui-
            acceptance.mjs` reads its "Writing model" field), and tab (a) of this
            dialog IS that intake -- the dialog is the intake with the drop zone
            in front of it -- so the hash is not superseded, it is a deep link to
            the same work. The press closes the hash panel first, so pressing this
            while #story-composer is in the address bar cannot leave two dialogs
            open over each other.
          */}
          <InkButton
            onClick={() => {
              closePanel();
              setNewStoryOpen(true);
            }}
          >
            + New story <kbd>N</kbd>
          </InkButton>
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
        RUNNING NOW, as drawn: a three-up of compact job cards, and no section
        at all when nothing is running. Each card comes from the phase 3
        `useDeskJobs()` query (one poll for the screen) and carries its own
        clock, its own stage line and its own press -- `onNavigate` is the
        "Open your story" the old stand-in slot offered, so replacing the slot
        with the real card takes nothing away.
      */}
      {liveJobs.length > 0 ? (
        <section aria-label="Running now">
          <SecHead
            title="Running now"
            sub="Live. Each shows what it is doing and when it last did something."
            aside={
              <Link to="/desk/drafts" className="np-link">
                All drafts
              </Link>
            }
          />
          <div className="today-running">
            {liveJobs.map((job) => (
              <DeskJobCard
                key={job.id}
                job={job}
                compact
                viewLabel="Open your story"
                onNavigate={(row) =>
                  void navigate({
                    to: "/desk/story/$leadId",
                    params: { leadId: String(row.leadId) },
                  })
                }
              />
            ))}
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
      {/*
        TONIGHT'S EDITION, as drawn: the heading is INSIDE the panel with the
        2px yellow rule (the panel is the edition, not a section that happens
        to hold a list), the sub-line sits on the heading's own line, and each
        story is one row of `1.1fr | 1.5fr | auto` -- section and headline,
        then the checks, then the single press.
      */}
      <section id="tonight" className="today-edition" aria-label="Tonight’s edition">
        <div className="today-edition-head">
          <div className="today-edition-headline">
            <h2 className="today-edition-title">Tonight’s edition</h2>
            <span className="sec-count">{readyToPrint + readyToCheck}</span>
          </div>
          {/*
            Unit U9: this line used to read "Each story needs every check before
            it can print." A story is allowed to print with no check run -- a
            lead filed and written by hand is one the desk does not require a
            model pass over -- so the sentence described a rule the desk does
            not have, on the same panel whose chips now say which checks ran.
          */}
          <p className="today-edition-sub">
            A story prints when nothing blocks it; the chips show which checks ran.
          </p>
          <Link to="/desk/drafts" className="np-link">
            All drafts
          </Link>
        </div>
        {tonightRows.length === 0 ? (
          <p className="wire-sum">
            No story is through its checks yet. A draft arrives here once it is written; its chips
            say which checks have run on it.
          </p>
        ) : (
          <div className="today-edition-rows">
            {tonightRows.map(({ row, state }) => {
              const chips = tonightChips(row);
              return (
                <div className="today-edition-row" key={row.id}>
                  <div className="today-edition-what">
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
                  </div>
                  {/*
                    The checks are their own column, not a tail on the
                    headline: the drawing lines them up down the middle of the
                    panel so two drafts' chips can be compared at a glance.
                  */}
                  <span className="today-edition-chips">
                    <span className={"chip " + chips.evidence.tone}>{chips.evidence.text}</span>
                    <span className={"chip " + chips.names.tone}>{chips.names.text}</span>
                    <span className={"chip " + chips.section.tone}>{chips.section.text}</span>
                  </span>
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
        <div className="desk-work">
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
                  is a color and the desk never says a state in color only.
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

          {/*
          THE COMPOSER, IN A DIALOG (defect 2).

          The drawing of Today has no composer on it, and the brief moves this
          one off the page: "+ New story" and the N key reach it at
          /desk#story-composer. Same fields, same model picker, same disabled
          rule, same mutation as the panel it replaces -- only its home and its
          h2 (now the dialog's own title) changed.
        */}
          <Dialog
            open={panel === "story-composer"}
            onClose={closePanel}
            title="Write a story"
            subtitle="Bring your sources. Tell us the angle. You review the draft before anything is published."
            primaryLabel={writeStory.isPending ? "Starting draft…" : "Write draft"}
            onPrimary={() => writeStory.mutate()}
            primaryDisabled={
              writeStory.isPending ||
              uploadingDocuments ||
              (storyInput.length < 8 && !storyDocuments.length)
            }
            cancelLabel="Close"
            closeLabel="Close the composer"
            footNote={
              uploadingDocuments
                ? "Waiting for your documents to finish uploading."
                : "Creates a draft for your review."
            }
          >
            {/* `composer-fields` is the class the composer's field styling hangs
              off now that the panel that carried `.story-composer` is gone
              (styles.css, the textarea rule). */}
            <div className="composer-fields">
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
                    Original documents are saved in full. Scanned pages and images are read with
                    OCR.
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
                    {storyScope === "public" ? "Public research enabled" : "Supplied material only"}{" "}
                    · {storySection || "Section suggested automatically"}
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
                      {storySection &&
                      !sectionQuery.sections.some((s) => s.key === storySection) ? (
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
                {/*
              The composer's own submit button is the dialog's primary press
              now, so nothing here duplicates it -- one control named "Write
              draft" on the screen, not two. What is left in the footer is the
              other ways in, which used to be the panels below this one: the
              handoff's New story dialog has three tabs -- (a) *AI drafts from
              material*, which is the /desk/import intake, (b) *Write it
              myself*, which is this dialog, and (c) *Paste a finished story*
              (docs/design/handoff-2026-09-26/README.md, the dialog table).
              Both of the other two are offered here, so the one-story paste is
              reachable from the desk and not only by its own hash.
            */}
                <div className="composer-submit">
                  <div className="composer-other-ways">
                    <Link to="/desk/import" className="inline-link">
                      Already written somewhere else? Import finished stories
                    </Link>
                    <Link to="/desk" hash="paste-one-story" className="inline-link">
                      Paste a story I already have
                    </Link>
                  </div>
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
            </div>
          </Dialog>

          {/*
          The third choice: one story, already written, straight to the Queue.

          The owner asked for the Opinion desk's "Paste a piece I wrote" on the
          news side (2026-09-24): "just one, to dump in the queue, as a regular
          non-opinion story for massaging later via the queue." No review
          screen, no model, no second save path -- it files the same card the
          import screen files, through the same server function.
        */}
          <Dialog
            open={panel === "paste-one-story"}
            onClose={closePanel}
            title="Paste a story I already have"
            subtitle="One finished story. It goes to the Queue as a draft for you to work on there."
            primaryLabel={pasteStory.isPending ? "Adding…" : "Add to Queue"}
            onPrimary={() => void pasteStory.mutate()}
            primaryDisabled={pasteText.trim().length < 40 || pasteStory.isPending}
            cancelLabel="Close"
            footNote="No screen to check first. One story in, one draft in the Queue."
          >
            <div className="composer-fields">
              <div className="composer-sources">
                <div className="composer-pasted">
                  <label htmlFor="paste-one-text">The story</label>
                  <p>
                    Paste it as it is. Nothing is rewritten and no AI reads it — the paste becomes
                    the draft, with its first line as the headline if you leave that empty. Its
                    links come across as the story&rsquo;s sources.
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
                    Nothing is published. The story lands in the Queue as a news draft, editable
                    like any other — you can publish it whenever it is ready.
                  </span>
                </div>
              </div>
              {pasteNotice ? (
                <p className="composer-source-note" role="status">
                  {pasteNotice}
                </p>
              ) : null}
              {pasted ? (
                /*
                  Unit CA, note 6. This panel is reached by its own hash
                  (`/desk#paste-one-story`, still mounted and still a live deep
                  link to the same work) and it warns the same way the drawn New
                  story dialog's paste tab does -- after the add, over a story
                  that is already filed. So it says it the same way:
                  `duplicateNoteAfterSave` names the story it matched instead of
                  offering "Import it anyway if it is different — you decide",
                  which was the review screen's sentence and, read here,
                  described a step the editor had already taken.
                */
                <p className="composer-source-note" role="status">
                  Added to the Queue as a draft. Nothing is published.{" "}
                  <Link
                    to="/desk/story/$leadId"
                    params={{ leadId: String(pasted.leadId) }}
                    className="inline-link"
                  >
                    Open it
                  </Link>
                  .
                  {pasted.duplicate ? (
                    <>
                      {" "}
                      {duplicateNoteAfterSave(pasted.duplicate)}{" "}
                      {pasted.duplicate.slug ? (
                        <Link
                          to="/articles/$slug"
                          params={{ slug: pasted.duplicate.slug }}
                          className="inline-link"
                        >
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
            </div>
          </Dialog>

          {/*
            CY item 2: the "Needs you" panel is not in the drawing, so Today no
            longer draws it. Where each item it linked is reachable from:

              drafts on the desk        → Drafts (/desk/drafts)
              Dark Desk file stopped    → Dark Desk, the Open files pile and the
                                          file's own Decide row (/desk/dark)
              suggested sources         → Sources & scan, the suggested block
                                          (/desk/sources) -- and still on Today,
                                          in the wire panel's own disclosure
              failing sources           → Sources & scan, and still on Today in
                                          the same disclosure
              scan stale / failed       → the wire panel's own scan line

            Two of the five therefore never left Today at all. The rest are
            recorded in design/SPEC-GAPS-0681.md, and the panel's CSS
            (`.needs` in styles.css) is left alone because no other screen
            draws it either -- it is now unreferenced markup that a later unit
            can sweep.
          */}
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
                {/*
                The drawn head: a 3px rule under the title, and the two counts
                as a segmented control an editor can press -- not two labels.
              */}
                <div className="today-leads-head">
                  <div className="today-leads-title">
                    <h2>New leads</h2>
                    <span>
                      {last ? `${formatDateTime(last.started_at)} scan · best first` : "Best first"}
                    </span>
                  </div>
                  <div className="today-segs" role="group" aria-label="Which leads to show">
                    <button
                      type="button"
                      className={"today-seg" + (leadSeg === "open" ? " on" : "")}
                      aria-pressed={leadSeg === "open"}
                      onClick={() => {
                        setLeadSeg("open");
                        setCursor(0);
                      }}
                    >
                      Open · {queue.length - heldCount}
                    </button>
                    <button
                      type="button"
                      className={"today-seg" + (leadSeg === "held" ? " on" : "")}
                      aria-pressed={leadSeg === "held"}
                      onClick={() => {
                        setLeadSeg("held");
                        setCursor(0);
                      }}
                    >
                      Held · {heldCount}
                    </button>
                  </div>
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
                      <span className="today-legend-label">Keyboard</span>
                      {TRIAGE_KEYS.map(([key, what]) => (
                        <span key={key}>
                          <kbd>{key}</kbd> {what}
                        </span>
                      ))}
                    </p>
                    {newLeads.length === 0 ? (
                      <p className="wire-sum">
                        Nothing held right now.{" "}
                        <button
                          type="button"
                          className="inline-link"
                          onClick={() => setLeadSeg("open")}
                        >
                          Back to the open leads
                        </button>
                        .
                      </p>
                    ) : null}
                    {newLeads.map((l, index) => {
                      const dup = nearDuplicate(l, printed, paperPlace);
                      const held = l.status === "held";
                      const done = held || l.status === "killed";
                      /*
                        CY item 4. The drawn evidence cell: the squares and the
                        count, at the head of the meta line (Desk
                        Command.dc.html:118-121). `source_urls` is the desk's own
                        record of what the lead was read out of -- the same
                        field, counted the same way, that the Queue's row prints
                        (desk-leads.tsx:155). The drawing's cell adds "· 1 could
                        not open"; the desk has no per-lead failure figure
                        anywhere (desk-leads.tsx:147-155), so that half is
                        dropped rather than invented, exactly as on the Queue.
                      */
                      const sources = parseUrlList(l.source_urls).length;
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
                            "today-lead" + (index === cursor ? " sel" : "") + (done ? " acted" : "")
                          }
                          key={l.id}
                        >
                          <Score v={l.newsworthiness ?? 0} />
                          <div className="today-lead-main">
                            {/*
                              CY item 4. The drawn row opens with its chip line
                              -- NEW / HELD / ≈ PRINTED, then the warnings -- and
                              the headline sits under it (Desk
                              Command.dc.html:112-116). It was last on the row,
                              below the meta line, which is the opposite end.
                            */}
                            <div className="today-lead-chips">
                              {/*
                                The status chip and the possible-duplicate chip
                                used to be drawn here as well, and `LeadFlags`
                                draws both of them from the same fields -- so the
                                row printed NEW twice, stacked, which is what the
                                BF3 side-by-side caught against the drawing's one
                                chip line. One row, one chip, and it is the
                                component both screens render, so the two screens
                                cannot drift on what the desk has found.
                              */}
                              <LeadFlags lead={l} dup={dup} />
                            </div>
                            <Link
                              to="/desk/story/$leadId"
                              params={{ leadId: String(l.id) }}
                              className={
                                "today-lead-hl hl-link" +
                                (l.status === "killed" ? " today-lead-struck" : "")
                              }
                            >
                              {l.headline}
                            </Link>
                            <p className="today-lead-why">{l.why}</p>
                            <div className="today-lead-row2">
                              {/*
                                CY item 4, the drawn evidence cell. It is the
                                Queue's own `.ev-squares`, so the two screens
                                cannot draw the same count two ways.
                              */}
                              <span className="today-lead-evidence">
                                <span className="ev-squares" aria-hidden="true">
                                  {Array.from({ length: Math.min(sources, 10) }, (_, i) => (
                                    <i key={i} />
                                  ))}
                                </span>
                                <b>{sources} opened</b>
                              </span>
                              <span className="meta">
                                {l.topic} · {formatAge(l.created_at)} · {leadOrigin(l)}
                              </span>
                            </div>
                          </div>
                          <span className="today-lead-side">
                            {done ? (
                              /*
                              A lead already acted on dims to 60% and offers
                              only the way back -- the drawing's doneLabel plus
                              Undo, in place of the three presses.
                            */
                              <>
                                <span className="today-lead-done">
                                  {l.status === "held" ? "Held" : "Killed"}
                                </span>
                                <InkButton
                                  tone="quiet"
                                  onClick={() => setStatus.mutate({ id: l.id, status: "new" })}
                                >
                                  Undo <kbd>U</kbd>
                                </InkButton>
                              </>
                            ) : (
                              <>
                                <InkButton onClick={() => startDraft.mutate(l.id)}>
                                  Start story <kbd>S</kbd>
                                </InkButton>
                                <InkButton
                                  tone="quiet"
                                  onClick={() => setHoldLead({ id: l.id, headline: l.headline })}
                                >
                                  Hold <kbd>H</kbd>
                                </InkButton>
                                <InkButton
                                  tone="quiet-danger"
                                  onClick={() => setKillLead({ id: l.id, headline: l.headline })}
                                >
                                  Kill <kbd>X</kbd>
                                </InkButton>
                              </>
                            )}
                            {/*
                              BF3, Today (b): no "More ▾" here. The drawing
                              (cmp-today.png) gives each New leads row one
                              horizontal group -- Start story S · Hold H ·
                              Kill X -- and nothing else; the menu's two items
                              are both already on the row (the headline opens
                              the lead, the ≈ PRINTED chip opens the piece),
                              so nothing left with it is unreachable.
                            */}
                          </span>
                        </div>
                      );
                    })}
                    <Link to="/desk/queue" className="today-leads-all">
                      All leads in the Queue →
                    </Link>
                  </>
                )}
              </section>
            </div>
          )}
        </div>

        {/*
          THE RAIL (README "1. Today", Desk Command.dc.html): the three panels
          the drawing puts beside the work -- Follow-ups, Dark Desk, The wire.
          They are outside the boot gate on purpose: each one carries its own
          error and empty state, and a rail that disappears while the queue
          loads reads as a broken page rather than a loading one.
        */}
        <aside className="desk-rail">
          <section id="desk-followups" className="gc-followups">
            <SecHead
              title="AI follow-ups"
              count={
                followUps.isError || liveFollowUps === 0 ? undefined : `${liveFollowUps} active`
              }
              aside={
                <Link to="/desk/follow-ups" className="np-link">
                  All follow-ups
                </Link>
              }
            />
            {/*
                The query's failure sentence, and only on failure: a panel that
                shows "no findings" because its list could not be fetched reads
                as a quiet desk rather than a broken one. `followUpsRailCopy`
                carries the line.
              */}
            {followUpsRailCopy(followUps.isError) ? (
              <p className="rail-note">{followUpsRailCopy(followUps.isError)}</p>
            ) : null}
            {/*
              Unit BN, item 2: the drawn panel's own content -- README "1.
              Today", rail: "the latest AI follow-up results".

              Each row is the drawn four: the question the agent is watching
              (`what`), what it found (the phase 6 card's own result sentence,
              from the same `cardResultLine` + `parseFinding` the card uses, so
              the two cannot describe one finding differently), the story it
              belongs to, and the link to the screen where it can be read in
              full and acted on.

              Three rows, like the desk's other rail lists, and the empty case
              is a sentence rather than nothing: a panel that renders only its
              heading over nothing reads as a broken page (UX-002, the same
              reason the memory widget below states its own).
            */}
            {findings.isError ? (
              <p className="rail-note">
                The follow-up findings could not be loaded. The list is at{" "}
                <Link to="/desk/follow-ups" className="inline-link">
                  Follow-ups
                </Link>
                .
              </p>
            ) : (findings.data ?? []).length === 0 ? (
              <p className="rail-note">
                No findings yet. When an AI follow-up finds something, its result is listed here.
              </p>
            ) : (
              (findings.data ?? []).slice(0, 3).map((f) => {
                const finding = parseFinding(f.finding_json);
                const storyTo = f.lead_id
                  ? {
                      to: "/desk/story/$leadId" as const,
                      params: { leadId: String(f.lead_id) },
                    }
                  : f.article_slug
                    ? { to: "/articles/$slug" as const, params: { slug: f.article_slug } }
                    : null;
                const storyTitle = f.lead_headline ?? f.article_headline;
                return (
                  <div className="followup-item" key={f.id}>
                    <p className="followup-who">{f.what}</p>
                    <p className="followup-what">
                      {cardResultLine("found", finding, { nextRunAt: f.next_run_at })}
                    </p>
                    <p className="meta">
                      {storyTo ? (
                        <Link {...storyTo} className="inline-link">
                          {storyTitle ?? "the story"}
                        </Link>
                      ) : (
                        "No story linked"
                      )}
                      {" · "}
                      <Link to="/desk/follow-ups" className="inline-link">
                        Review finding
                      </Link>
                    </p>
                  </div>
                );
              })
            )}
            {/*
              Unit CU (0.6.81): the manual asks were drawn under the findings,
              each one a `FollowUpItem` with Record reply, Nudge and Drop. They
              are gone; DECISIONS.md:38/:44 retire the whole human
              "seek a response" step, and `listFollowUps` no longer returns a
              row without an `agent_kind`, so there was nothing left to draw.
              The rows themselves are kept by
              migrations/0106_retire_manual_follow_ups.sql.
            */}
          </section>

          <section className="nightpanel gc-darkdesk">
            <SecHead title="Dark Desk" sub="Never prints on its own" />
            {darkErr ? <p className="note err">{darkErr}</p> : null}
            {/*
                CY item 3. The piles by their drawn names, each a label, the
                sentence that says what is in it, and the count:
                Open files / Signals to review / Waiting on an AI follow-up.

                The rows are NOT links any more. The drawing gives the panel one
                way in -- a full-width "Open Dark Desk →" under the piles -- and
                three more links to the same screen beside it made four doors
                where the design draws one. `Open Dark Desk →` moved down out of
                the section head for the same reason.

                What the panel used to count as "Set aside" is not gone: that is
                Dark Desk's own third pile on its own screen (/desk/dark), which
                owns the list. The items themselves (start digging, open a file)
                sit behind the disclosure below -- nothing the panel could do is
                gone, it is just not three cards deep in a rail panel.
              */}
            <div className="dd-piles">
              <div className="dd-pile">
                <span className="dd-pile-text">
                  <span className="dd-pile-label">Open files</span>
                  <span className="dd-pile-note">Reading records</span>
                </span>
                <span className="dd-pile-count">{onDesk.length}</span>
              </div>
              <div className="dd-pile">
                <span className="dd-pile-text">
                  <span className="dd-pile-label">Signals to review</span>
                  <span className="dd-pile-note">From the wire and watched pages</span>
                </span>
                <span className="dd-pile-count">{inbox.length}</span>
              </div>
              <div className="dd-pile">
                <span className="dd-pile-text">
                  <span className="dd-pile-label">Waiting on an AI follow-up</span>
                  <span className="dd-pile-note">AI watching for a statement or record</span>
                </span>
                <span className="dd-pile-count">{waitingOnFollowUp}</span>
              </div>
            </div>
            <Link to="/desk/dark" className="dd-open">
              Open Dark Desk →
            </Link>
            {inbox.length === 0 && onDesk.length === 0 ? (
              <p className="wire-sum">
                Nothing new tonight.{" "}
                <Link to="/desk/dark" className="inline-link">
                  Start from a tip
                </Link>
                .
              </p>
            ) : (
              <details className="dd-more">
                <summary>What is in the piles</summary>
                {inbox.length ? <p className="np-pile">To look at · {inbox.length}</p> : null}
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
                {onDesk.length ? <p className="np-pile">On the desk · {onDesk.length}</p> : null}
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
              </details>
            )}
          </section>

          <section className="wirecol gc-wire">
            <SecHead
              title="The wire"
              sub={last ? `Scan ${formatDateTime(last.started_at)}` : "No scans yet"}
            />
            {scanning ? <Busy label="Fetching the watch list, then one pass for leads." /> : null}
            {/*
                THE WIRE, as drawn: one line per watched source with the state
                the last run left it in and the reason why, then the writing
                model, then the two presses. The longer material the rail used
                to carry (the scan note, source health, suggested sources, the
                paper, beat memory) is below behind one disclosure -- the
                drawn panel is a status board, and none of it is lost.
              */}
            {wireRows.length === 0 ? (
              <p className="wire-sum">
                No source is on watch yet —{" "}
                <Link to="/desk/sources" className="inline-link">
                  add one
                </Link>
                .
              </p>
            ) : (
              <div className="wire-sources">
                {wireRows.map(({ s, tone, label, note }) => (
                  <div className="wire-source" key={s.id}>
                    <span className="wire-source-name" title={s.title}>
                      {s.title}
                    </span>
                    <span className={"wire-chip " + tone}>{label}</span>
                    <p className="wire-source-note">{note}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="wire-model">
              <b>Writing model</b> · {modelChoiceLabel(storyModel)} ·{" "}
              {writeStory.isPending ? "writing now" : "ready"}
            </p>
            <div className="wire-acts">
              <InkButton onClick={() => scan.mutate()} disabled={scanning}>
                {scanning ? "Scanning…" : "Run scan now"}
              </InkButton>
              <Link to="/desk/sources" className="btn quiet">
                All sources
              </Link>
            </div>
            <details className="wire-more">
              <summary>More from the wire</summary>
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
            </details>
          </section>
        </aside>
      </div>

      {/* Unit BN2, item 6: the drawn New-story dialog this page's "+ New story"
          and the N key open. Mounted once, like the Hold dialog below. */}
      <NewStoryDialog open={newStoryOpen} onClose={() => setNewStoryOpen(false)} />

      {/*
        Unit BN, item 2: the drawn Hold dialog, mounted once for the list and
        re-pointed by `holdLead`. The composer and the paste path above are
        hash-driven because the drawing reaches them from elsewhere too; this
        one is only ever opened from a row on this page or from H, so it needs
        no address of its own.
      */}
      {holdLead ? (
        <HoldLeadDialog
          leadId={holdLead.id}
          headline={holdLead.headline}
          open
          onClose={() => setHoldLead(null)}
          onDone={() => void qc.invalidateQueries({ queryKey: ["leads"] })}
        />
      ) : null}

      {/*
        Unit BW, item 2: the drawn Kill dialog, mounted once for the list and
        re-pointed by `killLead` -- the same shape as the Hold dialog above, so
        a page of eight rows does not carry eight shut dialogs. `onKilled`
        refreshes `["leads"]` for the reason the Hold mount does: the write
        lands inside the dialog and nothing in it reaches the query cache.
      */}
      {killLead ? (
        <KillDialog
          leadId={killLead.id}
          open
          onOpenChange={(open) => {
            if (!open) setKillLead(null);
          }}
          onKilled={() => void qc.invalidateQueries({ queryKey: ["leads"] })}
        />
      ) : null}
    </DeskShell>
  );
}
