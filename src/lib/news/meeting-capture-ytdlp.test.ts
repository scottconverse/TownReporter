import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
  FEATURE-BACKLOG: yt-dlp player_client retry.

  When YouTube answers yt-dlp with its bot/sign-in challenge, the desk retries
  the same fetch with `--extractor-args youtube:player_client=<x>` for x in
  android_vr, then visionos, then tv_embedded, stopping at the first success.

  `runWithPlayerClientRetry` is the orchestration, kept independent of process
  spawning on purpose: real yt-dlp is a Python program, and this repo has no
  portable way to spawn a stand-in "python" that understands the real
  `-m yt_dlp ...` argv on every OS this suite runs on (media-tool-process.test.ts's
  "link node as python" trick only works because IT calls spawnMediaTool with a
  `-e <script>` argv it controls, not `-m yt_dlp`; Windows' node refuses `-m`
  outright: `node: bad option: -m`). So the fake yt-dlp here plays the same role
  a real spawned process would from `runWithPlayerClientRetry`'s point of view --
  an `attempt(argv) => Promise<{code, stdout, stderr, stopped}>` function -- and
  the assertions are on exactly what a real integration test would check: which
  argv got sent on each attempt, in what order, and when the loop does or does
  not continue.
*/

const CHALLENGE_STDERR = "ERROR: [youtube] abc123: Sign in to confirm you're not a bot";
const OTHER_CHALLENGE_PHRASING = "ERROR: [youtube] abc123: Please confirm you're not a bot to continue";
const NOT_A_CHALLENGE_STDERR = "ERROR: [youtube] abc123: Video unavailable";
const RATE_LIMIT_STDERR = "ERROR: HTTP Error 429: Too Many Requests";

function ok(stdout = ""): { code: number; stdout: string; stderr: string; stopped: boolean } {
  return { code: 0, stdout, stderr: "", stopped: false };
}
function fail(stderr: string): { code: number; stdout: string; stderr: string; stopped: boolean } {
  return { code: 1, stdout: "", stderr, stopped: false };
}

describe("looksLikeYoutubeBotChallenge", () => {
  it("recognizes both stated challenge phrasings", async () => {
    const { looksLikeYoutubeBotChallenge } = await import("./meeting-capture-ytdlp.ts");
    assert.ok(looksLikeYoutubeBotChallenge(CHALLENGE_STDERR));
    assert.ok(looksLikeYoutubeBotChallenge(OTHER_CHALLENGE_PHRASING));
    assert.ok(looksLikeYoutubeBotChallenge("confirm you're not a bot"));
    assert.ok(looksLikeYoutubeBotChallenge("CONFIRM YOU'RE NOT A BOT"));
  });

  it("does not treat an unrelated failure as the challenge", async () => {
    const { looksLikeYoutubeBotChallenge } = await import("./meeting-capture-ytdlp.ts");
    assert.equal(looksLikeYoutubeBotChallenge(NOT_A_CHALLENGE_STDERR), false);
    assert.equal(looksLikeYoutubeBotChallenge(RATE_LIMIT_STDERR), false);
    assert.equal(looksLikeYoutubeBotChallenge(""), false);
  });
});

describe("withPlayerClientArgs", () => {
  it("inserts --extractor-args right before the trailing URL", async () => {
    const { withPlayerClientArgs } = await import("./meeting-capture-ytdlp.ts");
    const base = ["-m", "yt_dlp", "--skip-download", "https://www.youtube.com/watch?v=abc123"];
    const withClient = withPlayerClientArgs(base, "android_vr");
    assert.deepEqual(withClient, [
      "-m",
      "yt_dlp",
      "--skip-download",
      "--extractor-args",
      "youtube:player_client=android_vr",
      "https://www.youtube.com/watch?v=abc123",
    ]);
    // The base argv itself is untouched.
    assert.deepEqual(base, ["-m", "yt_dlp", "--skip-download", "https://www.youtube.com/watch?v=abc123"]);
  });
});

