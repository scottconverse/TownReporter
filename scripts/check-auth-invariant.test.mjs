import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  judgeSignInForm,
  probeSignIn,
  probeSignInPage,
  readSignInForm,
  signInWarnings,
} from "./check-auth-invariant.mjs";
import { projectRoot } from "./with-app-env.mjs";

/**
 * Windows refuses symlink creation to unprivileged processes unless Developer
 * Mode is on, so this fixture cannot be built there. That is an environment
 * limit, not a defect — skip rather than fail, so the whole suite is not held
 * hostage by it.
 */
function symlinkSupported() {
  try {
    const dir = mkdtempSync(join(tmpdir(), "symlink-probe-"));
    symlinkSync(dir, join(dir, "self"), "dir");
    return true;
  } catch {
    return false;
  }
}
const SKIP_SYMLINK = symlinkSupported()
  ? undefined
  : { skip: "symlinks not permitted on this platform (Windows Developer Mode is off)" };

/** The facts a page with a rendered sign-in form shows. */
const FORM = { emailFields: 1, passwordFields: 1, submitLabel: "Create editor account", opening: false };

/**
 * A page object shaped like the one Playwright hands back, so the reader and
 * the probe are testable without launching Chromium (`import { chromium } from
 * "playwright"` is deliberately not loaded by this test file's import graph).
 */
function fakePage({ emailFields = 0, passwordFields = 0, submitLabel = "", body = "", status = 200 } = {}) {
  const field = (count, text = "") => ({
    count: async () => count,
    first: () => ({ innerText: async () => text, waitFor: async () => {} }),
    innerText: async () => text,
    waitFor: async () => {},
  });
  const page = {
    gotoUrl: null,
    locator(selector) {
      if (selector === 'input[type="email"]') return field(emailFields);
      if (selector === 'input[type="password"]') return field(passwordFields);
      if (selector === 'button[type="submit"]') return field(submitLabel ? 1 : 0, submitLabel);
      if (selector === "body") return field(1, body);
      throw new Error(`unexpected selector ${selector}`);
    },
    async goto(href) {
      page.gotoUrl = href;
      return { status: () => status };
    },
  };
  return page;
}

test("a rendered form is agreement, and names what it saw", () => {
  const result = judgeSignInForm(FORM);
  assert.equal(result.status, "ok");
  assert.match(result.message, /sign-in renders/);
  assert.match(result.message, /email fields 1, password fields 1/);
  assert.match(result.message, /Create editor account/);
});

test("the sign-in branch's submit label is accepted too", () => {
  assert.equal(judgeSignInForm({ ...FORM, submitLabel: "Sign in with email" }).status, "ok");
});

test("a form with no password field is missing, not ok", () => {
  const result = judgeSignInForm({ ...FORM, passwordFields: 0 });
  assert.equal(result.status, "missing");
  assert.match(result.message, /no usable sign-in form/);
});

test("a submit button that is not the sign-in action is missing", () => {
  const result = judgeSignInForm({ ...FORM, submitLabel: "Subscribe" });
  assert.equal(result.status, "missing");
  assert.match(result.message, /submit "Subscribe"/);
});

test("a page stuck on Opening… names the real cause", () => {
  const result = judgeSignInForm({
    emailFields: 0,
    passwordFields: 0,
    submitLabel: "",
    opening: true,
  });
  assert.equal(result.status, "missing");
  assert.match(result.message, /stuck on "Opening…"/);
  assert.match(result.message, /did not\s+hydrate/);
});

test("readSignInForm reports the fields, the submit label and the placeholder", async () => {
  const facts = await readSignInForm(fakePage({ ...FORM, body: "Editor desk\nOpening…" }));
  assert.deepEqual(facts, { ...FORM, opening: true });
  assert.deepEqual(await readSignInForm(fakePage()), {
    emailFields: 0,
    passwordFields: 0,
    submitLabel: "",
    opening: false,
  });
});

test("the probe loads /login on the given server and judges it", async () => {
  const page = fakePage(FORM);
  const result = await probeSignInPage(page, "http://127.0.0.1:8099");
  assert.equal(result.status, "ok");
  assert.equal(page.gotoUrl, "http://127.0.0.1:8099/login");
});

test("a server that does not answer 200 is indeterminate, not a verdict", async () => {
  const result = await probeSignInPage(fakePage({ ...FORM, status: 500 }), "http://127.0.0.1:8099");
  assert.equal(result.status, "indeterminate");
  assert.match(result.message, /answered 500 rather than 200/);
});

test("an unreachable server is indeterminate, not a failure", async () => {
  const page = fakePage(FORM);
  page.goto = async () => {
    throw new Error("ECONNREFUSED");
  };
  const result = await probeSignInPage(page, "http://127.0.0.1:1");
  assert.equal(result.status, "indeterminate");
  assert.match(result.message, /could not load http:\/\/127\.0\.0\.1:1\/login/);
});

test("a browser that will not launch is indeterminate, and is closed when it does", async () => {
  const failed = await probeSignIn("http://127.0.0.1:8099", {
    launch: async () => {
      throw new Error("Executable doesn't exist");
    },
  });
  assert.equal(failed.status, "indeterminate");
  assert.match(failed.message, /could not launch Chromium/);

  let closed = false;
  const ok = await probeSignIn("http://127.0.0.1:8099", {
    launch: async () => ({
      newPage: async () => fakePage(FORM),
      close: async () => {
        closed = true;
      },
    }),
  });
  assert.equal(ok.status, "ok");
  assert.ok(closed, "the browser this probe opened must be closed again");
});

test("only a missing form warns the smoke verdict", () => {
  const missing = judgeSignInForm({ ...FORM, emailFields: 0 });
  assert.deepEqual(signInWarnings(missing), [missing.message]);
  assert.deepEqual(signInWarnings(judgeSignInForm(FORM)), []);
  assert.deepEqual(signInWarnings({ status: "indeterminate", message: "no server" }), []);
});

test("the CLI reports rather than silently passing when run via a symlink", SKIP_SYMLINK, async () => {
  // A check whose exit code is the whole signal must never no-op to 0 because
  // process.argv[1] came in through a symlinked path. A dead port is the
  // cheapest indeterminate: the CLI launches a browser before it fails to
  // load the page, so this stays exit 2 whether or not Chromium is installed.
  const link = join(mkdtempSync(join(tmpdir(), "auth-invariant-link-")), "scripts");
  symlinkSync(join(projectRoot(), "scripts"), link);
  const error = await promisify(execFile)(process.execPath, [
    join(link, "check-auth-invariant.mjs"),
    "--dev-url",
    "http://127.0.0.1:1",
  ]).catch((err) => err);
  assert.equal(error.code, 2);
  assert.match(error.stderr, /\[auth-invariant\]/);
});
