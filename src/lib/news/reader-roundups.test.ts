import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRoutineRoundupChannel,
  latestRoundups,
  type RoundupCandidate,
} from "./reader-roundups.ts";

const row = (
  id: number,
  channel: string,
  publishedAt: string,
  overrides: Partial<RoundupCandidate> = {},
): RoundupCandidate => ({
  id,
  slug: `roundup-${id}`,
  headline: `Roundup ${id}`,
  dek: `Dek ${id}`,
  publishedAt,
  channel,
  ...overrides,
});

test("the routine-channel predicate accepts only the three published edition channels", () => {
  for (const channel of ["today", "weekend", "deadlines"]) {
    assert.equal(isRoutineRoundupChannel(channel), true);
  }
  for (const channel of ["news", "opinion", "", null, undefined, 1]) {
    assert.equal(isRoutineRoundupChannel(channel), false);
  }
});

test("roundups take the newest published story in each routine channel", () => {
  const chosen = latestRoundups([
    row(1, "today", "2026-10-20T12:00:00Z"),
    row(2, "today", "2026-10-30T12:00:00Z"),
    row(3, "weekend", "2026-10-25T12:00:00Z"),
    row(4, "weekend", "2026-10-27T12:00:00Z"),
    row(5, "deadlines", "2026-10-29T12:00:00Z"),
  ]);
  assert.deepEqual(
    chosen.map((roundup) => [roundup.channel, roundup.slug]),
    [
      ["today", "roundup-2"],
      ["weekend", "roundup-4"],
      ["deadlines", "roundup-5"],
    ],
  );
});

test("roundups ignore unknown channels, blank headlines, and a repeated story", () => {
  const chosen = latestRoundups([
    row(1, "news", "2026-10-30T12:00:00Z"),
    row(2, "today", "2026-10-30T12:00:00Z", { headline: "   " }),
    row(3, "today", "2026-10-29T12:00:00Z"),
    row(4, "weekend", "2026-10-31T12:00:00Z", { slug: "roundup-3" }),
    row(5, "deadlines", "2026-10-28T12:00:00Z"),
  ]);
  assert.deepEqual(
    chosen.map((roundup) => [roundup.channel, roundup.slug]),
    [
      ["today", "roundup-3"],
      ["deadlines", "roundup-5"],
    ],
  );
});

test("roundups never exceed one card per routine channel", () => {
  const chosen = latestRoundups([
    ...Array.from({ length: 5 }, (_, index) =>
      row(index + 1, "today", `2026-10-${String(20 + index).padStart(2, "0")}T12:00:00Z`),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      row(index + 6, "weekend", `2026-10-${String(20 + index).padStart(2, "0")}T12:00:00Z`),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      row(index + 11, "deadlines", `2026-10-${String(20 + index).padStart(2, "0")}T12:00:00Z`),
    ),
  ]);
  assert.equal(chosen.length, 3);
  assert.deepEqual(
    chosen.map((roundup) => roundup.channel),
    ["today", "weekend", "deadlines"],
  );
});
