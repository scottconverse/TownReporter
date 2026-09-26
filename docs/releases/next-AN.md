# TownReporter next patch — Unit AN, Google's YouTube data service (unreleased)

**State:** Candidate work in progress. This document does not assert a release,
tag, GitHub publication, production deployment, or a promoted candidate. The
version number is not bumped by this work. Nothing here has been run against
Google: every call in every test goes to a fake HTTP server, and no test in
this unit opened a socket to Google or to YouTube.

The desk learned about a channel's videos by scraping the channel tab HTML,
reading the public `videos.xml` feed, and — last resort — listing the channel
with yt-dlp. All three are unofficial and move when YouTube reshapes a page.
The owner's rule is "use the API, not scraping", so the documented YouTube Data
API v3 becomes the first choice and those three become the fallback.

## 1. The key lives in the desk, write-only

**Server → YouTube** (direct link `/desk/ops#youtube-key`) is a new settings
panel beside the other newsroom connections: one password-style box with
**Save key**, **Test**, and **Remove**, plus the line *A key is saved.* or
*No key.* and *YouTube units used today: N of 10,000*.

The key is encrypted with `encryptApiKey` from
`custom-ai-connections.server.ts` — the helper the custom AI connections
already use, AES-256-GCM under `BETTER_AUTH_SECRET`, stored as
`v1.<iv>.<tag>.<body>`. It is **write-only**: the server DTO carries
`hasKey`/`source`/`wording` and the key never leaves the server module, so no
control can re-display it. `YOUTUBE_API_KEY` in the app environment overrides a
saved key. Saving a new key also clears any recorded quota refusal, so last
week's refusal cannot keep the desk on the feed after the key was replaced.

The two tables (`youtube_api_settings`, `youtube_api_usage`) arrive as
`migrations/0096_youtube_data_api.sql`, additive, next free number. The day
columns are `text` holding the **Pacific** day, because a `date` column would
be read in whatever timezone the server runs in, and the whole point is to pin
the day Google resets on.

**Evidence:** `src/lib/news/youtube-data-api.test.ts` exit 0, 22/22, including
*keeps the key box write-only: state in, no key out* — which asserts the
returned state equals exactly `{hasKey, source, wording, unitsToday,
unitsLimit, quotaBlockedToday}`, that the stored column is ciphertext matching
`/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/` and does not contain
the plaintext, and that `YOUTUBE_API_KEY` wins over a stored key.

## 2. Discovery through the API, and it is never `search.list`

With a key set, a channel read is at most three calls, all costing 1 unit:

1. `channels.list?part=snippet,contentDetails` — by `id` when the configured
   URL carries `/channel/UC…`, otherwise by `forHandle` or `forUsername`, and
   the uploads playlist comes from `contentDetails.relatedPlaylists.uploads`.
2. `playlistItems.list?part=snippet,contentDetails` for the newest 50 uploads.
   Google's "Deleted video" / "Private video" placeholders are dropped.
3. `videos.list?part=snippet,contentDetails,liveStreamingDetails,status`,
   which supplies title, description, published, `contentDetails.duration`
   (ISO 8601), and live/upcoming state from `snippet.liveBroadcastContent` plus
   `liveStreamingDetails` — `upcoming`, `live`, `ended` (an `actualStartTime`
   with no live flag) or `vod`, with `scheduledStartTime` for a scheduled
   stream.

`search.list` is not called anywhere. It costs 100 units a call against a
10,000-unit day, and those three answer every question the desk asks.

Capture readiness now asks `videos.list` first — `upcoming` / `live` /
`ready` / `unknown` from the same fields — and falls through to the player page
and yt-dlp when Google answers `unknown`, which is what it says for a video it
has no duration for yet.

**Why the key is not in the URL.** It travels in the `x-goog-api-key` header,
so it cannot appear in a printed request, a redirect chain, a log line, or the
text of a thrown error.

**Evidence:** the same file, exit 0, 22/22 — *finds a channel by handle, then
lists and details its newest uploads* (three hits, correct endpoints, correct
params), *maps upcoming, live and ready state straight to what capture can do*,
and *never lets the key appear in a reply, a URL, a log line or an error*,
which runs a hostile Google that quotes the key back in its error body and then
asserts on the joined replies, on captured console output, and on every
recorded request URL: the key is in the `x-goog-api-key` header of all of them
and in no URL, no reply and no log line. Red first: making
`classifyYouTubeApiFailure` return Google's own message instead of the desk's
wording took the file to `exit 1`, 2 failed — one of them *no reply may carry
the key* — and was reverted.

