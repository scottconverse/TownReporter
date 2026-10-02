import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import {
  UNGROUNDED_MARKER,
  groundedHeadline,
  markedSpecifics,
  stripUngroundedNotes,
} from "./dark-specific-grounding.ts";
import { ensureDarkSchema, queueInvestigationFor, sendDarkSignalToQueueFor } from "./dark.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

// The handoff writes a `leads` row, and that table comes from the migrations,
// not from a runtime ensure-helper. The default suite gets them from the
// preload; the real-Postgres lane runs this file without it, so the fixture
// asks for them itself (the same way `dark-grounding-audit.test.ts` does).
await applyMigrationsToTestPglite();

/**
 * N3 of the batch-7 re-audit: THE MARKER NEVER LEAVES THE DARK DESK.
 *
 * The marker is `markUngroundedSpecifics`' one sentence to an editor reading
 * the Dark Desk: "no capture in this file carries this". M1 started putting it
 * on a signal's `name`, which was right -- the name is model prose like every
 * other field of the row -- but the name is also what the handoff writes as
 * `leads.headline`, so the marker walked out of the Dark Desk and into the
 * Queue, where the Draft button, the duplicate check and the story page all
 * start from it. The rule this file pins is the containment claim the desk's
 * own screens depend on: no lead, no draft, no story, no published page can
 * ever show it. The editor still sees what the model was reaching for -- as a
 * sentence in the lead's notes, which is where a note belongs.
 *
 * THE MUTATION THAT MATTERS: replace the headline's `groundedHeadline(...)`
 * with `storableText(sig.name)` in `sendDarkSignalToQueueFor` -- the line this
 * unit exists for -- and "gives the lead a headline with no marker in it"
 * fails, carrying the invented address and the marker into the Queue.
 */

const ROOM = 91092;
const INVENTED = "1749 Main Street";
/** What `synthesizeSignals` writes for a signal that named an uncaptured address. */
const MARKED_NAME = `Operator transition at ${INVENTED} ${UNGROUNDED_MARKER}`;

const CAPTURE =
  "COLORADO SHINES PROGRAM DETAIL — Kid City USA Longmont. " +
  "1941 Terry St, Longmont, CO 80501. A license was recommended for probation.";

async function bootFile(user: string, title: string) {
  await ensureDarkSchema();
  await ensureInvestigateSchema();
  const sql = await getSql();
  const [inv] = await sql<{ id: number }>`
    insert into investigations (user_id, newsroom_id, title)
    values (${user}, ${ROOM}, ${title}) returning id
  `;
  await sql`
    insert into artifacts
      (user_id, investigation_id, newsroom_id, url, title, content_hash, full_text, classification, fetch_status)
    values (
      ${user}, ${inv!.id}, ${ROOM}, ${"https://fixture.example/shines"}, ${"Colorado Shines"},
      ${`hash-${user}`}, ${CAPTURE}, ${"discovered"}, ${200}
    )
  `;
  const [run] = await sql<{ id: number }>`
    insert into dark_runs (user_id, newsroom_id) values (${user}, ${ROOM}) returning id
  `;
  return { sql, invId: inv!.id, runId: run!.id };
}

/** One signal row, written exactly the way the synthesis pass writes it. */
async function fileSignal(
  user: string,
  invId: number,
  runId: number,
  name: string,
  observation: string,
) {
  const sql = await getSql();
  const [sig] = await sql<{ id: number }>`
    insert into dark_signals
      (user_id, newsroom_id, run_id, investigation_id, name, posture, signal_type, strength,
       confidence, observation, pattern, linkage_map, alternatives, counter_narrative,
       what_would_kill, pathway, privacy_review, handoff, stage, verification_status)
    values (
      ${user}, ${ROOM}, ${runId}, ${invId}, ${name}, ${"whisper"}, ${"records"}, ${8},
      ${0.4}, ${observation}, ${"One parcel, two operators"}, ${""}, ${"A routine sale"},
      ${`The lease at ${INVENTED} ${UNGROUNDED_MARKER} ended.`},
      ${"The deed"}, ${"Ask the clerk"}, ${"Public record"}, ${"HOLD FOR PATTERN"},
      ${"black-desk"}, ${"unverified"}
    )
    returning id
  `;
  return sig!.id;
}

