import { ensureSchemaOnce, getSql, withTransaction } from "../db.ts";
import { claudeCodeChat } from "./ai-claude-code.server.ts";
import { grokChat, probeProvider, type LocalModelOverride } from "./ai.ts";
import { runPinnedCallWithFailover } from "./desk-model-run.ts";
import {
  orchestrateEditorial,
  type EffectiveOpinionModelChoice,
  type FiledEditorialResult,
  type WriteEditorialInput,
  type WriteEditorialResult,
} from "./editorial-orchestration.ts";
import { findVoiceFile, readVoiceTextForLocalModel } from "./voice.server.ts";
import { sanitizeJsonLeaves, storableText } from "./storable-text.ts";
import { getPaperConfig } from "./paper-settings.ts";
import {
  modelChoiceLabel,
  opinionModelChoice,
  OPINION_AUTOMATIC_LADDER,
  type OpinionModelChoice,
} from "./model-choice.ts";
import {
  progressReporterFor,
  setJobFailoverNote,
  setJobModelRuntime,
  setJobStage,
  throwIfJobCancelled,
  waitForModel,
} from "./jobs.ts";
import {
  runDeskResearch,
  type DeskResearchDeps,
  type DeskResearchOutcome,
} from "./editorial-research.server.ts";
import {
  persistEditorialCompletion,
  persistEditorialSuccess,
} from "./editorial-result-persistence.ts";
import {
  EDITORIAL_TOOLS,
  RESEARCH_INSTRUCTIONS,
  buildWritingPack,
  opinionHeadline,
  editorialSourcesError,
  suppliedMaterialForPrompt,
  type Editorial,
  type EditorialPointer,
} from "./editorial.ts";
import { suppliedMaterialCutRecord } from "./supplied-material-cap.ts";
import { modelEffort, plannerModelFor, providerEntry, providerModel } from "./provider-registry.ts";
import { failoverNoteSentence, failoverReasonPhrase } from "./automatic-failover.ts";
import { nameCheckText, type NameCheck } from "./name-check.ts";
import { officialDomains } from "./absence-gate.ts";
import { officialSiteHost } from "./research-scope.ts";
import { opinionFallbackRuntimeReceipt } from "./opinion-runtime-receipt.ts";
import { firstReadyOpinionRung } from "./opinion-readiness.ts";
import { pinnedLocalModelForJob } from "./job-local-model.ts";

export type { WriteEditorialInput, WriteEditorialResult } from "./editorial-orchestration.ts";

/** Research supplies leads; the writer independently opens sources and files an
 * editorial with claims and sources. Both subscription writers retain web
 * research during writing — the voice file CONTAINS the research protocol
 * (Stage L local record, packet/PDF/tape/parcel/CORA rules, triangulation, the
 * surprise hunt, the local source ledger), so a writer given the voice and
 * denied the tools cannot run the protocol it was told to run. Both CLIs load
 * the complete voice by file path, never as prompt text in argv or application
 * logs.
 *
 * UNIT U31 RESTORED THAT, and recorded what it costs. Units U12/U12b/c split
 * the pair — a gathering pass with the tools and no voice, a writing pass with
 * the voice and no tools — to close a real exfiltration path (a prompt-injected
 * page inducing a fetch that carries style-guide text out of the machine).
 * The owner weighed that against an editorial writer that cannot follow its own
 * research protocol and chose the writer: SEC-3 is now an owner-accepted risk,
 * stated in SECURITY.md, not a guard the tests hold. See `runClaudePair` and
 * `runCodexPair` for the restored shapes, and `git show 992fef1c^:` for the
 * exact code they were restored from.
 *
 * There is also a ONE-PASS-WRITING pair, for the writers with no tool loop at
 * all: the "Local model" pick, Automatic's DeepSeek v4.1 Flash rung, and the
 * newsroom's saved connections, which speak the OpenAI-compatible protocol over
 * HTTP. It makes a single WRITING call — the voice as the system message, never
 * an argument — but it is not unresearched (units U30 + U31): the desk runs a
 * research pass of its own first, holding the same voice file so the protocol
 * governs the planning and the selection too, and the model reads the desk's
 * captures back as findings. The writing pack says what research ran, with each
 * capture's URL and capture id. Which pair a candidate takes is read from the
 * registry entry's `kind` (via `providerRunsToolPass`), not from its id; see
 * `orchestrateEditorial`'s `runPair`. */

/**
 * Editorials take tens of minutes, not seconds. The voice researches first.
 *
 * Three measured runs, not a guess:
 *
 *   9m53s   32 turns   $2.66    one document pointer
 *   24m06s             $23.76   one pointer, and it dispatched its own agents
 *   >30m                        the same subject again, killed at the cap
 *
 * Fifteen minutes killed the first real request on the desk with the work
 * already paid for; thirty killed the second. The spread is wide because the
 * voice decides for itself how much to go and read, so the cap has to sit well
 * above the slowest run seen rather than just above the fastest.
 *
 * This is a ceiling, not a target. Nothing waits on it: the desk enqueues a job
 * and returns at once, and the page counts up while it works.
 *
 * ENG-107 split research and writing into two calls (see `writeEditorial`),
 * so this ceiling now applies PER PASS, not once. The gathering pass is the
 * one these measurements describe; the writing pass verifies sources too
 * and reuses the same generous ceiling rather than a
 * separately tuned one — one knob for the operator, and the two runs above
 * were the whole spread this ceiling was set from in the first place. Worst
 * case, a piece now takes up to roughly double the wall-clock time this
 * comment's numbers describe; the operator accepted that as proportionate to
 * an editorial's existing ~$23 / ~24-minute cost.
 */
const EDITORIAL_TIMEOUT_DEFAULT_MS = 2_700_000;

