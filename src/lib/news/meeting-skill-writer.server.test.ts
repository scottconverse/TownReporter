import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { pruneOldMeetingRunFolders, runMeetingSkillWriter, type MeetingSkillWriterRunner } from "./meeting-skill-writer.server.ts";

/*
  THE RUN AROUND THE WRITER. The agent itself is faked here: what is under test
  is the folder the run is given, the transcript it is handed, and how its
  answers are read back. The real model path is proved by the runner's own
  tests; a nine-minute, login-holding agent call is not something a unit test
  should start.

  The story the fake writes is the real proof run's output (Longmont council,
  Oct. 20 2026), because the parser has to survive a document a model actually
  produced, not a shape this test invented.
*/

await applyMigrationsToTestPglite();

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKILL_DIR = join(REPO, "report-local-news");
const PROOF_STORY = readFileSync(
  join(REPO, "src/lib/news/fixtures/meeting-skill-writer/story-longmont-1020.txt"),
  "utf8",
);

const NEWSROOM = 942;
const VIDEO = "mskillVid01";
const PACKET_URL = "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=9&compileOutputType=1";

let artifactId = 0;
let storageRoot = "";

before(async () => {
  const sql = await getSql();
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict (id) do nothing", [
    NEWSROOM,
    "meeting skill writer test room",
  ]);
  storageRoot = mkdtempSync(join(tmpdir(), "mskill-root-"));
  await sql.query(
    `insert into meeting_capture_settings(newsroom_id,storage_root)
     values($1,$2)
     on conflict (newsroom_id) do update set storage_root=excluded.storage_root`,
    [NEWSROOM, storageRoot],
  );
  const transcriptFile = join(storageRoot, "mskill.vtt");
  writeFileSync(transcriptFile, "WEBVTT\n\n00:00.000 --> 00:00.19\nThank you.\n");
  const artifacts = await sql.query<{ id: number }>(
    `insert into meeting_transcript_artifacts
       (newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (newsroom_id,video_id,artifact_type,sha256) where artifact_type='transcript' do update set updated_at=now()
     returning id`,
    [NEWSROOM, VIDEO, transcriptFile, "vtt", "mskillsha", "captions", "transcript-only"],
  );
  artifactId = Number(artifacts[0]!.id);
  await sql.query(
    `insert into meeting_transcript_segments
       (artifact_id,segment_index,start_seconds,end_seconds,item,excerpt,caption_sha256)
     values ($1,0,19,25,null,$2,'s0'), ($1,1,20287,20290,null,$3,'s1')
     on conflict (artifact_id,segment_index) do nothing`,
    [artifactId, "Thank you.", "Motion carries, seven to zero."],
  );
});

/** A run that writes what the real agent writes, then reports success. */
function writingRunner(files: Record<string, string>, durationMs = 1234): MeetingSkillWriterRunner {
  return async ({ workDir, onEvent }) => {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(workDir, name), body, "utf8");
    onEvent?.("Wrote story.txt");
    return { ok: true, exitCode: 0, timedOut: false, durationMs, lastText: "RUN-DONE" };
  };
}

const BASE = {
  newsroomId: NEWSROOM,
  jobId: 7,
  artifactId: 0,
  videoId: VIDEO,
  title: "Longmont City Council Regular Session",
  meetingDate: "October 20, 2026",
  model: "deepseek-v4.1-flash:1017-cloud",
  today: "Wednesday, Oct. 21, 2026",
  env: { TOWNREPORTER_REPORT_LOCAL_NEWS_DIR: SKILL_DIR, TOWNREPORTER_DATA_ROOT: "" },
};

