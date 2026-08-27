import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeLiveStatus,
  extractChannelId,
  isMeetingTitle,
  isYoutubeChannel,
  parseChannelTabHtml,
  parseTranscriptPanel,
  pickMeetingVideos,
  sameMeeting,
  youtubeVideoId,
} from "./youtube.ts";

describe("youtube ids", () => {
  it("parses watch, short, and embed URLs", () => {
    assert.equal(youtubeVideoId(new URL("https://www.youtube.com/watch?v=zWIy2YeEmPE")), "zWIy2YeEmPE");
    assert.equal(youtubeVideoId(new URL("https://youtu.be/zWIy2YeEmPE")), "zWIy2YeEmPE");
    assert.equal(youtubeVideoId(new URL("https://www.youtube.com/embed/zWIy2YeEmPE")), "zWIy2YeEmPE");
    assert.equal(youtubeVideoId(new URL("https://www.youtube.com/live/zWIy2YeEmPE")), "zWIy2YeEmPE");
  });

  it("does not treat a channel as a video", () => {
    assert.equal(youtubeVideoId(new URL("https://www.youtube.com/@CityofLongmont")), null);
    assert.equal(isYoutubeChannel(new URL("https://www.youtube.com/@CityofLongmont")), true);
    assert.equal(isYoutubeChannel(new URL("https://www.youtube.com/watch?v=zWIy2YeEmPE")), false);
  });

  it("finds channel id from current YouTube HTML shapes", () => {
    const html = `"externalId":"UCH5_wkpLrKYb1JuUk6-UdNg","browseId":"UCH5_wkpLrKYb1JuUk6-UdNg"`;
    assert.equal(extractChannelId(html), "UCH5_wkpLrKYb1JuUk6-UdNg");
  });
});

describe("live status", () => {
  it("says there is no transcript when the stream has not started", () => {
    const got = describeLiveStatus({
      status: "LIVE_STREAM_OFFLINE",
      reason: "This live event will begin in 23 hours.",
      scheduled: "August 27 at 6:00 PM GMT-6",
      isLiveNow: false,
      isLiveContent: true,
      captions: "",
    });
    assert.equal(got.live, "upcoming");
    assert.match(got.note, /no transcript yet/i);
    assert.match(got.note, /August 27/);
  });
});

describe("parseTranscriptPanel", () => {
  it("keeps timestamps and drops YouTube chrome", () => {
    const out = parseTranscriptPanel(
      "Transcript Search transcript 0:02 2 seconds At this week's regular session, Longmont City Council will discuss the city council action plan. 0:10 10 seconds and board and commission feedback.",
    );
    assert.match(out, /Longmont City Council/);
    assert.match(out, /\[0:02\]/);
    assert.match(out, /\[0:10\]/);
    assert.doesNotMatch(out, /Search transcript/);
  });
});

describe("meeting filter", () => {
  it("keeps council and neighborhood meetings, drops TWIC promo", () => {
    assert.equal(isMeetingTitle("City Council Regular Session - 08/25/2026"), true);
    assert.equal(isMeetingTitle("206 S. Main Street Neighborhood Meeting"), true);
    assert.equal(isMeetingTitle("Water Board Meeting August 17, 2026"), true);
    assert.equal(isMeetingTitle("This Week in Council, Aug. 25, 2026"), false);
    const picked = pickMeetingVideos(
      [
        { title: "This Week in Council, Aug. 25, 2026", duration: 90 },
        { title: "City Council Regular Session - 08/25/2026", duration: 18000 },
        { title: "Pharaoh's #2 Neighborhood Meeting", duration: 1900 },
      ],
      8,
    );
    assert.equal(picked.length, 2);
    assert.equal(picked[0]!.title.includes("Council Regular"), true);
  });

  it("parses videoRenderer blocks from a channel tab", () => {
    const html = `videoRenderer{"videoId":"7OdoRvfRArI","title":{"runs":[{"text":"City Council Regular Session - 08/25/2026"}]},"lengthText":{"simpleText":"5:00:30"}}`;
    const rows = parseChannelTabHtml(html, "streams");
    assert.equal(rows[0]?.id, "7OdoRvfRArI");
    assert.match(rows[0]?.title ?? "", /City Council/);
    assert.equal(rows[0]?.duration, 5 * 3600 + 30);
  });
});

describe("same meeting across channels", () => {
  it("matches city and public-media titles, not two different council nights", () => {
    assert.equal(
      sameMeeting("City Council Regular Session - 08/25/2026", "City Council Regular Session 8/25/26"),
      true,
    );
    assert.equal(
      sameMeeting("City Council Regular Session - 08/25/2026", "City Council Regular Session - 08/11/2026"),
      false,
    );
    assert.equal(
      sameMeeting("206 S. Main Street Neighborhood Meeting", "VIRTUAL - Neighborhood Meeting Notice - Avis Car Rental, 206 S. Main St"),
      true,
    );
    assert.equal(
      sameMeeting("Pharaoh's #2 Neighborhood Meeting", "Pharoah's American Grill #2 Neighborhood Meeting"),
      true,
    );
    assert.equal(
      sameMeeting("Museum Advisory Board Meeting, June 17, 2026", "Museum Advisory Board - August 2026"),
      false,
    );
  });
});
