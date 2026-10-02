/*
  Auditor finding F5: "the app reads the .env in its working directory and
  writes its first-owner setup code to <checkout>\\.townreporter-data\\logs
  even when HOME is redirected, so a fresh-install test run from a checkout is
  not clean."

  The lever is TOWNREPORTER_DATA_ROOT, not HOME (see `dataRoot()` in
  `setup-code.server.ts`, the same variable the installer and every
  meeting-capture test already use). This file is the proof the auditor asked
  for in the two halves that matter:

    1. with the variable set to an empty temp folder, the first-owner setup
       code is written UNDER THAT ROOT (`<root>/logs/SETUP-CODE.txt`); and
    2. nothing is created or changed under the checkout -- the top level of
       the working directory and whatever `.townreporter-data` already holds
       are listed before and after and must be identical.

  It is a behavior test, not a source check: it calls the real
  `ensureOwnerSetupCode()` against the real (PGlite) database, exactly as a
  first boot does.
*/
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSql } from "../db.ts";
import { ensureNewsroomSchema } from "./membership.ts";
import { dataRoot, ensureOwnerSetupCode, setupCodeFilePath } from "./setup-code.server.ts";

/** An ownerless desk with no pending code -- the state a fresh install is in. */
async function reset() {
  await ensureNewsroomSchema();
  const sql = await getSql();
  await sql.query(`create table if not exists owner_setup_code (
    id integer primary key, code_hash text not null,
    created_at timestamptz not null default now(), consumed_at timestamptz
  )`);
  await sql`delete from newsroom_members`;
  await sql.query(`delete from owner_setup_code`);
}

describe("a fresh install's data root (F5)", () => {
  it("writes the setup code under TOWNREPORTER_DATA_ROOT and nothing under the checkout", async () => {
    const root = mkdtempSync(join(tmpdir(), "trep-fresh-install-"));
    const prior = process.env.TOWNREPORTER_DATA_ROOT;
    const checkout = process.cwd();
    const checkoutData = join(checkout, ".townreporter-data");
    // Before: the checkout exactly as it is found.
    const topBefore = readdirSync(checkout).sort();
    const dataBefore = existsSync(checkoutData) ? readdirSync(checkoutData).sort() : null;

    process.env.TOWNREPORTER_DATA_ROOT = root;
    try {
      await reset();
      await ensureOwnerSetupCode();

      // 1. The code the operator is told to read is under the root they chose.
      assert.equal(dataRoot(), root, "dataRoot() must honour TOWNREPORTER_DATA_ROOT");
      assert.equal(setupCodeFilePath(), join(root, "logs", "SETUP-CODE.txt"));
      assert.equal(existsSync(setupCodeFilePath()), true, "the setup code file should exist");
      assert.deepEqual(
        readdirSync(join(root, "logs")).sort(),
        ["SETUP-CODE.txt"],
        "the logs directory under the chosen root holds the setup code",
      );

      // 2. The checkout is untouched: same top level, same .townreporter-data.
      assert.deepEqual(
        readdirSync(checkout).sort(),
        topBefore,
        "the checkout's top level gained or lost an entry",
      );
      assert.equal(
        existsSync(join(checkoutData, "logs", "SETUP-CODE.txt")),
        false,
        "the setup code must not be written under the checkout",
      );
      assert.deepEqual(
        existsSync(checkoutData) ? readdirSync(checkoutData).sort() : null,
        dataBefore,
        "the checkout's .townreporter-data changed",
      );
    } finally {
      if (prior === undefined) delete process.env.TOWNREPORTER_DATA_ROOT;
      else process.env.TOWNREPORTER_DATA_ROOT = prior;
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* fine */
      }
    }
  });

  it("without the variable the default is the working directory -- what the docs must say", () => {
    // Documented, not changed: this is the behaviour the SELF-HOSTING recipe
    // warns about, and it is why a fresh-install trial sets the variable.
    const prior = process.env.TOWNREPORTER_DATA_ROOT;
    delete process.env.TOWNREPORTER_DATA_ROOT;
    try {
      assert.equal(dataRoot(), join(process.cwd(), ".townreporter-data"));
    } finally {
      if (prior !== undefined) process.env.TOWNREPORTER_DATA_ROOT = prior;
    }
  });
});
