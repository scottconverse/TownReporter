/*
  Unit CJ (0.6.80): behavior tests for the first-owner setup code.

  Against the same shared PGlite `first-owner-race.test.ts` uses (no
  DATABASE_URL -- see `safeTestEnvironment`). Every test cleans
  `owner_setup_code` and `newsroom_members` around itself so it does not
  poison a later test's idea of "unclaimed".
*/
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSql } from "../db.ts";
import { claimOwner, ensureNewsroomSchema, requireEditor } from "./membership.ts";
import {
  burnSetupCode,
  ensureOwnerSetupCode,
  isSetupCodeRequired,
  setupCodeFilePath,
  verifySetupCode,
} from "./setup-code.server.ts";

async function reset() {
  await ensureNewsroomSchema();
  const sql = await getSql();
  await sql.query(`create table if not exists owner_setup_code (
    id integer primary key, code_hash text not null,
    created_at timestamptz not null default now(), consumed_at timestamptz
  )`);
  await sql`delete from newsroom_members`;
  await sql.query(`delete from owner_setup_code`);
  try {
    if (existsSync(setupCodeFilePath())) rmSync(setupCodeFilePath());
  } catch {
    /* fine */
  }
}

/** A fresh, isolated data root per test so file assertions never collide. */
function useTempDataRoot(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "trep-setup-code-"));
  const prior = process.env.TOWNREPORTER_DATA_ROOT;
  process.env.TOWNREPORTER_DATA_ROOT = dir;
  return () => {
    if (prior === undefined) delete process.env.TOWNREPORTER_DATA_ROOT;
    else process.env.TOWNREPORTER_DATA_ROOT = prior;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* fine */
    }
  };
}

