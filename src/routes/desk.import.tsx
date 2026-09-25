import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { announceToDesk, areaClass, inputClass } from "@/components/desk-chrome-utils";
import { ModelPicker } from "@/components/model-picker";
import { useEditorSections } from "@/lib/use-sections";
import { importFinishedStories, listLeads, listPublishedDesk, structureImportStories } from "@/lib/news/desk";
import {
  IMPORT_DISCLOSURES,
  IMPORT_LIMITS,
  detectedToolFromTitle,
  htmlToText,
  parseFinishedStories,
  type ImportKind,
  type ParsedReport,
} from "@/lib/news/import-stories";
import {
  BODY_CHOICES,
  IMPORT_KINDS,
  SECTION_REQUIRED,
  cardBody,
  cardDisclosure,
  cardLabel,
  cardProblems,
  cardsFromReport,
  duplicateNote,
  findDuplicate,
  keptLinks,
  readSummary,
  selectionFromCard,
  tickedCards,
  IMPORT_PASTE_KEY,
  type BodyChoice,
  type DuplicateWarning,
  type ReviewCard,
} from "@/lib/news/import-review";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import type { StoryModelChoice } from "@/lib/news/model-choice";

export const Route = createFileRoute("/desk/import")({
  head: () => ({ meta: [{ title: "Import finished stories — TownReporter" }] }),
  component: ImportPage,
});

/**
 * Import finished stories.
 *
 * The owner, 2026-09-24: "I should be able to just dump something like that
 * into the desk somewhere and it should be smart enough to read it all, parse
 * out the stories, headline them and paste the body of the story and the
 * claims/sources links in the right place in the story and put it in the
 * queue. I DO NOT want to run AI's multiple times to find stories."
 *
 * So: one paste, read deterministically, and a review screen where every single
 * step is the editor's to change. Nothing is saved, and no model is asked,
 * until the editor presses Read the stories -- and a text with usable headings
 * is never sent to a model at all. The model call, when it happens, returns the
 * story boundaries and nothing else, and every paragraph it hands back has to
 * be found word for word in the paste before it is accepted.
 */