/**
 * Overridable, because the manual told operators they could.
 *
 * docs/editor.md said "the operator can raise EDITORIAL_TIMEOUT_MS" and no
 * such variable existed — I invented it while writing the troubleshooting
 * table, and an audit caught it (TW-003). Implementing it is the better fix
 * than deleting the sentence: the spread between measured runs was 9m53s to
 * over 30 minutes, so a slower box genuinely may need more.
 *
 * Floored at a minute so a typo cannot make every editorial fail instantly.
 */
function editorialTimeoutMs(): number {
  const raw = process.env.EDITORIAL_TIMEOUT_MS?.trim();
  const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : EDITORIAL_TIMEOUT_DEFAULT_MS;
}

export async function ensureEditorialSchema() {
  const sql = await getSql();
  /*
    The reader-facing parts live on the draft: the appendix is appended to the
    body because the operator asked for receipts at the end of the piece, where
    a reader who dislikes it can check them.

    The desk-facing parts do not belong in the story, so they live here.
  */
  await ensureSchemaOnce(sql, "editorial-extras", [
    `
    create table if not exists editorial_extras (
      draft_id integer primary key,
      newsroom_id integer not null default 1,
      fact_sheet text not null default '',
      image_prompt text not null default '',
      source_kind text not null default '',
      source_ref text not null default '',
      generated_at timestamptz not null default now()
    )
  `,
  ]);
}

/** Test seams for the two subscription transports, in the same shape as
 * `fileEditorial`'s `deps` and `performEditorialWork`'s: production passes
 * nothing and the runtime reaches the real CLI. */
export type EditorialWriterDeps = {
  claudeCodeChat?: typeof claudeCodeChat;
  codexChat?: typeof import("./ai-codex.server.ts").codexChat;
  /**
   * Test seam for the one-pass OpenAI-compatible transport (the Local model
   * pick and Automatic's DeepSeek v4.1 Flash rung). It is the call that
   * carries the private voice as its system message, so a test can assert
   * that shape -- voice as system text, no tools, the rung's own endpoint --
   * without a socket or a spend.
   */
  grokChat?: typeof grokChat;
  /**
   * Test seam: the availability answer the Claude pair reads before it spends
   * anything. Production asks the operator's own switch through
   * `resolveClaudeCode` (./ai.ts).
   *
   * A test that replaces the transport has to replace this too. CI exports
   * TOWNREPORTER_CLAUDE_CODE=0 for several jobs, including the real-PostgreSQL
   * one (.github/workflows/ci.yml), where `resolveClaudeCode` returns null and
   * the pair answers "Claude is unavailable" without ever reaching the
   * transport a test recorded. The environment is not the test's to assume.
   */
  resolveClaudeCode?: typeof import("./ai.ts").resolveClaudeCode;
  /**
   * Test seam for the desk-run research pass (unit U30): its search, its page
   * fetch, its capture write, its two model calls, the newsroom's research
   * window, the Stop seam and the stage reporter. Production passes nothing and
   * every piece of it reaches the real thing -- `searchWithFallback`,
   * `ingestDocument`, `rememberCapture`, `grokChat`, `throwIfJobCancelled`.
   *
   * The model calls are the reason it is one object rather than six fields on
   * this type: a test that wants the desk pass to run without a socket fakes
   * the search and the fetch, and a test that wants to watch every call the
   * piece makes leaves `plan`/`read` alone so they arrive through `grokChat`
   * alongside the writing call -- which is how SEC-3 is asserted (the research
   * calls must not carry the voice, and the writing call must not carry tools).
   */
  deskResearch?: DeskResearchDeps;
};