describe("runWithPlayerClientRetry", () => {
  const baseArgv = ["-m", "yt_dlp", "--skip-download", "https://www.youtube.com/watch?v=abc123"];

  it("does not retry at all when the plain request succeeds", async () => {
    const { runWithPlayerClientRetry } = await import("./meeting-capture-ytdlp.ts");
    const calls: string[][] = [];
    const outcome = await runWithPlayerClientRetry(baseArgv, async (argv) => {
      calls.push(argv);
      return ok("captions written");
    });
    assert.equal(calls.length, 1, "only the plain request should run");
    assert.deepEqual(outcome.argv, baseArgv);
    assert.equal(outcome.playerClientUsed, null);
    assert.equal(outcome.result.code, 0);
  });

  it("fails with the challenge text on the plain request and the first two clients, succeeds on the third (tv_embedded)", async () => {
    const { runWithPlayerClientRetry } = await import("./meeting-capture-ytdlp.ts");
    const calls: string[][] = [];
    const outcome = await runWithPlayerClientRetry(baseArgv, async (argv) => {
      calls.push(argv);
      if (calls.length <= 3) return fail(CHALLENGE_STDERR); // plain, android_vr, visionos
      return ok("captions written"); // tv_embedded
    });
    assert.equal(calls.length, 4, "plain + 3 clients");
    assert.deepEqual(calls[0], baseArgv, "the first attempt is the plain request, no player_client override");
    assert.ok(
      calls[1]!.includes("--extractor-args") && calls[1]!.includes("youtube:player_client=android_vr"),
      "the first retry uses android_vr",
    );
    assert.ok(
      calls[2]!.includes("youtube:player_client=visionos"),
      "the second retry uses visionos",
    );
    assert.ok(
      calls[3]!.includes("youtube:player_client=tv_embedded"),
      "the third retry uses tv_embedded",
    );
    assert.equal(outcome.result.code, 0);
    assert.equal(outcome.playerClientUsed, "tv_embedded", "the client that actually succeeded is recorded");
    assert.deepEqual(outcome.argv, calls[3]);
  });

  it("does NOT retry a non-challenge failure on the plain request", async () => {
    const { runWithPlayerClientRetry } = await import("./meeting-capture-ytdlp.ts");
    const calls: string[][] = [];
    const outcome = await runWithPlayerClientRetry(baseArgv, async (argv) => {
      calls.push(argv);
      return fail(NOT_A_CHALLENGE_STDERR);
    });
    assert.equal(calls.length, 1, "a non-challenge failure must not trigger any retry");
    assert.equal(outcome.playerClientUsed, null);
    assert.equal(outcome.result.stderr, NOT_A_CHALLENGE_STDERR);
  });

  it("does NOT retry an HTTP 429 rate limit", async () => {
    const { runWithPlayerClientRetry } = await import("./meeting-capture-ytdlp.ts");
    const calls: string[][] = [];
    await runWithPlayerClientRetry(baseArgv, async (argv) => {
      calls.push(argv);
      return fail(RATE_LIMIT_STDERR);
    });
    assert.equal(calls.length, 1, "a rate limit is a paced retry elsewhere, not a player_client condition");
  });

  it("stops retrying as soon as a client returns a non-challenge failure", async () => {
    const { runWithPlayerClientRetry } = await import("./meeting-capture-ytdlp.ts");
    const calls: string[][] = [];
    const outcome = await runWithPlayerClientRetry(baseArgv, async (argv) => {
      calls.push(argv);
      if (calls.length === 1) return fail(CHALLENGE_STDERR); // plain: challenge
      if (calls.length === 2) return fail(NOT_A_CHALLENGE_STDERR); // android_vr: a real, different failure
      return ok(); // would succeed if reached, but must not be
    });
    assert.equal(calls.length, 2, "the loop must stop at the first non-challenge failure from a retry client");
    assert.equal(outcome.playerClientUsed, null);
  });

  it("exhausts all three clients and reports the last (still-challenged) failure when none succeed", async () => {
    const { runWithPlayerClientRetry } = await import("./meeting-capture-ytdlp.ts");
    const calls: string[][] = [];
    const outcome = await runWithPlayerClientRetry(baseArgv, async (argv) => {
      calls.push(argv);
      return fail(CHALLENGE_STDERR);
    });
    assert.equal(calls.length, 4, "plain + all 3 clients tried");
    assert.equal(outcome.playerClientUsed, null);
    assert.equal(outcome.result.code, 1);
    assert.ok(outcome.argv.includes("youtube:player_client=tv_embedded"));
  });

  it("does not retry when the run was stopped by the operator", async () => {
    const { runWithPlayerClientRetry } = await import("./meeting-capture-ytdlp.ts");
    const calls: string[][] = [];
    const outcome = await runWithPlayerClientRetry(baseArgv, async (argv) => {
      calls.push(argv);
      return { code: null, stdout: "", stderr: CHALLENGE_STDERR, stopped: true };
    });
    assert.equal(calls.length, 1, "an operator abort must not be retried as if it were a challenge");
    assert.equal(outcome.result.stopped, true);
    assert.equal(outcome.playerClientUsed, null);
  });
});

/*
  Source-wiring checks: `runWithPlayerClientRetry` is exercised directly above
  (fully, at the unit level). These confirm the two real capture entry points
  actually call it and thread `playerClientUsed` into their success result,
  rather than the retry helper sitting unused.
*/
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "meeting-capture-ytdlp.ts"), "utf8");

describe("player_client retry wiring", () => {
  it("captureMeetingCaptions and captureMeetingAudio both run their argv through the retry", () => {
    const captionsAt = source.indexOf("export async function captureMeetingCaptions");
    const audioAt = source.indexOf("export async function captureMeetingAudio");
    assert.ok(captionsAt >= 0 && audioAt > captionsAt);
    const captionsBody = source.slice(captionsAt, audioAt);
    const audioBody = source.slice(audioAt);
    for (const body of [captionsBody, audioBody]) {
      assert.match(body, /runWithPlayerClientRetry\(/);
      assert.match(body, /playerClientUsed/);
    }
  });
});