## 3. No key, a bad key, a dead network, a spent allowance — all fall back

`listChannelVideosDetailed` returns the videos **and** the path that produced
them. With the API answering, the channel tab HTML, the RSS feed and the yt-dlp
listing are all skipped; for no key, a refused key, a network failure, an
unreadable reply, or an exceeded allowance, today's path runs unchanged.

The scan receipt says which ran — *Read YouTube with the official API.* or
*… Read the public feed instead.*, or *No YouTube key; read the public feed.* —
and the Meeting capture coverage line carries *read with the official API* /
*read from the public feed* / both, so a thin listing is never left implying
that Google answered.

**Quota is terminal for the Pacific day.** A `quotaExceeded` refusal is written
as today's Pacific day, and the desk answers from the feed without calling
Google again that day — no retry loop against a service that will refuse it. Two
other gates hold before any call: no key at all, and today's tally already at
10,000 units. All three reset by the Pacific day rolling over, not by a timer.

**Evidence:** the same file, exit 0, 22/22 — *stops asking for the rest of the
Pacific day after a quota refusal* (one hit, then `reason: "blocked"` with
`hits.length === 1`, then a full three-call read on the next Pacific day),
*refuses to call Google once today's 10,000 units are spent* (`hits.length ===
0`, the ceiling enforced before the call), *answers a bad key with Google's
plain words and falls back to the feed*, *says there is no key rather than
reaching Google without one*, and *says nothing to test with when there is no
key and none was typed*. Red first: neutering the ceiling check took the file to
`exit 1`, 1 failed — *refuses to call Google once today's 10,000 units are
spent* — and was reverted. `src/lib/news/youtube.test.ts` with
`ingest.test.ts` exit 0, 40 tests in 16 suites, 0 fail, so the existing feed
path is untouched.

## 4. Transcripts and media are unchanged

yt-dlp and textflowkit still fetch captions and audio. The API cannot download
captions for videos this desk does not own, so nothing about capture moves —
only the listing and the readiness question do.

**Evidence:** the meeting-capture suites — `meeting-capture*.test.ts` exit 0,
54 tests in 20 suites, 0 fail; `meeting-capture.test.ts` `meeting-capture-config`
`-info` `-caps` `-lead-wiring`, `meeting-activity.test.ts` and
`meeting-settings.test.ts` in one run, exit 0, 40 tests in 16 suites, 0 fail.

## 5. The checks

- `npx tsc --noEmit` — exit 0.
- `npm run typecheck:test` — exit 0.
- ESLint on every changed code file — exit 0. (The first run reported one
  `react-refresh/only-export-components` warning in `src/components/youtube-key.tsx`
  for two exports no other module imports; both were made module-private, which
  is what the sibling settings components do, and the re-run is clean.)
- `node scripts/with-app-env.mjs node --experimental-strip-types --test
  src/lib/news/youtube-data-api.test.ts` — exit 0, 22/22.
- `node --test --test-concurrency=1 "scripts/**/*.test.mjs"` — exit 0, 520
  tests, 517 pass, 3 skipped (pre-existing platform skips), 0 fail.
- `docs/editor.md` gained the setup steps (where the key goes, how to make it,
  what Test costs, what changes and what does not); the Server panel list in it
  was corrected from "nine panels" to the twelve the page actually shows.

**What is not proved here.** No call was made to the real Google API or to
YouTube from any test or script — every one goes through
`setYouTubeTransportForTests`, which replaces the transport wholesale, so the
SSRF-guarded client is out of the path in tests. A real key has not been saved
and a real channel has not been read: the owner is making the key, and the
first honest test of it is the **Test** button against Google. The quota path is
proved against fixture bodies, not against a real `quotaExceeded`.

The fake Google is a function installed in place of the transport, answering
with `Response` objects — the same seam `ai.test.ts` fakes LM Studio with, not
a listening HTTP server. That is the stricter of the two here: every request
URL and every header is recorded, so the key-leak assertions are made against
what was actually sent. What it does not exercise is DNS, TLS, and HTTP
redirects, which no unit test in this repository reaches for any provider.

One deliberate behaviour worth naming: **Test** always asks Google, even on a
day already refused for quota, because a person pressing it is asking a direct
question and gets the quota sentence as its answer. It is not the automatic
retry the once-a-day rule is about — and its unit is counted like any other.