export async function writeEditorial(
  input: WriteEditorialInput,
  deps: EditorialWriterDeps = {},
): Promise<WriteEditorialResult> {
  const cfg = await getPaperConfig(input.newsroomId);
  input = {
    ...input,
    paper: {
      name: cfg.name,
      city: cfg.city,
      state: cfg.state,
      officialDomains: officialDomains(
        cfg.city,
        input.pointers.map((pointer) => pointer.url),
      ),
    },
  };
  // One completed gathering pass is a checkpoint. If the writer has a
  // technical failure, a fallback writer receives this saved research text
  // instead of repeating the searches and source opens already completed.
  let completedResearch: string | null = null;
  /*
    The desk's own research, memoized for exactly the same reason (unit U30):
    the ladder can move a no-tool piece from DeepSeek to another no-tool rung,
    and the second rung must receive what the desk already found rather than pay
    for the same searches and page opens a second time.
  */
  let completedDeskResearch: DeskResearchOutcome | null = null;
  /*
    The city's own site, read once for the desk pass's planner and its relevance
    ranking -- the same read the dig makes for its `site:` strategies (see
    ./research-scope.ts's `officialSiteHost`). Null when the newsroom has no
    official seed source, which yields no official host rather than a
    neighbouring jurisdiction's.
  */
  const paperOfficialHost = officialSiteHost(cfg.city, cfg.seedSources, cfg.state);
  /**
   * How this piece announces a stage.
   *
   * One reporter for the whole run, so a stage sentence and the card's chip
   * row can never disagree: `input.onStage` is the job row's own
   * `progressReporterFor` when this is a queued run (see
   * `performEditorialWork`), which sets the stage INDEX as well as the
   * sentence. A direct call -- a test, a write assembled by hand -- falls back
   * to the id-only `setJobStage`, or to nothing at all when there is no job.
   */
  const reportStage = (editorialInput: WriteEditorialInput) => async (stage: string) => {
    if (editorialInput.onStage) return editorialInput.onStage(stage);
    if (editorialInput.completion) await setJobStage(editorialInput.completion.jobId, stage);
  };

  /**
   * The desk's research pass, run once per piece for a writer that has no web
   * tools of its own (units U30 + U31).
   *
   * `chat` is the same no-tool transport the writing call uses, so the model
   * that plans the searches and the model that reads the desk's records are the
   * rung the editor picked. `voice` is the operator's voice file, and since U31
   * it is the SYSTEM MESSAGE of both research calls exactly as it is of the
   * writing call: the voice contains the research protocol, so a plan made
   * without it is a plan made without the protocol. A test records all three
   * calls of a piece through one `grokChat` seam, which is how "the research
   * holds the voice" is asserted rather than assumed.
   */
  const deskResearchFor = async (
    editorialInput: WriteEditorialInput,
    researchPack: string,
    voice: string,
    chat: typeof grokChat,
    options: { choice: OpinionModelChoice; localModel?: LocalModelOverride; exactModel?: string },
  ): Promise<DeskResearchOutcome> => {
    if (completedDeskResearch) return completedDeskResearch;
    const callOptions = {
      choice: options.choice,
      newsroomId: editorialInput.newsroomId,
      timeoutMs: editorialTimeoutMs(),
      ...(options.localModel ? { localModel: options.localModel } : {}),
      reasoningEffort: modelEffort(options.choice, editorialInput.modelEffort, options.exactModel),
    };
    completedDeskResearch = await runDeskResearch(
      {
        userId: editorialInput.userId,
        newsroomId: editorialInput.newsroomId,
        subject: editorialInput.subject,
        askedFor: editorialInput.askedFor,
        voice,
        researchPack,
        paper: {
          city: editorialInput.paper?.city,
          state: editorialInput.paper?.state,
          officialDomains: editorialInput.paper?.officialDomains,
          // The city's own site, from the newsroom's settings -- the same read
          // the dig makes for its `site:` strategies. `input.paper` carries
          // only the .gov hosts derived from the editor's pointers, and an
          // editor's pointers are usually not on one, so without this the desk
          // would have no official host to rank first or to name to the planner.
          officialHosts: paperOfficialHost ? [paperOfficialHost] : [],
        },
        requestId: editorialInput.completion?.requestId ?? null,
      },
      {
        ...deps.deskResearch,
        plan: deps.deskResearch?.plan ?? ((system, user) => chat(system, user, 1_200, callOptions)),
        read: deps.deskResearch?.read ?? ((system, user) => chat(system, user, 4_000, callOptions)),
        onStage: deps.deskResearch?.onStage ?? reportStage(editorialInput),
        throwIfCancelled:
          deps.deskResearch?.throwIfCancelled ??
          (async () => {
            // The U25 Stop seam, asked between searches and between pages. It
            // throws, so a stopped run leaves the hop loop and no writing call
            // is ever made -- which is the whole point of asking.
            if (editorialInput.completion) await throwIfJobCancelled(editorialInput.completion.jobId);
          }),
      },
    );
    return completedDeskResearch;
  };

  return orchestrateEditorial(input, {
    findVoiceFile,
    runClaudePair: async ({ input: editorialInput, found, researchPack }) => {
      const resolveClaudeCode =
        deps.resolveClaudeCode ?? (await import("./ai.ts")).resolveClaudeCode;
      if (!resolveClaudeCode()) {
        return {
          ok: false,
          error: "Claude is unavailable. Open Claude Code, sign in, then try again.",
        };
      }
      const chat = deps.claudeCodeChat ?? claudeCodeChat;
      const choice = opinionModelChoice(editorialInput.modelChoice);
      const entry = providerEntry(choice);
      if (!entry || entry.kind !== "claude-code") {
        return { ok: false, error: "The selected Claude model is unavailable." };
      }
      if (completedResearch === null) {
        const research = await chat({
          system: RESEARCH_INSTRUCTIONS,
          user: researchPack,
          model: plannerModelFor(choice) || providerModel(entry),
          allowedTools: EDITORIAL_TOOLS,
          timeoutMs: editorialTimeoutMs(),
          reasoningEffort: modelEffort(choice, editorialInput.modelEffort),
        });
        if (!research.ok) return research;
        completedResearch = research.text;
      }
      await reportStage(editorialInput)("Writing the editorial");
      return chat({
        system: "",
        systemPromptFile: found.voice.path,
        /*
          UNIT U31 -- THE WRITER RESEARCHES AND WRITES IN ONE RUN.

          Restored from before U12 (`git show 992fef1c^:src/lib/news/
          editorial.server.ts`): this call holds the operator's voice file by
          path AND the web tools, exactly as it did then. The reason is in the
          file itself -- the voice contains the research protocol (Stage L
          local record, packet/PDF/tape/parcel/CORA rules, triangulation, the
          surprise hunt, the local source ledger) -- so a writer given the
          voice but denied the tools cannot run the protocol it was told to
          run, and a gathering pass denied the voice researches without it.

          SEC-3 is now an owner-accepted risk, recorded in SECURITY.md: a
          prompt-injected page could in principle induce a fetch carrying
          style-guide text. The owner accepted that for a single-person
          newsroom over a writer that cannot follow its own protocol.
          Everything else stays: the voice is never an argument and never
          logged (see `voice.server.ts`), and the path is validated before it
          is read.
        */
        allowedTools: EDITORIAL_TOOLS,
        user: buildWritingPack({
          paper: editorialInput.paper,
          subject: editorialInput.subject,
          ourStory: editorialInput.ourStory,
          askedFor: editorialInput.askedFor,
          research: completedResearch,
        }),
        model: providerModel(entry),
        timeoutMs: editorialTimeoutMs(),
        reasoningEffort: modelEffort(choice, editorialInput.modelEffort),
      });
    },
    runCodexPair: async ({ input: editorialInput, found, researchPack }) => {
      const codexChat = deps.codexChat ?? (await import("./ai-codex.server.ts")).codexChat;
      const choice = opinionModelChoice(editorialInput.modelChoice);
      const entry = providerEntry(choice);
      if (!entry || entry.kind !== "codex") {
        return { ok: false, error: "The selected Codex model is unavailable." };
      }
      if (completedResearch === null) {
        const research = await codexChat({
          system: RESEARCH_INSTRUCTIONS,
          user: researchPack,
          model: plannerModelFor(choice),
          timeoutMs: editorialTimeoutMs(),
          webSearch: true,
          reasoningEffort: modelEffort(choice, editorialInput.modelEffort),
        });
        if (!research.ok) return research;
        completedResearch = research.text;
      }
      await reportStage(editorialInput)("Writing the editorial");
      return codexChat({
        system: "",
        systemPromptFile: found.voice.path,
        /*
          UNIT U31 -- the writer gets its web search back (U12b took it away).

          U12b passed `--disable standalone_web_search` here so the writing
          call could not search. That is the capability the voice's research
          protocol needs, so it is asked for again -- and asked for BY NAME
          rather than left to the CLI: before U12 this call named nothing at
          all and inherited codex-cli 0.145.0's own default, which is `false`
          for `standalone_web_search`. Stating `webSearch: true` is what makes
          the restored capability a property a test can hold instead of a
          default the installed CLI is free to change.
        */
        webSearch: true,
        user: buildWritingPack({
          paper: editorialInput.paper,
          subject: editorialInput.subject,
          ourStory: editorialInput.ourStory,
          askedFor: editorialInput.askedFor,
          research: completedResearch,
        }),
        model: providerModel(entry),
        timeoutMs: editorialTimeoutMs(),
        reasoningEffort: modelEffort(choice, editorialInput.modelEffort),
      });
    },
    /*
      The one-pass-writing pair: every OpenAI-compatible writer Opinion's ladder
      can land on -- the "Local model" pick, and Automatic's DeepSeek v4.1 Flash
      rung (units U29 + U30). Unlike the Claude Code CLI, an Ollama / llama.cpp
      server has no WebSearch/WebFetch tool loop for THE MODEL to run a
      gathering pass with (see EDITORIAL_TOOLS). Since U30 that is not the same
      as "no research": the DESK runs its own bounded pass first
      (./editorial-research.server.ts -- searches, page opens and captures
      through the machinery the Dark Desk uses) and this pair still makes the
      one WRITING call: the voice as the system instructions, no tools, from
      the desk's record. It has no `--system-prompt-file` equivalent either, so
      the voice travels as an ordinary system string through
      `readVoiceTextForLocalModel` -- the same destination-named-authorization
      idea voice.server.ts's other text export used for a withdrawn provider
      path, scoped to this call site. The voice is never an argument and
      is never logged; it goes in the request body's system message.

      Which endpoint and model: the registry entry decides. "Local model"
      carries the editor's own per-newsroom server/model pick (see
      ./provider-settings.ts's `resolveLocalModelChoice`), while a rung such
      as DeepSeek carries its endpoint in the registry (`rungGateway`), so it
      never reads LLM_BASE_URL and cannot be sent to the editor's local pick
      by accident.
    */
    runLocalPair: async ({ input: editorialInput, researchPack }) => {
      const voice = await readVoiceTextForLocalModel();
      if (!voice.ok) return voice;
      const choice = opinionModelChoice(editorialInput.modelChoice);
      const entry = providerEntry(choice);
      if (!entry || (entry.kind !== "local" && entry.kind !== "openai")) {
        // Unreachable through `runPair`, which dispatches on the same field --
        // but a runtime assembled by hand must not silently write on Claude.
        return { ok: false, error: "The selected local model is unavailable." };
      }
      const isLocalPick = entry.id === "local-model";
      // Same per-newsroom "which local server/model" pick every other
      // surface honours (Story, Scan, Dark Desk) -- see
      // ./provider-settings.ts's `resolveLocalModelChoice`. Failure here
      // (no database, discovery unreachable) falls back to the env-only
      // resolution `localGateway()` already does, exactly as before this
      // wiring existed.
      const localModel = isLocalPick
        ? editorialInput.localModel ?? await import("./provider-settings.ts")
          .then((m) => m.resolveLocalModelChoice(editorialInput.newsroomId, "opinion"))
          .then((r) => r.override)
          .catch(() => undefined)
        : undefined;
      // The exact model this call is sent to, which is what an effort level
      // is validated against: the resolved local pick, or the rung's own
      // registry model (DeepSeek v4.1 Flash declares off/low/high/max).
      const exactModel = isLocalPick ? localModel?.id : providerModel(entry);
      const { grokChat } = await import("./ai.ts");
      const chat = deps.grokChat ?? grokChat;
      /*
        UNIT U30 -- THE DESK RESEARCHES FOR THIS WRITER.

        It runs HERE, before the writing call, and its two model calls are the
        same no-tool transport: the provider that plans the queries and reads
        the captures is the rung the editor picked. The transport underneath
        them has no tool surface, so the research pass never holds the web and
        the voice at once -- it holds the voice and the desk does the fetching.

        L7 of the batch-7 pre-merge audit: this note used to say "neither of
        those calls is given the voice", and that is the pre-U31 shape. U31 (the
        owner's D20) is the reverse: `deskResearchFor` is handed `voice.text` as
        the system message of BOTH calls, exactly as the writing call is,
        because the voice file carries the research protocol the planner and the
        reader are told to follow. The boundary SEC-3 describes is about tools,
        not about the voice, and SECURITY.md records it that way: "the model
        holds the voice and the desk holds the fetching".

        What the editor is owed instead is the truth about the pass, and the run
        says it: the desk searched and read, and the writing pack carries the
        counts, the captures' URLs and their capture ids.
      */
      const desk = await deskResearchFor(editorialInput, researchPack, voice.text, chat, {
        choice,
        ...(localModel ? { localModel } : {}),
        exactModel,
      });
      await reportStage(editorialInput)("Writing the editorial");
      return chat(
        voice.text,
        buildWritingPack({
          paper: editorialInput.paper,
          subject: editorialInput.subject,
          ourStory: editorialInput.ourStory,
          askedFor: editorialInput.askedFor,
          research: desk.findings,
          suppliedMaterial: editorialInput.sourceText,
          deskResearch: {
            searches: desk.searches,
            pages: desk.pages,
            captures: desk.captures,
            window: desk.window,
          },
        }),
        4_000,
        {
          timeoutMs: editorialTimeoutMs(),
          choice,
          ...(localModel ? { localModel } : {}),
          reasoningEffort: modelEffort(choice, editorialInput.modelEffort, exactModel),
        },
      );
    },
    /*
      A saved connection is an OpenAI-compatible endpoint too, so it has no tool
      loop either and gets the same desk-run research the local pair does (unit
      U30). Before U30 this pair handed the writing pack no research record at
      all and so fell through to the two-pass wording -- "by a separate pass
      that searched and opened public sources before you" -- which was never
      true of a custom connection. Now the pack describes the pass that actually
      ran, under the same voice (unit U31).
    */
    runCustomPair: async ({ input: editorialInput, researchPack }) => {
      const voice = await readVoiceTextForLocalModel();
      if (!voice.ok) return voice;
      const { grokChat } = await import("./ai.ts");
      const chat = deps.grokChat ?? grokChat;
      const desk = await deskResearchFor(editorialInput, researchPack, voice.text, chat, {
        choice: opinionModelChoice(editorialInput.modelChoice),
      });
      await reportStage(editorialInput)("Writing the editorial");
      return chat(
        voice.text,
        buildWritingPack({
          paper: editorialInput.paper,
          subject: editorialInput.subject,
          ourStory: editorialInput.ourStory,
          askedFor: editorialInput.askedFor,
          research: desk.findings,
          suppliedMaterial: editorialInput.sourceText,
          deskResearch: {
            searches: desk.searches,
            pages: desk.pages,
            captures: desk.captures,
            window: desk.window,
          },
        }),
        4_000,
        {
          timeoutMs: editorialTimeoutMs(),
          choice: editorialInput.modelChoice,
          newsroomId: editorialInput.newsroomId,
          // The custom resolver supplies the exact saved model to grokChat;
          // its transport performs the final model-specific validation.
          reasoningEffort: modelEffort(
            editorialInput.modelChoice,
            editorialInput.modelEffort,
          ),
        },
      );
    },
    fileEditorial,
    timeoutMs: editorialTimeoutMs,
    onTechnicalFallback: async ({ previous, next, reason }) => {
      if (!input.completion) return;
      const receipt = opinionFallbackRuntimeReceipt({
        requestedRuntime: opinionModelChoice(input.requestedModelChoice ?? input.modelChoice),
        requestedEffort: input.requestedModelEffort ?? input.modelEffort,
        previous,
        next,
        reason,
      });
      await setJobModelRuntime(
        input.completion.jobId,
        receipt.actualRuntime,
        receipt.actualEffort,
        receipt.requestedRuntime,
        receipt.requestedEffort,
        "writer",
      );
      await setJobStage(input.completion.jobId, receipt.stage);
      await setJobFailoverNote(input.completion.jobId, receipt.note);
    },
  });
}

