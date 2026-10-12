import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchTranscriptOriginal,
  TRANSCRIPT_ORIGINAL_MISSING_MESSAGE,
} from "./meeting-transcript-view.ts";

/** A fetch that answers once with the given response, the way the download route would. */
function answering(response: Response): typeof fetch {
  return async () => response;
}

describe("transcript original download press (DHF-4, FC12)", () => {
  it("says the file is missing on the page when the route answers 404, instead of saving a broken file", async () => {
    const result = await fetchTranscriptOriginal(
      "/api/transcript-file?artifactId=6",
      answering(new Response(TRANSCRIPT_ORIGINAL_MISSING_MESSAGE, { status: 404 })),
    );
    assert.deepEqual(result, { ok: false, message: TRANSCRIPT_ORIGINAL_MISSING_MESSAGE });
  });

  it("shows the route's own words for any other refusal, never a success", async () => {
    const result = await fetchTranscriptOriginal(
      "/api/transcript-file?artifactId=7",
      answering(new Response("The stored transcript file no longer matches the hash recorded for artifact 7.", { status: 500 })),
    );
    assert.deepEqual(result, {
      ok: false,
      message: "The stored transcript file no longer matches the hash recorded for artifact 7.",
    });
  });

  it("hands back the bytes only when the route answers 200", async () => {
    const result = await fetchTranscriptOriginal(
      "/api/transcript-file?artifactId=4",
      answering(new Response("<timedtext>captions</timedtext>", { status: 200 })),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(await result.blob.text(), "<timedtext>captions</timedtext>");
  });

  it("says the file could not be reached when the request itself fails", async () => {
    const result = await fetchTranscriptOriginal("/api/transcript-file?artifactId=4", async () => {
      throw new TypeError("network down");
    });
    assert.deepEqual(result, { ok: false, message: "The original file could not be reached. Try again." });
  });
});
