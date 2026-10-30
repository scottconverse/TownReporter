import assert from "node:assert/strict";
import test from "node:test";
import { routineAutomationInput } from "./request-input.ts";
import {
  DEFAULT_ROUTINE_NOTICE_SOURCE_LIMIT,
  MAX_ROUTINE_NOTICE_SOURCE_LIMIT,
  ROUTINE_NOTICE_SOURCE_LIMIT_ENV,
  routineNoticeSourceLimit,
} from "./routine-notice-source-limit.ts";

test("routine source limit defaults to 150 and malformed or out-of-range settings fall back", () => {
  const prior = process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV];
  try {
    delete process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV];
    assert.equal(DEFAULT_ROUTINE_NOTICE_SOURCE_LIMIT, 150);
    assert.equal(routineNoticeSourceLimit(), 150);
    for (const value of ["", "abc", "0", "-1", "1.5", "501"]) {
      process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV] = value;
      assert.equal(routineNoticeSourceLimit(), 150, `bad setting ${JSON.stringify(value)}`);
    }
    process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV] = "13";
    assert.equal(routineNoticeSourceLimit(), 13);
    process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV] = String(MAX_ROUTINE_NOTICE_SOURCE_LIMIT);
    assert.equal(routineNoticeSourceLimit(), MAX_ROUTINE_NOTICE_SOURCE_LIMIT);
  } finally {
    if (prior === undefined) delete process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV];
    else process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV] = prior;
  }
});

test("the default setting accepts thirteen routine sources and still bounds the list", () => {
  const prior = process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV];
  try {
    delete process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV];
    const input = (sources: unknown[]) => ({
      expectedRevision: 0,
      enabled: true,
      timezone: "America/Denver",
      localTime: "06:15",
      sections: {},
      sources,
    });
    const thirteen = Array.from({ length: 13 }, () => ({}));
    assert.equal(routineAutomationInput.safeParse(input(thirteen)).success, true);
    const oneTooMany = Array.from({ length: 151 }, () => ({}));
    assert.equal(routineAutomationInput.safeParse(input(oneTooMany)).success, false);
  } finally {
    if (prior === undefined) delete process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV];
    else process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV] = prior;
  }
});