/**
 * File the five parts.
 *
 * Split deliberately from the writing so the parse and the storage can be
 * tested without spending ten minutes and several dollars on a model call.
 */
export async function fileEditorial(
  input: WriteEditorialInput,
  ed: Editorial,
  modelChoice?: EffectiveOpinionModelChoice,
  deps: {
    checkEditorialNames?: typeof import("./editorial-name-check.ts").checkEditorialNames;
    setJobStage?: typeof setJobStage;
  } = {},
): Promise<FiledEditorialResult> {
  await ensureEditorialSchema();
  if (input.completion && !modelChoice) {
    throw new Error("A queued editorial completion requires the provider that produced it.");
  }

  let nameCheck: NameCheck | undefined;
  let integrityNotes = editorialSourcesError(ed.appendix) ?? "";
  if (input.completion && modelChoice) {
    await (deps.setJobStage ?? setJobStage)(input.completion.jobId, "Checking names and spellings");
    const checkEditorialNames =
      deps.checkEditorialNames ?? (await import("./editorial-name-check.ts")).checkEditorialNames;
    let nameRuntime = {
      modelChoice,
      modelEffort: modelEffort(modelChoice, input.modelEffort),
    };
    const requestedRuntime = opinionModelChoice(input.requestedModelChoice ?? input.modelChoice);
    const requestedEffort = input.requestedModelEffort ?? input.modelEffort ?? null;
    // The provider that produced the saved prose and the provider that checks
    // it are separate facts. Record the writer before a checker can switch.
    await setJobModelRuntime(
      input.completion.jobId,
      nameRuntime.modelChoice,
      nameRuntime.modelEffort,
      requestedRuntime,
      requestedEffort,
      "writer",
    );
    await setJobModelRuntime(
      input.completion.jobId,
      nameRuntime.modelChoice,
      nameRuntime.modelEffort,
      requestedRuntime,
      requestedEffort,
      "checker",
    );
    const recordNameSwitch = async (
      nextChoice: EffectiveOpinionModelChoice,
      reason: import("./automatic-failover.ts").AutomaticFailoverReason,
      suppliedNextLabel?: string,
    ) => {
      if (nextChoice === nameRuntime.modelChoice) return;
      const previousLabel = modelChoiceLabel(nameRuntime.modelChoice);
      const nextLabel = suppliedNextLabel ?? modelChoiceLabel(nextChoice);
      const nextEffort = modelEffort(nextChoice, nameRuntime.modelEffort);
      await setJobModelRuntime(
        input.completion!.jobId,
        nextChoice,
        nextEffort,
        requestedRuntime,
        requestedEffort,
        "checker",
      );
      await setJobStage(input.completion!.jobId, `Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, reason)}`);
      await setJobFailoverNote(input.completion!.jobId, failoverNoteSentence(nextLabel, previousLabel, reason));
      // The request's model_choice is author attribution. A checker-only
      // fallback is recorded on runtimeByStage.checker and must not relabel
      // the already-written editorial as the checker provider's work.
      nameRuntime = { modelChoice: nextChoice, modelEffort: nextEffort };
    };
    const nameChat: import("./report.ts").ReportChat = async (
      system,
      user,
      maxTokens,
      _choice,
      options,
    ) => {
      const attempted = await runPinnedCallWithFailover({
        snapshot: nameRuntime,
        source: "editor",
        ladder: OPINION_AUTOMATIC_LADDER,
        run: (snapshot) => grokChat(system, user, maxTokens, {
          choice: snapshot.modelChoice,
          newsroomId: input.newsroomId,
          timeoutMs: options?.timeoutMs,
          noTools: true,
          reasoningEffort: snapshot.modelEffort,
        }),
        probe: (choice) => probeProvider(choice, input.newsroomId, undefined, "opinion"),
        resolve: async (choice) => ({
          modelChoice: choice as EffectiveOpinionModelChoice,
          modelEffort: modelEffort(choice, nameRuntime.modelEffort),
        }),
        onSwitch: async ({ previousLabel, nextLabel, nextChoice, reason }) => {
          void previousLabel;
          await recordNameSwitch(nextChoice as EffectiveOpinionModelChoice, reason, nextLabel);
        },
      });
      nameRuntime = attempted.snapshot;
      return attempted.result;
    };
    const checked = await checkEditorialNames({
      newsroomId: input.newsroomId,
      editorialRequestId: input.completion.requestId,
      modelChoice: nameRuntime.modelChoice,
      modelEffort: nameRuntime.modelEffort,
      onProviderSwitch: async ({ transport, model, reason }) => {
        const nextChoice: EffectiveOpinionModelChoice | null = transport === "codex"
          ? "codex-balanced"
          : transport === "anthropic" || transport === "claude-code"
            ? (/haiku/i.test(model) ? "claude-haiku" : "claude-sonnet")
            : null;
        if (nextChoice) await recordNameSwitch(nextChoice, reason);
      },
      chat: nameChat,
      userId: input.userId,
      publicResearchAllowed: true,
      officialDomains: input.paper?.officialDomains ?? [],
      editorial: ed,
      integrityNotes,
      city: input.paper?.city ?? "",
    });
    ed = checked.editorial;
    nameCheck = checked.nameCheck;
    integrityNotes = checked.integrityNotes;
  }

  /*
    UNIT B8P -- WHAT THE MODEL WAS NOT GIVEN.

    The cap itself is applied where the prompt is built (`editorial.ts`'s
    `suppliedMaterialForPrompt`, the one way either pack reads this text), and
    it is applied again here from the SAME pure function and the same input, so
    the note the editor reads cannot disagree with what was actually sent. When
    nothing was cut this is null and nothing is stored.

    It is stored on the draft, in `research_json` -- the free-form JSON blob the
    desk screens already read back (`nameCheck` lives there the same way) -- so
    the note persists WITH the piece and survives a reload. No migration.
  */
  const suppliedMaterial = suppliedMaterialForPrompt({
    subject: input.subject,
    sourceText: input.sourceText,
  });
  const lengthCut = suppliedMaterial ? suppliedMaterialCutRecord(suppliedMaterial) : null;

  // Receipts at the end of the piece, where the reader can reach them.
  const body = ed.appendix ? `${ed.body}\n\n---\n\nCLAIMS AND SOURCES\n\n${ed.appendix}` : ed.body;

  const headline = opinionHeadline(ed.headline);
  if (nameCheck)
    nameCheck = { ...nameCheck, checkedText: nameCheckText({ headline, dek: "", body }) };
  return withTransaction(async (sql) => {
    if (input.completion) {
      const [request] = await sql<{
        draft_id: number | null;
        model_choice: string;
        source_kind: string;
      }>`
        select draft_id, model_choice, source_kind from editorial_requests
        where id = ${input.completion.requestId} and newsroom_id = ${input.newsroomId}
        for update
      `;
      if (!request) {
        throw new Error(
          `Editorial request ${input.completion.requestId} was not found during filing.`,
        );
      }

      if (request.source_kind === "legal-removed") {
        throw new Error(
          "The request's source was legally removed. Review sources and start a new request; stale output was not filed.",
        );
      }

      if (request.draft_id !== null) {
        const [existing] = await sql<{ id: number; headline: string; body: string }>`
          select id, headline, body from drafts
          where id = ${request.draft_id} and newsroom_id = ${input.newsroomId}
          limit 1
        `;
        if (existing) {
          const storedChoice = opinionModelChoice(request.model_choice);
          await persistEditorialCompletion(sql, {
            requestId: input.completion.requestId,
            jobId: input.completion.jobId,
            newsroomId: input.newsroomId,
            draftId: existing.id,
            modelChoice: storedChoice === "auto" ? modelChoice! : storedChoice,
          });
          return {
            ok: true,
            draftId: existing.id,
            headline: existing.headline,
            words: existing.body.split(/\s+/).filter(Boolean).length,
            hadAppendix: existing.body.includes("\nCLAIMS AND SOURCES\n"),
          };
        }
      }
    }

    /*
      The opinion writer's own row, in the same columns the Story drafter
      writes: `headline`, `body` and `integrityNotes` are model prose in `text`
      columns, and `research_json` is the JSON blob the desk screen reads back
      through `::jsonb` (see the drafts projection in desk.ts). One U+0000 in
      any of them fails the INSERT -- or, for `research_json`, poisons the row
      against every later read.

      `editorial_extras` beside it holds the two other things the model wrote:
      the fact sheet and the image prompt. Same guard, same reason.
    */
    const rows = await sql<{ id: number }>`
      insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls, form, integrity_notes, research_json)
      values (
        ${input.userId}, ${input.newsroomId}, ${input.leadId ?? null},
        ${storableText(headline)}, ${""}, ${storableText(body)}, ${"opinion"}, ${"[]"}, ${"editorial"},
        ${storableText(integrityNotes)},
        ${JSON.stringify(
          sanitizeJsonLeaves({
            ...(nameCheck ? { nameCheck } : {}),
            ...(lengthCut ? { lengthCut } : {}),
          }),
        )}
      )
      returning id
    `;
    const draftId = rows[0]!.id;

    await sql`
      insert into editorial_extras (draft_id, newsroom_id, fact_sheet, image_prompt, source_kind, source_ref)
      values (${draftId}, ${input.newsroomId}, ${storableText(ed.factSheet).slice(0, 8000)},
              ${storableText(ed.imagePrompt).slice(0, 4000)}, ${input.sourceKind}, ${input.sourceRef})
      on conflict (draft_id) do update
        set fact_sheet = excluded.fact_sheet, image_prompt = excluded.image_prompt,
            generated_at = now()
    `;

    const filed = {
      ok: true as const,
      draftId,
      headline,
      words: ed.body.split(/\s+/).filter(Boolean).length,
      hadAppendix: editorialSourcesError(ed.appendix) === null,
    };
    if (input.completion) {
      await persistEditorialSuccess(sql, {
        requestId: input.completion.requestId,
        jobId: input.completion.jobId,
        newsroomId: input.newsroomId,
        result: { ...filed, modelChoice: modelChoice! },
      });
    }
    return filed;
  });
}