async function cleanUp(user: string, invId: number, runId: number) {
  const sql = await getSql();
  await sql`delete from leads where investigation_id = ${invId}`;
  await sql`delete from dark_signals where run_id = ${runId}`;
  await sql`delete from dark_runs where id = ${runId}`;
  await sql`delete from artifacts where investigation_id = ${invId}`;
  await sql`delete from investigations where id = ${invId}`;
}

/** Every place the marker must never be found, after a handoff has run. */
async function markerRows() {
  const sql = await getSql();
  const needle = `%${UNGROUNDED_MARKER}%`;
  const [leads] = await sql<{ n: number }>`
    select count(*)::int as n from leads
    where headline like ${needle} or why like ${needle} or evidence like ${needle}
      or coalesce(notes_json, '') like ${needle}
  `;
  const [drafts] = await sql<{ n: number }>`
    select count(*)::int as n from drafts
    where headline like ${needle} or dek like ${needle} or body like ${needle}
  `;
  const [articles] = await sql<{ n: number }>`
    select count(*)::int as n from articles
    where headline like ${needle} or dek like ${needle} or body like ${needle}
  `;
  return (leads?.n ?? 0) + (drafts?.n ?? 0) + (articles?.n ?? 0);
}

describe("N3 — the marker never leaves the Dark Desk", () => {
  it("gives the lead a headline with no marker and no invented address", async () => {
    const user = `n3-headline-${Date.now()}`;
    const { sql, invId, runId } = await bootFile(user, "Kid City USA Longmont closing");
    const signalId = await fileSignal(
      user,
      invId,
      runId,
      MARKED_NAME,
      `The facility at ${INVENTED} ${UNGROUNDED_MARKER} changed hands.`,
    );

    const sent = await sendDarkSignalToQueueFor(user, ROOM, signalId);
    assert.equal(sent.ok, true);
    const [lead] = await sql<{ headline: string; why: string; evidence: string }>`
      select headline, why, evidence from leads where id = ${(sent as { leadId: number }).leadId}
    `;
    assert.equal(
      lead!.headline.includes(UNGROUNDED_MARKER),
      false,
      `the marker reached a lead headline: ${lead!.headline}`,
    );
    assert.equal(lead!.headline.includes("1749"), false, `the invented address reached a headline: ${lead!.headline}`);
    // The remainder is what the model said around the invention, tidied -- not
    // a sentence with a hole in it and not an empty string.
    assert.equal(lead!.headline, "Operator transition");
    await cleanUp(user, invId, runId);
  });

  it("hands the editor the ungrounded specific as a note instead", async () => {
    const user = `n3-notes-${Date.now()}`;
    const { sql, invId, runId } = await bootFile(user, "Kid City USA Longmont closing");
    const signalId = await fileSignal(
      user,
      invId,
      runId,
      MARKED_NAME,
      `The facility at ${INVENTED} ${UNGROUNDED_MARKER} changed hands.`,
    );
    const sent = await sendDarkSignalToQueueFor(user, ROOM, signalId);
    const [lead] = await sql<{ why: string; evidence: string }>`
      select why, evidence from leads where id = ${(sent as { leadId: number }).leadId}
    `;
    assert.match(
      lead!.why,
      new RegExp(`Unconfirmed, not in any capture: ${INVENTED}`),
      `the notes do not say what was dropped: ${lead!.why.slice(0, 400)}`,
    );
    // The note is the ONE place the address may appear, and it appears there
    // without the marker's own wording.
    assert.equal(lead!.why.includes(UNGROUNDED_MARKER), false);
    assert.equal(lead!.evidence.includes(INVENTED), false, "the evidence column kept the invention");
    await cleanUp(user, invId, runId);
  });

  it("falls back to the file's own title when the name was only the invention", async () => {
    const user = `n3-fallback-${Date.now()}`;
    const { sql, invId, runId } = await bootFile(user, "Kid City USA Longmont closing");
    const signalId = await fileSignal(
      user,
      invId,
      runId,
      `${INVENTED} ${UNGROUNDED_MARKER}`,
      "The lease changed hands.",
    );
    const sent = await sendDarkSignalToQueueFor(user, ROOM, signalId);
    const [lead] = await sql<{ headline: string }>`
      select headline from leads where id = ${(sent as { leadId: number }).leadId}
    `;
    assert.equal(lead!.headline, "Kid City USA Longmont closing");
    await cleanUp(user, invId, runId);
  });

  it("keeps the whole-file handoff clean too", async () => {
    const user = `n3-file-${Date.now()}`;
    const { sql, invId, runId } = await bootFile(user, "Kid City USA Longmont closing");
    await fileSignal(
      user,
      invId,
      runId,
      MARKED_NAME,
      `The facility at ${INVENTED} ${UNGROUNDED_MARKER} changed hands.`,
    );
    const sent = await queueInvestigationFor(user, ROOM, invId);
    assert.equal(sent.ok, true);
    const [lead] = await sql<{ headline: string; why: string; evidence: string }>`
      select headline, why, evidence from leads where id = ${(sent as { leadId: number }).leadId}
    `;
    assert.equal(lead!.headline.includes(UNGROUNDED_MARKER), false, lead!.headline);
    assert.equal(lead!.why.includes(UNGROUNDED_MARKER), false, "the notes carried the marker");
    assert.equal(lead!.evidence.includes(UNGROUNDED_MARKER), false, "the evidence carried the marker");
    assert.match(lead!.why, /Unconfirmed, not in any capture: .*1749 Main Street/);
    assert.equal(await markerRows(), 0, "the marker reached a lead, a draft or a story");
    await cleanUp(user, invId, runId);
  });

  it("can only be written by the grounding rule's own module", async () => {
    /*
      The containment half of the guard, and the reason it is a source sweep
      rather than more fixtures: a behavioural test can only cover the handoffs
      someone thought to exercise. The marker's exact wording lives in ONE
      module, and every writer of a lead, a draft or a story that can receive
      model prose already imports its strippers -- so a later author adding a
      fourth handoff cannot acquire the marker by accident, only by printing the
      literal into a new module, which this fails on.
    */
    const root = new URL("../", import.meta.url);
    const files: string[] = [];
    const walk = async (dir: URL) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
        if (entry.isDirectory()) await walk(child);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(fileURLToPath(child));
      }
    };
    await walk(root);
    assert.ok(files.length > 100, `the sweep found almost nothing: ${files.length} files`);
    const owners: string[] = [];
    for (const file of files) {
      // Comments are read by people, not by a renderer: the sentence is quoted
      // in prose in two modules that must never print it.
      const source = (await readFile(file, "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");
      if (source.includes(UNGROUNDED_MARKER)) owners.push(file.replace(/\\/g, "/").split("/src/")[1]!);
    }
    assert.deepEqual(
      owners,
      ["lib/news/dark-specific-grounding.ts"],
      "the marker's wording is written in more than one module",
    );
  });

  it("reads a headline out of a marked name the way the handoff does", () => {
    // The pure rule the handoff leans on, pinned here as well as through PGlite.
    assert.equal(groundedHeadline(MARKED_NAME), "Operator transition");
    assert.equal(groundedHeadline(`${INVENTED} ${UNGROUNDED_MARKER}`), "");
    assert.equal(groundedHeadline("Zoning Variance Pattern"), "Zoning Variance Pattern");
    assert.equal(groundedHeadline(`The lease at ${INVENTED} ${UNGROUNDED_MARKER} ended`), "The lease");
    assert.deepEqual(markedSpecifics(MARKED_NAME), [INVENTED]);
    /*
      The name a column cut in half: `dark_signals.name` is sliced to 200
      characters, so a marker near the end can be truncated to "(not in a".
      The fragment goes AND so does the specific it was attached to -- nothing
      left in the text says the address was ever doubted, so leaving it would
      be the marker's job done by nobody.
    */
    const cut = `Operator transition at ${INVENTED} (not in a`;
    assert.equal(stripUngroundedNotes(cut), `Operator transition at ${INVENTED} `);
    assert.equal(groundedHeadline(cut), "Operator transition");
    assert.equal(
      stripUngroundedNotes(`The lease at ${INVENTED} ${UNGROUNDED_MARKER} ended`),
      "The lease at  ended",
    );
  });
});