function ImportPage() {
  const qc = useQueryClient();
  const { sections } = useEditorSections();
  const leads = useQuery({ queryKey: ["leads"], queryFn: () => listLeads() });
  const published = useQuery({ queryKey: ["published-desk"], queryFn: () => listPublishedDesk() });

  const [text, setText] = useState("");
  const [report, setReport] = useState<ParsedReport | null>(null);
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [needsModel, setNeedsModel] = useState(false);
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>("auto");
  const [modelEffort, setModelEffort] = useState<ModelEffort | null>(defaultModelEffort("auto"));
  const [notice, setNotice] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [done, setDone] = useState<{
    imported: { headline: string; kind: ImportKind }[];
    refused: { headline: string; reason: string }[];
  } | null>(null);

  /*
    A paste handed over by the Desk's "Import finished stories" panel. Taken
    once and cleared, so coming back to this screen later opens empty rather
    than silently re-reading a report the editor has already dealt with.
  */
  useEffect(() => {
    let carried = "";
    try {
      carried = sessionStorage.getItem(IMPORT_PASTE_KEY) ?? "";
      sessionStorage.removeItem(IMPORT_PASTE_KEY);
    } catch {
      /* a browser that will not keep it just opens the box empty */
    }
    if (carried.trim()) setText(carried);
  }, []);

  const tool = report?.detectedTool || detectedToolFromTitle(firstLineOf(text));

  /** The duplicate the desk already knows about, if any. The editor decides. */
  const duplicates = useMemo(() => {
    const map = new Map<string, DuplicateWarning>();
    for (const card of cards) {
      const warning = findDuplicate(card, {
        leads: leads.data ?? [],
        published: published.data ?? [],
      });
      if (warning) map.set(card.key, warning);
    }
    return map;
  }, [cards, leads.data, published.data]);

  const patch = (key: string, changes: Partial<ReviewCard>) =>
    setCards((current) => current.map((c) => (c.key === key ? { ...c, ...changes } : c)));

  const ticked = tickedCards(cards);
  const ready = ticked.filter((c) => cardProblems(c).length === 0);
  const blocked = ticked.length - ready.length;
  const storyCount = cards.filter((c) => c.isStory).length;
  const sectionCount = cards.length - storyCount;
  /*
    What is about to be imported, in the two shapes it can arrive in: a finished
    story becomes a draft, a story idea becomes a lead waiting to be written.
    The button says both, because "Import 2 stories" over a paste that is two
    ideas is the same wrong sentence the read notice used to say.
  */
  const readyIdeas = ready.filter((c) => c.kind === "idea").length;
  const readyStories = ready.length - readyIdeas;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const importLabel =
    readyIdeas === 0
      ? `Import ${plural(readyStories, "story", "stories")} to the Queue`
      : readyStories === 0
        ? `Import ${plural(readyIdeas, "story idea", "story ideas")} to the Queue`
        : `Import ${plural(readyStories, "story", "stories")} and ${plural(readyIdeas, "story idea", "story ideas")} to the Queue`;

  /** Read the paste. Deterministic first; a model only if there is nothing to read. */
  const read = () => {
    const parsed = parseFinishedStories(text);
    setDone(null);
    if (parsed.method === "none") {
      // Nothing to read, so the one structure call is offered -- visibly, with
      // the newsroom's own model picker, never behind the editor's back.
      setReport(parsed);
      setCards([]);
      setNeedsModel(true);
      setNotice({
        text: "This text has no headings to read, so the desk can ask a model to find the story boundaries. It copies the words; it does not rewrite them.",
        kind: "info",
      });
      announceToDesk("This text has no headings. You can ask a model to find the story boundaries.");
      return;
    }
    setReport(parsed);
    setNeedsModel(false);
    setCards(cardsFromReport(parsed));
    const summary = readSummary(parsed);
    setNotice({ text: `${summary} Check each one below — nothing is saved yet.`, kind: "info" });
    announceToDesk(`${summary} Check each one, then import.`);
  };

  const structure = useMutation({
    mutationFn: () =>
      structureImportStories({ data: { text, modelChoice, modelEffort } }),
    onSuccess: (result) => {
      if (result.error) {
        setNotice({ text: result.error, kind: "error" });
        announceToDesk(result.error);
        return;
      }
      if (result.stories.length === 0) {
        setNotice({
          text: result.reason || "The model found no stories in that text. Nothing was imported.",
          kind: "error",
        });
        return;
      }
      const base = report ?? parseFinishedStories(text);
      const parsed = { ...base, stories: result.stories };
      setCards(cardsFromReport(parsed));
      setNeedsModel(false);
      const summary = readSummary(parsed);
      setNotice({
        text: [
          summary,
          result.rejected
            ? `${result.rejected} could not be copied word for word and ${result.rejected === 1 ? "was" : "were"} flagged rather than invented.`
            : "",
          result.switchedTo ? `The call moved to ${result.switchedTo} partway through.` : "",
          result.reason,
          "Check each one below — nothing is saved yet.",
        ]
          .filter(Boolean)
          .join(" "),
        kind: "info",
      });
      announceToDesk(`${summary} Check each one, then import.`);
    },
    onError: (err) =>
      setNotice({
        text: err instanceof Error ? err.message : "The desk could not read that text.",
        kind: "error",
      }),
  });

  const runImport = useMutation({
    mutationFn: () =>
      importFinishedStories({
        data: {
          text,
          tool,
          stories: ready.map(selectionFromCard),
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        setNotice({ text: result.error, kind: "error" });
        announceToDesk(result.error);
        return;
      }
      setDone({
        imported: result.imported.map((i) => ({ headline: i.headline, kind: i.kind })),
        refused: result.refused,
      });
      setCards([]);
      setReport(null);
      setText("");
      setNeedsModel(false);
      const held = result.imported.filter((i) => i.hold).length;
      const inIdeas = result.imported.filter((i) => i.kind === "idea").length;
      const inStories = result.imported.length - inIdeas;
      const what =
        inIdeas === 0
          ? plural(inStories, "story", "stories")
          : inStories === 0
            ? plural(inIdeas, "story idea", "story ideas")
            : `${plural(inStories, "story", "stories")} and ${plural(inIdeas, "story idea", "story ideas")}`;
      const line = `${what} in the Queue, marked Imported.${held ? ` ${held} held.` : ""} Nothing is published.`;
      setNotice({ text: line, kind: "info" });
      announceToDesk(line);
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["published-desk"] });
    },
    onError: (err) =>
      setNotice({
        text: err instanceof Error ? err.message : "Those stories were not imported. Nothing was changed.",
        kind: "error",
      }),
  });

  async function readFile(file: File | undefined) {
    if (!file) return;
    const raw = await file.text();
    const isHtml = /\.html?$/i.test(file.name) || /^\s*<(!doctype|html)/i.test(raw);
    setText(isHtml ? htmlToText(raw) : raw);
    setReport(null);
    setCards([]);
    setNeedsModel(false);
    setDone(null);
    announceToDesk(`${file.name} is in the box. Read the stories when you are ready.`);
  }

  return (
    <DeskShell
      title="Import finished stories"
      kicker="Editor desk"
      lede={
        <>
          Paste one story, or a whole report with many. The text is kept exactly as written — the desk
          reads it, headlines it, and puts each story in the Queue as a draft for you to check. Nothing
          is published from here, and nothing is saved until you press Import.
        </>
      }
    >
      <section className="mt-8">
        <SecHead
          title="The paste"
          sub="A story on its own, or a report with headings. A saved page (.md, .txt, .html) can be chosen instead."
        />
        <div className="mt-4 max-w-3xl space-y-3">
          <label className="block">
            <span className="text-sm tracking-[0.14em] text-muted uppercase">
              Paste the report or the story
            </span>
            <textarea
              className={areaClass + " mt-1 w-full"}
              rows={12}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={IMPORT_LIMITS.text}
              placeholder={"# A report title, if it has one\n\n### 1. The headline of the first story\nThe body of the story, exactly as it was written. [A source](https://example.test/record)\n\n### 2. The next story\n…"}
            />
          </label>
          <label className="block">
            <span className="text-sm tracking-[0.14em] text-muted uppercase">
              …or choose a file (.md, .txt, .html)
            </span>
            <input
              type="file"
              accept=".md,.markdown,.txt,.html,.htm,text/plain,text/markdown,text/html"
              className={inputClass + " mt-1 w-full"}
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
          </label>
          {report ? (
            <p className="text-sm text-muted">
              Read as: {report.title || "no title"} · read by {tool || "the desk itself"}
              {report.method === "plain" ? " · one story, no headings" : ""}
              {/*
                "22 stories" over a report whose twenty-two leads are ten
                written stories and twelve ideas is the count the read notice
                used to give, in a second place.
              */}
              {report.method === "structured"
                ? ` · ${storyCount} ${report.stories.some((s) => s.isStory && s.kind === "idea") ? "stories and ideas" : "stories"}, ${sectionCount} sections that are not stories`
                : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <InkButton tone="solid" onClick={read} disabled={text.trim().length < 20 || structure.isPending}>
              {structure.isPending ? "Reading…" : "Read the stories"}
            </InkButton>
            {text ? (
              <InkButton
                tone="quiet"
                onClick={() => {
                  setText("");
                  setReport(null);
                  setCards([]);
                  setNeedsModel(false);
                  setNotice(null);
                  setDone(null);
                }}
              >
                Clear the box
              </InkButton>
            ) : null}
            <span role="status" aria-live="polite" aria-atomic="true" className="text-sm text-muted">
              {notice?.kind === "info" ? notice.text : ""}
            </span>
            <span role="alert" aria-live="assertive" aria-atomic="true" className="text-sm text-rust">
              {notice?.kind === "error" ? notice.text : ""}
            </span>
          </div>
        </div>
      </section>

      {needsModel ? (
        <section className="mt-10 max-w-3xl border border-rule bg-paper-2 p-4">
          <SecHead
            title="No headings to read"
            sub="There is nothing in this text the desk can split on its own, so it can ask a model once to find where each story starts and ends."
          />
          <p className="mt-3 text-sm text-ink-2">
            The model returns only the structure — the story boundaries, the headline of each, and which
            paragraphs belong to it, copied. Every paragraph it hands back has to be found word for word in
            your paste; a story that fails that check is flagged for you instead of being imported.
          </p>
          <div className="mt-3 space-y-3">
            <ModelPicker
              scope="story"
              value={modelChoice}
              onChange={(choice) => {
                setModelChoice(choice);
                setModelEffort(defaultModelEffort(choice));
              }}
              effort={modelEffort}
              onEffortChange={setModelEffort}
              disabled={structure.isPending}
            />
            <InkButton tone="solid" onClick={() => structure.mutate()} disabled={structure.isPending}>
              {structure.isPending ? "Reading…" : "Read the stories with a model"}
            </InkButton>
          </div>
        </section>
      ) : null}

      {cards.length > 0 ? (
        <section className="mt-12">
          <SecHead
            title="Check every story"
            count={cards.length}
            sub={`${ticked.length} ticked · ${ready.length} ready to import${blocked ? ` · ${blocked} need a look first` : ""}. Everything here is yours to change.`}
          />
          <ul className="mt-4 space-y-6">
            {cards.map((card) => {
              const problems = cardProblems(card);
              const warning = duplicates.get(card.key);
              return (
                <li
                  key={card.key}
                  className={
                    "border p-4 " + (card.include ? "border-rule" : "border-rule bg-paper-2 opacity-80")
                  }
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <input
                      id={`tick-${card.key}`}
                      type="checkbox"
                      className="mt-1 h-5 w-5"
                      checked={card.include}
                      onChange={(e) => patch(card.key, { include: e.target.checked })}
                    />
                    {/*
                      The label keeps 16rem before the Triage/Score line may
                      share its row. Without the floor, flex shrank the headline
                      to about eight characters on a 375px phone and it read one
                      word to a line; the flags wrap instead.
                    */}
                    <label
                      htmlFor={`tick-${card.key}`}
                      className="min-w-[16rem] flex-1 text-sm"
                    >
                      <span className="text-sm tracking-[0.14em] text-muted uppercase">
                        {card.isStory
                          ? card.kind === "idea"
                            ? "Import this idea"
                            : "Import this story"
                          : "Not a story — import it anyway?"}
                      </span>
                      <span className="mt-0.5 block text-base font-medium">{cardLabel(card)}</span>
                    </label>
                    <span className="flex flex-wrap items-center gap-2">
                      {card.hold ? (
                        <span className="text-sm tracking-[0.14em] text-rust uppercase">Hold</span>
                      ) : null}
                      {card.triage ? (
                        <span className="text-sm text-muted">Triage: {card.triage}</span>
                      ) : null}
                      {card.score ? <span className="text-sm text-muted">Score: {card.score}</span> : null}
                    </span>
                  </div>

                  {!card.cleanSplit ? (
                    <p className="mt-2 text-sm text-rust">
                      Could not split this cleanly — check it. The text is kept exactly as pasted.
                    </p>
                  ) : null}
                  {card.warning ? <p className="mt-2 text-sm text-rust">{card.warning}</p> : null}
                  {warning ? (
                    <p className="mt-2 text-sm text-rust">
                      {duplicateNote(warning)}{" "}
                      {warning.slug ? (
                        <Link to="/articles/$slug" params={{ slug: warning.slug }} className="inline-link">
                          Read the published one
                        </Link>
                      ) : null}
                    </p>
                  ) : null}

                  {/*
                    Step D, 2026-09-24: "Each card gets 'Import as: Finished
                    story / Story idea'." The desk reads a card's kind off its
                    own text, and the editor overrules it here -- the two
                    routes through the desk are a draft to edit and a lead to
                    write, and nothing else on this card says which one is
                    about to happen.
                  */}
                  <fieldset className="mt-3 min-w-0">
                    <legend className="text-sm tracking-[0.14em] text-muted uppercase">
                      Import as
                    </legend>
                    <div className="mt-1 space-y-1">
                      {IMPORT_KINDS.map((option) => (
                        <label key={option.key} className="flex items-start gap-2 text-sm">
                          <input
                            type="radio"
                            name={`kind-${card.key}`}
                            className="mt-1 h-4 w-4"
                            checked={card.kind === option.key}
                            onChange={() => patch(card.key, { kind: option.key })}
                          />
                          <span>
                            {option.label}
                            <span className="block text-sm text-muted">{option.note}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="text-sm tracking-[0.14em] text-muted uppercase">Headline</span>
                      <input
                        className={inputClass + " mt-1 w-full"}
                        value={card.headline}
                        maxLength={IMPORT_LIMITS.headline}
                        onChange={(e) => patch(card.key, { headline: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm tracking-[0.14em] text-muted uppercase">Section</span>
                      <select
                        className={inputClass + " mt-1 w-full"}
                        value={card.section}
                        disabled={sections.length === 0}
                        onChange={(e) => patch(card.key, { section: e.target.value })}
                      >
                        <option value="">{SECTION_REQUIRED}</option>
                        {sections.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.name}
                          </option>
                        ))}
                        {card.section && !sections.some((s) => s.key === card.section) ? (
                          <option value={card.section}>Suggested — not one of your sections, pick again</option>
                        ) : null}
                      </select>
                      {sections.length === 0 ? (
                        <span className="mt-1 block text-sm text-rust">
                          Your sections could not load. Nothing can be imported until they do — reload the
                          page.
                        </span>
                      ) : card.suggestedSection ? (
                        <span className="mt-1 block text-sm text-muted">
                          Suggested from the text. Change it if it is wrong.
                        </span>
                      ) : null}
                    </label>
                  </div>

                  <label className="mt-3 block">
                    <span className="text-sm tracking-[0.14em] text-muted uppercase">
                      Dek — the line under the headline
                    </span>
                    <textarea
                      className={areaClass + " mt-1 w-full"}
                      rows={2}
                      value={card.dek}
                      onChange={(e) => patch(card.key, { dek: e.target.value })}
                    />
                  </label>

                  {/*
                    min-w-0 on these fieldsets and `wrap-anywhere` on the pasted
                    text: each fieldset is a grid item, so the browser gives it a
                    min-content floor, and the longest unbroken thing in a
                    report is a citation URL. Without both, one card pushed the
                    page 108px sideways on a 375px phone.
                  */}
                  <fieldset className="mt-3 min-w-0">
                    <legend className="text-sm tracking-[0.14em] text-muted uppercase">
                      {card.kind === "idea"
                        ? "The description this idea carries"
                        : "The text this story carries"}
                    </legend>
                    <div className="mt-1 space-y-1">
                      {BODY_CHOICES.map((choice) => {
                        const missing =
                          choice.key !== "main" && !card.plainBrief.trim();
                        return (
                          <label key={choice.key} className="flex items-start gap-2 text-sm">
                            <input
                              type="radio"
                              name={`body-${card.key}`}
                              className="mt-1 h-4 w-4"
                              checked={card.bodyChoice === choice.key}
                              disabled={missing}
                              onChange={() => patch(card.key, { bodyChoice: choice.key as BodyChoice })}
                            />
                            <span>
                              {choice.label}
                              <span className="block text-sm text-muted">
                                {missing
                                  ? `This report wrote no plain-language brief for this ${card.kind === "idea" ? "idea" : "story"}.`
                                  : choice.note}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-sm tracking-[0.14em] text-muted uppercase">
                      Exactly as pasted — not rewritten
                    </p>
                    <pre className="mt-1 max-h-64 overflow-auto border border-rule bg-paper-2 p-3 text-sm whitespace-pre-wrap wrap-anywhere">
                      {cardBody(card)}
                    </pre>
                  </fieldset>

                  {card.links.length > 0 ? (
                    <fieldset className="mt-3 min-w-0">
                      <legend className="text-sm tracking-[0.14em] text-muted uppercase">
                        Sources — {keptLinks(card).length} of {card.links.length} kept
                      </legend>
                      <ul className="mt-1 space-y-1">
                        {card.links.map((link, index) => (
                          <li key={`${card.key}-link-${index}`}>
                            <label className="flex items-start gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4"
                                checked={link.keep}
                                onChange={(e) =>
                                  patch(card.key, {
                                    links: card.links.map((l, i) =>
                                      i === index ? { ...l, keep: e.target.checked } : l,
                                    ),
                                  })
                                }
                              />
                              <span className="min-w-0 break-all">
                                {link.text || link.url}
                                <span className="block text-sm text-muted">{link.url}</span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </fieldset>
                  ) : card.citations.length > 0 ? (
                    /*
                      A report that cites a packet page and no URL is not a
                      report that cites nothing. Saying "no sources" over a
                      card whose sources are listed two lines below is the
                      screen contradicting itself.
                    */
                    <p className="mt-3 text-sm text-muted">
                      This {card.kind === "idea" ? "idea" : "story"} links no pages. Its sources are the
                      documents the report named, below.
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-muted">
                      This {card.kind === "idea" ? "idea" : "story"} cites no links, so it will go in with
                      no sources. You can add them in the story editor.
                    </p>
                  )}

                  {card.citations.length > 0 ? (
                    <fieldset className="mt-3 min-w-0">
                      <legend className="text-sm tracking-[0.14em] text-muted uppercase">
                        Named, not linked — {card.citations.length} the report cited
                      </legend>
                      <ul className="mt-1 list-disc pl-5 text-sm">
                        {card.citations.map((citation, index) => (
                          <li key={`${card.key}-citation-${index}`} className="wrap-anywhere">
                            {citation}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-sm text-muted">
                        These go on the story's sources as names, with no page to open, so whoever edits it
                        knows where the figure came from.
                      </p>
                    </fieldset>
                  ) : null}

                  <fieldset className="mt-3 min-w-0">
                    <legend className="text-sm tracking-[0.14em] text-muted uppercase">
                      Who wrote this — the line readers see
                    </legend>
                    <div className="mt-1 space-y-1">
                      {IMPORT_DISCLOSURES.map((option) => (
                        <label key={option.key} className="flex items-start gap-2 text-sm">
                          <input
                            type="radio"
                            name={`who-${card.key}`}
                            className="mt-1 h-4 w-4"
                            checked={card.disclosureKey === option.key}
                            onChange={() => patch(card.key, { disclosureKey: option.key })}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                    {card.disclosureKey === "other" ? (
                      <label className="mt-2 block">
                        <span className="text-sm tracking-[0.14em] text-muted uppercase">
                          The words to print
                        </span>
                        <input
                          className={inputClass + " mt-1 w-full"}
                          value={card.disclosureOther}
                          maxLength={400}
                          onChange={(e) => patch(card.key, { disclosureOther: e.target.value })}
                        />
                      </label>
                    ) : null}
                    <p className="mt-1 text-sm text-muted">On the page it reads: {cardDisclosure(card) || "—"}</p>
                  </fieldset>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-muted">
                      Editor notes — never published
                      {card.reporterNextStep ? " · a next step is written down" : ""}
                    </summary>
                    <div className="mt-2 space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className="text-sm tracking-[0.14em] text-muted uppercase">Score</span>
                          <input
                            className={inputClass + " mt-1 w-full"}
                            value={card.score}
                            maxLength={40}
                            onChange={(e) => patch(card.key, { score: e.target.value })}
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm tracking-[0.14em] text-muted uppercase">Triage</span>
                          <input
                            className={inputClass + " mt-1 w-full"}
                            value={card.triage}
                            maxLength={40}
                            onChange={(e) => patch(card.key, { triage: e.target.value })}
                          />
                        </label>
                      </div>
                      <label className="block">
                        <span className="text-sm tracking-[0.14em] text-muted uppercase">
                          Reporter next step
                        </span>
                        <textarea
                          className={areaClass + " mt-1 w-full"}
                          rows={2}
                          value={card.reporterNextStep}
                          onChange={(e) => patch(card.key, { reporterNextStep: e.target.value })}
                        />
                      </label>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1 h-5 w-5"
                          checked={card.hold}
                          onChange={(e) => patch(card.key, { hold: e.target.checked })}
                        />
                        <span>
                          Hold this on the desk
                          <span className="block text-sm text-muted">
                            It goes to the Queue with a Hold flag, and cannot be published until you take the
                            hold off.
                          </span>
                        </span>
                      </label>
                    </div>
                  </details>

                  {problems.length > 0 ? (
                    <ul className="mt-3 list-disc pl-5 text-sm text-rust">
                      {problems.map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  ) : null}
                  {problems.length === 0 && card.include ? (
                    <p className="mt-3 text-sm text-muted">Ready to import.</p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
            <InkButton
              tone="solid"
              onClick={() => runImport.mutate()}
              disabled={runImport.isPending || ready.length === 0}
            >
              {runImport.isPending ? "Importing…" : importLabel}
            </InkButton>
            <span role="status" aria-live="polite" className="text-sm text-muted">
              {ready.length === 0
                ? ticked.length === 0
                  ? "Tick at least one story or idea to import."
                  : "Something below needs fixing before these can be imported."
                : readyIdeas === 0
                  ? `${ready.length} ready. They go in as drafts, marked Imported, and nothing is published.`
                  : readyStories === 0
                    ? `${ready.length} ready. They go on the Queue as story ideas, marked Imported, for someone to write. Nothing is published.`
                    : `${readyStories} ready as drafts and ${readyIdeas} as story ideas, marked Imported. Nothing is published.`}
            </span>
          </div>
        </section>
      ) : null}

      {done ? (
        <section className="mt-10 max-w-3xl border-2 border-ink p-4">
          <SecHead
            title="In the Queue"
            count={done.imported.length}
            aside={
              <Link to="/desk/queue" className="btn quiet small">
                Open the Queue
              </Link>
            }
            sub={
              done.imported.every((i) => i.kind === "idea")
                ? "Each one is a lead on the Queue with the description you pasted as its why and its sources attached, waiting for someone to write. Nothing is published."
                : done.imported.some((i) => i.kind === "idea")
                  ? "Each finished story is a draft holding the text exactly as you pasted it; each story idea is a lead waiting to be written. All of them are marked Imported, and nothing is published."
                  : "Each one is a draft with its own lead, with the text exactly as you pasted it and its sources attached. Nothing is published."
            }
          />
          <ul className="mt-3 list-disc pl-5 text-sm">
            {done.imported.map((item, index) => (
              <li key={`${item.headline}-${index}`}>
                {item.headline}
                {item.kind === "idea" ? " — a story idea, on the Queue to write" : ""}
              </li>
            ))}
          </ul>
          {done.refused.length > 0 ? (
            <div className="mt-3 text-sm text-rust">
              <p>These were not imported, because the text did not match your paste:</p>
              <ul className="mt-1 list-disc pl-5">
                {done.refused.map((r) => (
                  <li key={r.headline}>
                    {r.headline || "Untitled"} — {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </DeskShell>
  );
}

/** The first line that says anything, for naming the tool when there is no title. */
function firstLineOf(text: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*$/m.exec(text);
  if (heading) return heading[1]!;
  return (text.split(/\r?\n/).find((line) => line.trim()) ?? "").trim();
}