/**
 * A request to write one, and the job that does it.
 *
 * The request is a row rather than a job argument because a job carries only an
 * integer subject, and an editorial needs a subject line, pointers, and what
 * the editor asked for. The row is also where the result lands, so the desk can
 * show "writing…" and then the piece without polling the model.
 */
export async function ensureEditorialRequestSchema() {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "editorial-requests", [
    `
    create table if not exists editorial_requests (
      id serial primary key,
      user_id text not null,
      newsroom_id integer not null default 1,
      subject text not null,
      source_text text not null default '',
      source_kind text not null default 'paste',
      source_ref text not null default '',
      asked_for text not null default '',
      pointers_json text not null default '[]',
      our_story_json text,
      model_choice text not null default 'auto',
      draft_id integer,
      error text,
      created_at timestamptz not null default now(),
      finished_at timestamptz
    )
  `,
    `alter table editorial_requests add column if not exists model_choice text not null default 'auto'`,
    `alter table editorial_requests add column if not exists source_text text not null default ''`,
  ]);
}

type EditorialWorkDeps = {
  writeEditorial?: (input: WriteEditorialInput) => Promise<WriteEditorialResult>;
  readEditorialDocuments?: typeof import("./story-documents.server.ts").readEditorialDocuments;
  documentProbe?: typeof probeProvider;
  documentChat?: typeof grokChat;
};