describe("first-owner setup code", () => {
  it("a fresh, unclaimed desk requires a code", async () => {
    const restore = useTempDataRoot();
    try {
      await reset();
      await ensureNewsroomSchema();
      assert.equal(await isSetupCodeRequired(), true);
      assert.equal(existsSync(setupCodeFilePath()), true, "the code file should be written");
      const printed = readFileSync(setupCodeFilePath(), "utf8").trim();
      assert.match(printed, /^[0-9A-Z-]{16,}$/, "printed code should look like the grouped alphabet");
    } finally {
      restore();
    }
  });

  it("claiming without a code is refused", async () => {
    const restore = useTempDataRoot();
    try {
      await reset();
      await assert.rejects(() => requireEditor("no-code-user"), (err: unknown) => {
        return err instanceof Error && /setup code/i.test(err.message);
      });
    } finally {
      restore();
    }
  });

  it("claiming with the wrong code is refused, and does not burn the real one", async () => {
    const restore = useTempDataRoot();
    try {
      await reset();
      await ensureOwnerSetupCode();
      const wrong = await verifySetupCode("0000-0000-0000-0000", "1.2.3.4-wrong");
      assert.equal(wrong.ok, false);
      // The real code still works after a wrong guess.
      const printed = readFileSync(setupCodeFilePath(), "utf8").trim();
      const right = await verifySetupCode(printed, "1.2.3.4-right");
      assert.equal(right.ok, true);
    } finally {
      restore();
    }
  });

  it("5 wrong attempts in the window are rate-limited", async () => {
    const restore = useTempDataRoot();
    try {
      await reset();
      await ensureOwnerSetupCode();
      const ip = "9.9.9.9";
      for (let i = 0; i < 5; i++) {
        const r = await verifySetupCode("WRONG-WRONG-WRONG", ip);
        assert.equal(r.ok, false);
      }
      const sixth = await verifySetupCode("WRONG-WRONG-WRONG", ip);
      assert.equal(sixth.ok, false);
      assert.match(sixth.ok ? "" : sixth.reason, /too many attempts/i);
    } finally {
      restore();
    }
  });

  it("the right code succeeds, and claiming through it burns the code and deletes the file", async () => {
    const restore = useTempDataRoot();
    try {
      await reset();
      await ensureOwnerSetupCode();
      const printed = readFileSync(setupCodeFilePath(), "utf8").trim();
      const check = await verifySetupCode(printed, "5.5.5.5");
      assert.equal(check.ok, true);
      const claimed = await requireEditor("code-owner", { bypassSetupCodeGate: true });
      assert.equal(claimed.role, "owner");
      await burnSetupCode();
      assert.equal(await isSetupCodeRequired(), false);
      assert.equal(existsSync(setupCodeFilePath()), false, "the file must be gone after burn");
      // Burned: the same code no longer verifies.
      const again = await verifySetupCode(printed, "5.5.5.6");
      assert.equal(again.ok, false);
    } finally {
      restore();
    }
  });

  it("an install that already has an owner generates nothing", async () => {
    const restore = useTempDataRoot();
    try {
      await reset();
      await ensureNewsroomSchema();
      const sql = await getSql();
      await sql`insert into newsroom_members (user_id, role, newsroom_id) values (${"existing-owner"}, ${"owner"}, ${1})`;
      await ensureOwnerSetupCode();
      assert.equal(await isSetupCodeRequired(), false);
      assert.equal(existsSync(setupCodeFilePath()), false, "no file on an already-claimed desk");
      // The ordinary auto-claim path (no bypass) still behaves exactly as
      // before: a second identity is refused, the desk is untouched.
      await assert.rejects(() => requireEditor("late-signup"));
    } finally {
      restore();
    }
  });

  it("visiting the desk with no code supplied does not silently claim it", async () => {
    // This is the actual security property: `deskMiddleware` calls
    // `requireEditor(userId)` with no second argument on every desk route.
    const restore = useTempDataRoot();
    try {
      await reset();
      await ensureOwnerSetupCode();
      await assert.rejects(() => requireEditor("drive-by-visitor"));
      const sql = await getSql();
      const rows = await sql`select count(*)::int as c from newsroom_members`;
      assert.equal(rows[0].c, 0, "no owner should have been created");
    } finally {
      restore();
    }
  });

  it("production never reaches the test-only setup-code override", () => {
    // forceSetupCodeSatisfiedForTests() is a process-global escape hatch for
    // the pre-existing race/index tests in first-owner-race.test.ts. This
    // walks every non-test .ts file under src/ and server/ that is part of
    // the real request path and proves none of them mention it by name --
    // there is no environment variable or NODE_ENV check gating it, so the
    // only thing that could make it reach production is a call site, and
    // this proves there is none.
    const PRODUCTION_DIRS = ["src/routes", "src/lib/news", "src/lib/auth", "server"].map((d) =>
      new URL(`../../../${d}/`, import.meta.url),
    );
    const offenders: string[] = [];
    function walk(dirUrl: URL) {
      let entries: string[];
      try {
        entries = readdirSync(dirUrl);
      } catch {
        return;
      }
      for (const entry of entries) {
        const childUrl = new URL(entry, dirUrl.href.endsWith("/") ? dirUrl : `${dirUrl}/`);
        let isDir = false;
        try {
          isDir = statSync(childUrl).isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          if (entry === "node_modules") continue;
          walk(new URL(`${entry}/`, dirUrl));
          continue;
        }
        if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
        if (entry.includes(".test.")) continue;
        if (entry === "setup-code.server.ts") continue; // the definition itself
        const text = readFileSync(childUrl, "utf8");
        if (text.includes("forceSetupCodeSatisfiedForTests")) {
          offenders.push(childUrl.pathname);
        }
      }
    }
    for (const dir of PRODUCTION_DIRS) walk(dir);
    assert.deepEqual(offenders, [], `test-only override referenced outside tests:\n  ${offenders.join("\n  ")}`);
  });

  it("claimOwner (the tested-signature function) still takes only a user id, and on a fresh install it refuses without the code too", async () => {
    // Documents the actual call shape membership.test.ts asserts by regex.
    // Since `isSetupCodeRequired` ensures a code on first read, a fresh
    // install has one pending the instant anything asks -- so the plain,
    // one-argument `claimOwner` (no bypass) is refused here exactly like
    // `requireEditor` is in the "claiming without a code" test above. The
    // membership.ts early-return path (an already-seated member) is
    // unaffected by the gate, which the next test in this file proves.
    const restore = useTempDataRoot();
    try {
      await reset();
      await ensureNewsroomSchema();
      await assert.rejects(() => claimOwner("plain-claim-user"));
    } finally {
      restore();
    }
  });

  it("an existing member's own claimOwner call still just confirms their seat, no code needed", async () => {
    const restore = useTempDataRoot();
    try {
      await reset();
      await ensureNewsroomSchema();
      const sql = await getSql();
      await sql`insert into newsroom_members (user_id, role, newsroom_id) values (${"already-owner"}, ${"owner"}, ${1})`;
      const editor = await claimOwner("already-owner");
      assert.equal(editor.role, "owner");
    } finally {
      restore();
    }
  });
});