describe("runMeetingSkillWriter", () => {
  it("prepares the run folder, reads the story back, and keeps the transcript", async () => {
    const sql = await getSql();
    const stages: string[] = [];
    const result = await runMeetingSkillWriter({
      ...BASE,
      sql,
      artifactId,
      onStage: (text) => stages.push(text),
      packetUrlForMeeting: async () => PACKET_URL,
      run: writingRunner({
        "story.txt": PROOF_STORY,
        "CHECK-FIRST.txt": ["Check the $36.3 million figure against the packet.", "- The mural square footage."].join("\n"),
        "RUN-NOTES.md": "Opened the portal.\nRUN-DONE\n",
      }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // The story split: headline, dek, the publish block, then the editor's file.
    assert.equal(result.headline, "Longmont adds $36.3 million to 1st and Main transit center");
    assert.match(result.dek, /^The council also approved a development agreement/);
    assert.match(result.body, /ALSO AT THE MEETING/);
    // D217: the claims list is the editor's, and the body closes with one
    // sources line instead.
    assert.equal(result.body.includes("CLAIMS AND SOURCES"), false);
    assert.equal(result.body.includes("EDITOR FILE: NOT FOR PUBLICATION"), false);
    assert.equal(
      result.body.endsWith(
        `Sources: [Oct. 20, 2026 meeting video](https://www.youtube.com/watch?v=${VIDEO}) and [council packet](${PACKET_URL}).`,
      ),
      true,
    );
    assert.match(result.editorFile, /^EDITOR FILE: NOT FOR PUBLICATION/);
    assert.match(result.editorFile, /MEETING LEDGER/);
    // Nothing the skill wrote is lost: the claims block rides in the editor file.
    assert.match(result.editorFile, /CLAIMS AND SOURCES/);
    assert.match(result.claims, /^CLAIMS AND SOURCES/);
    assert.deepEqual(result.checks, [
      "Check the $36.3 million figure against the packet.",
      "The mural square footage.",
    ]);
    assert.equal(result.skillVersion, "3.1");
    assert.equal(result.durationMs, 1234);
    assert.match(result.runNotes, /RUN-DONE/);
    assert.deepEqual(stages, ["Wrote story.txt"]);

    // The folder is new for this run, under the newsroom's meeting storage root.
    assert.equal(dirname(result.workDir), join(storageRoot, "meeting-runs", `newsroom-${NEWSROOM}`));
    assert.match(basename(result.workDir), /^job-7-/);
    // The agent's instructions travelled with the run.
    assert.equal(readFileSync(join(result.workDir, "SKILL.md"), "utf8").length, 117_849);
    assert.match(readFileSync(join(result.workDir, "scripts", "audit.py"), "utf8"), /^#!\/usr\/bin\/env python3/);

    // The transcript it read: a header naming the meeting and its scope, then
    // one line per caption with an unpadded hour.
    const transcript = readFileSync(join(result.workDir, "transcript.txt"), "utf8").split("\n");
    assert.equal(
      transcript[0],
      "Longmont City Council Regular Session - October 20, 2026. YouTube mskillVid01. Full captions, 2 lines, 0:00:19 to 5:38:07.",
    );
    assert.equal(transcript[1], "");
    assert.equal(transcript[2], "0:00:19  Thank you.");
    assert.equal(transcript[3], "5:38:07  Motion carries, seven to zero.");
  });

  it("closes on a bare council packet when the packet lookup fails", async () => {
    const sql = await getSql();
    const result = await runMeetingSkillWriter({
      ...BASE,
      sql,
      artifactId,
      jobId: 10,
      run: writingRunner({ "story.txt": PROOF_STORY }),
      packetUrlForMeeting: async () => {
        throw new Error("the portal refused the read");
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.body.endsWith(`Sources: [Oct. 20, 2026 meeting video](https://www.youtube.com/watch?v=${VIDEO}) and council packet.`),
      true,
    );
    assert.equal(result.body.includes("primegov"), false);
  });

  it("gives a reused job id a new folder, and never reads the older run's files (D205)", async () => {
    const sql = await getSql();
    const first = await runMeetingSkillWriter({
      ...BASE,
      sql,
      artifactId,
      jobId: 12,
      packetUrlForMeeting: async () => PACKET_URL,
      run: writingRunner({
        "story.txt": PROOF_STORY,
        "CHECK-FIRST.txt": "Check the mural square footage.\n",
        "RUN-NOTES.md": "first run\n",
      }),
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    // The same job id again, as after a database restore that reuses ids. This
    // writer writes nothing, so anything it reads must come from its own folder.
    const second = await runMeetingSkillWriter({
      ...BASE,
      sql,
      artifactId,
      jobId: 12,
      packetUrlForMeeting: async () => PACKET_URL,
      run: writingRunner({}),
    });
    assert.notEqual(second.workDir, first.workDir);
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.error, "The writer finished without a story.");
    // The first run's folder is kept exactly as it was.
    assert.equal(readFileSync(join(first.workDir, "story.txt"), "utf8"), PROOF_STORY);
  });

  it("says meeting packet for a body that is not the council", async () => {
    const sql = await getSql();
    const result = await runMeetingSkillWriter({
      ...BASE,
      sql,
      artifactId,
      jobId: 11,
      title: "Longmont Planning and Zoning Commission",
      run: writingRunner({ "story.txt": PROOF_STORY }),
      packetUrlForMeeting: async () => PACKET_URL,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.includes("[meeting packet]("), true);
    assert.equal(result.body.includes("council packet"), false);
  });

  it("fails with a plain sentence when the writer writes no story", async () => {
    const sql = await getSql();
    const result = await runMeetingSkillWriter({
      ...BASE,
      sql,
      artifactId,
      jobId: 8,
      run: writingRunner({}),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "The writer finished without a story.");
  });

  it("stops before the agent starts when the meeting has no captions", async () => {
    const sql = await getSql();
    let called = false;
    const result = await runMeetingSkillWriter({
      ...BASE,
      sql,
      artifactId: 987_654,
      jobId: 9,
      run: async () => {
        called = true;
        return { ok: true, exitCode: 0, timedOut: false, durationMs: 1 };
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /no stored captions/i);
    assert.equal(called, false);
  });
});

describe("old run folders (G24-T3-1)", () => {
  const DAY = 86_400_000;
  const aged = (path: string, days: number) => {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "story.txt"), "x", "utf8");
    const when = new Date(Date.now() - days * DAY);
    utimesSync(path, when, when);
  };

  it("removes run folders older than 14 days, keeps newer ones, and keeps one a saved draft points to", async () => {
    const sql = await getSql();
    const runsRoot = join(mkdtempSync(join(tmpdir(), "mskill-prune-")), "meeting-runs", `newsroom-${NEWSROOM}`);
    const oldFolder = join(runsRoot, "job-11-aB3dE9");
    const recentFolder = join(runsRoot, "job-12-zZ9yX8");
    const pointedTo = join(runsRoot, "job-13-Qw2eR5");
    const notARun = join(runsRoot, "important-notes");
    aged(oldFolder, 20);
    aged(recentFolder, 3);
    aged(pointedTo, 40);
    aged(notARun, 90);
    await sql.query(
      `insert into drafts (user_id, newsroom_id, headline, dek, body, topic, run_stats)
       values ($1,$2,'h','d','b','council',$3::jsonb)`,
      [`prune-test-${Math.random().toString(36).slice(2, 8)}`, NEWSROOM, JSON.stringify({ workDir: pointedTo })],
    );

    const result = await pruneOldMeetingRunFolders({ sql, runsRoot, log: () => {} });
    assert.deepEqual(result.deleted, [oldFolder]);
    assert.deepEqual(result.keptForRecords, [pointedTo]);
    assert.equal(existsSync(oldFolder), false);
    assert.equal(existsSync(recentFolder), true);
    assert.equal(existsSync(pointedTo), true);
    assert.equal(existsSync(notARun), true, "a folder that is not job-<id>-XXXXXX is never touched");
  });

  it("does not follow a link, and a failed cleanup never throws", async () => {
    const sql = await getSql();
    const base = mkdtempSync(join(tmpdir(), "mskill-prune-link-"));
    const runsRoot = join(base, "runs");
    const outside = join(base, "outside");
    aged(outside, 60);
    mkdirSync(runsRoot, { recursive: true });
    try {
      symlinkSync(outside, join(runsRoot, "job-14-Lk1nK2"), "junction");
    } catch {
      return; // links not allowed on this machine; nothing to prove
    }
    const logged: string[] = [];
    const result = await pruneOldMeetingRunFolders({ sql, runsRoot, log: (m) => logged.push(m) });
    assert.deepEqual(result.deleted, []);
    assert.equal(existsSync(join(outside, "story.txt")), true);

    // The saved records cannot be read: nothing is deleted, and nothing throws.
    const folder = join(runsRoot, "job-15-Br0ken");
    aged(folder, 30);
    const broken = { query: async () => { throw new Error("database is away"); } } as unknown as typeof sql;
    const second = await pruneOldMeetingRunFolders({ sql: broken, runsRoot, log: (m) => logged.push(m) });
    assert.deepEqual(second.deleted, []);
    assert.equal(existsSync(folder), true);
    assert.ok(logged.some((m) => /skipped/.test(m)));
  });
});