export async function performEditorialWork(
  job: {
    id: number;
    user_id: string;
    newsroom_id: number;
    subject_id: number;
    model_choice: string;
    model_choice_source?: "editor" | "auto" | "scheduled";
    result_json?: string;
  },
  deps: EditorialWorkDeps = {},
) {
  await ensureEditorialRequestSchema();
  // Local jobs are bound to the exact endpoint/model checked before enqueue.
  // Reading uploads and writing the editorial must use the same pinned choice,
  // even if the newsroom preference changes while the job waits in the queue.
  const queuedLocalModel = pinnedLocalModelForJob(job as Pick<import("./jobs.ts").DeskJob, "model_choice" | "result_json">);
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    subject: string;
    source_text: string;
    source_kind: string;
    source_ref: string;
    asked_for: string;
    pointers_json: string;
    our_story_json: string | null;
    model_choice: string;
    draft_id: number | null;
  }>`
    select id, subject, source_text, source_kind, source_ref, asked_for, pointers_json, our_story_json,
           model_choice, draft_id
    from editorial_requests
    where id = ${job.subject_id} and newsroom_id = ${job.newsroom_id} limit 1
  `;
  const req = rows[0];
  if (!req) throw new Error("Editorial request not found");
  let jobReceipt: {
    modelEffort?: unknown;
    requestedRuntime?: unknown;
    requestedEffort?: unknown;
  } = {};
  try {
    jobReceipt = JSON.parse(job.result_json || "{}") as typeof jobReceipt;
  } catch {
    jobReceipt = {};
  }

  if (req.source_kind === "legal-removed") {
    throw new Error(
      "The request's source was legally removed. Review sources and start a new request.",
    );
  }

  if (req.draft_id !== null) {
    const reused = await withTransaction(async (tx) => {
      const [current] = await tx<{ draft_id: number | null; model_choice: string }>`
        select draft_id, model_choice from editorial_requests
        where id = ${req.id} and newsroom_id = ${job.newsroom_id}
        for update
      `;
      if (!current || current.draft_id === null) return false;
      const [draft] = await tx<{ id: number }>`
        select id from drafts
        where id = ${current.draft_id} and newsroom_id = ${job.newsroom_id}
        limit 1
      `;
      if (!draft) return false;
      await persistEditorialCompletion(tx, {
        requestId: req.id,
        jobId: job.id,
        newsroomId: job.newsroom_id,
        draftId: draft.id,
        modelChoice: opinionModelChoice(current.model_choice),
      });
      return true;
    });
    if (reused) return;
  }

  let pointers: EditorialPointer[] = [];
  let ourStory: { headline: string; url: string; dek?: string } | undefined;
  try {
    pointers = JSON.parse(req.pointers_json) as EditorialPointer[];
  } catch {
    pointers = [];
  }
  try {
    ourStory = req.our_story_json ? JSON.parse(req.our_story_json) : undefined;
  } catch {
    ourStory = undefined;
  }

  let documentEvidence = "";
  const readEditorialDocuments =
    deps.readEditorialDocuments ??
    (await import("./story-documents.server.ts")).readEditorialDocuments;
  const requestedChoice = opinionModelChoice(
    typeof jobReceipt.requestedRuntime === "string"
      ? jobReceipt.requestedRuntime
      : req.model_choice,
  );
  const requestedEffort = modelEffort(
    requestedChoice,
    jobReceipt.requestedEffort ?? jobReceipt.modelEffort,
  );
  const currentChoice = opinionModelChoice(req.model_choice);
  /* The one probe this job uses, for the ladder walk below and for the
     document pass's own routing -- so a queued local model is verified
     against the same endpoint both places ask about. */
  const probeOpinion = (choice?: string) =>
    (deps.documentProbe ?? probeProvider)(
      choice,
      job.newsroom_id,
      undefined,
      "opinion",
      queuedLocalModel ?? undefined,
    );
  /*
    Which rung an Automatic request starts on.

    `OPINION_AUTOMATIC_LADDER[0]` used to be right by construction: rank 1 was
    Codex Sol, a subscription the editor has been told to sign in to. Unit U29
    put DeepSeek v4.1 Flash -- an Ollama endpoint this machine may simply not
    have -- at the head of that ladder, and the first thing this job does with
    its start choice is PROBE it (the document pass below). A desk with no
    Ollama server would begin every Automatic editorial on a rung that cannot
    answer.

    So Automatic is RESOLVED here, the way every other surface resolves it:
    walk the ladder in registry order and start on the first rung that
    answers. When none does, the head is kept and the document pass reports
    the probe's own reason -- the same sentence the editor saw at commit time,
    rather than a new one invented here.
  */
  /*
    B8B item 2: the Opinion desk's own boundary check.

    `writeEditorial` reads Cancel at each research hop (U30's `throwIfCancelled`),
    and the write below runs under `waitForModel`, which polls it -- but
    `performEditorialWork` itself never asked, so a Cancel pressed on a piece
    that had been claimed still spent the rung probe and the whole document
    reading pass before anything noticed. This is the boundary before the first
    of those: the probe at `resolvedRung`, which is a real call to a real
    provider.
  */
  await throwIfJobCancelled(job.id);
  const resolvedRung =
    currentChoice === "auto"
      ? await firstReadyOpinionRung((rung) => probeOpinion(rung))
      : null;
  let activeChoice: EffectiveOpinionModelChoice =
    resolvedRung ?? (currentChoice === "auto" ? OPINION_AUTOMATIC_LADDER[0]! : currentChoice);
  let activeEffort = modelEffort(activeChoice, jobReceipt.modelEffort);
  try {
    documentEvidence = await readEditorialDocuments(
        job.newsroom_id,
        req.id,
        activeChoice as Parameters<typeof readEditorialDocuments>[2],
        [req.subject, req.asked_for].filter(Boolean).join("\n"),
        (stage) => setJobStage(job.id, stage),
        job.user_id,
        {
          modelEffort: activeEffort,
          source: requestedChoice === "auto" ? "auto" : (job.model_choice_source ?? "editor"),
          ladder: OPINION_AUTOMATIC_LADDER,
          probe: probeOpinion,
          localModel: queuedLocalModel ?? undefined,
          chat: deps.documentChat,
          onSwitch: async ({ previousLabel, nextLabel, nextChoice, nextEffort, reason }) => {
            activeChoice = nextChoice as EffectiveOpinionModelChoice;
            activeEffort = nextEffort;
            await setJobModelRuntime(
              job.id,
              nextChoice,
              nextEffort,
              requestedChoice,
              requestedEffort,
              "documents",
            );
            await setJobStage(job.id, `Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, reason)}`);
            await setJobFailoverNote(job.id, failoverNoteSentence(nextLabel, previousLabel, reason));
            await sql`update editorial_requests set model_choice=${nextChoice} where id=${req.id} and newsroom_id=${job.newsroom_id}`;
          },
        },
      );
  } catch (readingFailure) {
    const detail =
      readingFailure instanceof Error ? readingFailure.message : String(readingFailure);
    await sql`update editorial_requests set error=${detail.slice(0, 800)},finished_at=now()
      where id=${req.id} and newsroom_id=${job.newsroom_id} and draft_id is null`;
    throw readingFailure;
  }
  await setJobStage(job.id, "Researching the editorial");
  /*
    The second half of B8B item 2's editorial fix: the boundary between the
    document reading pass and the write. A Cancel that arrived while the uploads
    were being read is read here, so the desk does not answer "stop" with a
    written piece -- which is the one outcome an editor who cancelled cannot
    undo.
  */
  await throwIfJobCancelled(job.id);
  const result = await waitForModel({
    jobId: job.id,
    // `activeChoice` is reassigned by the reading pass's switch handler above,
    // and again by the writer's own, so the ticker follows the piece's model.
    label: () => modelChoiceLabel(activeChoice),
    run: () =>
      (deps.writeEditorial ?? writeEditorial)({
        userId: job.user_id,
        newsroomId: job.newsroom_id,
        subject: req.subject,
        sourceText: documentEvidence || req.source_text || req.subject,
        pointers,
        ourStory,
        askedFor: req.asked_for,
        sourceKind: req.source_kind,
        sourceRef: req.source_ref,
        modelChoice: activeChoice,
        modelEffort: activeEffort,
        requestedModelChoice: requestedChoice,
        requestedModelEffort: requestedEffort,
        completion: { requestId: req.id, jobId: job.id },
        localModel: queuedLocalModel ?? undefined,
        /*
          The FB1 stage reporter, bound to the row this worker claimed. It is
          the only place the row's stage LIST is in scope, so it is the only
          place a stage sentence can be turned into a chip index -- see
          `progressReporterFor`. The desk research pass (unit U30) is the
          newest caller: "Researching with the desk" is an arrival in
          `JOB_STAGE_LISTS.editorial`, and this is what lights it.
        */
        onStage: progressReporterFor(job as Pick<import("./jobs.ts").DeskJob, "id" | "stages_json">),
      }),
  });

  if (!result.ok) {
    // A reclaimed job can finish while its old provider call is still alive.
    // That old call's failure must not turn the successfully filed piece
    // back into a failed request; executeJob separately guards the job claim.
    await sql`
      update editorial_requests set error = ${result.error.slice(0, 800)}, finished_at = now()
      where id = ${req.id} and newsroom_id = ${job.newsroom_id} and draft_id is null
    `;
    throw new Error(result.error);
  }
}
