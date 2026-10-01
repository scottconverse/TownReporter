#!/usr/bin/env node
/**
 * Fail loudly when the running app serves no usable sign-in form.
 *
 * The invariant is the one thing that has to hold on every surface: an editor
 * can reach `/login` and get a form. `dev`, `build` and `preview` all merge the
 * same environment through `scripts/with-app-env.mjs`, so the two surfaces
 * cannot disagree about the flag by construction — what CAN go wrong, and has,
 * is the page itself: `/login` answers 200, the client bundle throws, and the
 * desk sits on "Opening…" forever. A 200 is not proof a form renders.
 *
 * So this loads `/login` from the running server in a browser and asserts what
 * a person would see: an email field, a password field, and the submit button
 * that takes them in. `scripts/browser-smoke.mjs` runs the same probe on every
 * smoke (dev or built server — it is the same observation either way), and
 * `npm run check:auth` runs it standalone against a live server. Exit 0 the
 * form renders, 1 it does not, 2 could not observe.
 *
 * Observation happens in a browser rather than with `fetch` on purpose: the
 * served HTML for `/login` is the desk's "Opening…" placeholder, because the
 * form is rendered once the claim query resolves on the client. A `fetch` of
 * `/login` cannot see a form on either surface, so it could not fail for the
 * reason this check exists. Callers wanting the raw page facts should use
 * `probeSignIn()` / `probeSignInPage()` rather than re-deriving them.
 */
import { isMainModule } from "./with-app-env.mjs";

/** The route an editor signs in on. */
export const SIGN_IN_ROUTE = "/login";

const DEFAULT_DEV_URL = "http://127.0.0.1:8080";
/**
 * How long the form may take to appear once the document has loaded. The
 * served HTML carries no form at all, so this covers hydration plus the
 * `deskClaimState` query the page waits on before it renders the fields.
 */
const FORM_WAIT_MS = 15_000;
const NAV_TIMEOUT_MS = 30_000;

/** The submit labels the form carries, depending on whether the desk is claimed. */
export const SIGN_IN_SUBMIT_LABELS = [/create editor account/i, /sign in with email/i];

function indeterminate(message, facts = null) {
  return { status: "indeterminate", message: `[auth-invariant] ${message}`, facts };
}

/**
 * Judge what a page showed. Pure, so the verdict is unit-testable without a
 * browser — `facts` is whatever `readSignInForm()` read off the page.
 */
export function judgeSignInForm(facts) {
  const summary = `email fields ${facts.emailFields}, password fields ${facts.passwordFields}`;
  const submit = facts.submitLabel ? `, submit "${facts.submitLabel}"` : ", no submit button";
  const accepts = SIGN_IN_SUBMIT_LABELS.some((label) => label.test(facts.submitLabel ?? ""));
  if (facts.emailFields >= 1 && facts.passwordFields >= 1 && accepts) {
    return {
      status: "ok",
      message: `[auth-invariant] sign-in renders: ${summary}${submit}`,
      facts,
    };
  }
  if (facts.opening) {
    return {
      status: "missing",
      message:
        "[auth-invariant] /login is stuck on \"Opening…\" -- the client bundle did not " +
        "hydrate, so the sign-in form never rendered and no editor can get in. Check the " +
        "browser console for the module that failed to load.",
      facts,
    };
  }
  return {
    status: "missing",
    message:
      `[auth-invariant] /login rendered no usable sign-in form (${summary}${submit}). ` +
      "An editor cannot sign in on this server.",
    facts,
  };
}

/** What the sign-in page showed, as plain data. */
export async function readSignInForm(page) {
  const submit = page.locator('button[type="submit"]');
  const submitLabel = (await submit.count()) > 0 ? (await submit.first().innerText()).trim() : "";
  const body = await page.locator("body").innerText().catch(() => "");
  return {
    emailFields: await page.locator('input[type="email"]').count(),
    passwordFields: await page.locator('input[type="password"]').count(),
    submitLabel,
    opening: /Opening(?:…|\.\.\.)/.test(body),
  };
}

/**
 * Load `SIGN_IN_ROUTE` from `url` in `page` and judge what it rendered. The
 * caller owns the page (and the browser behind it).
 */
export async function probeSignInPage(
  page,
  url,
  { waitMs = FORM_WAIT_MS, navTimeoutMs = NAV_TIMEOUT_MS } = {},
) {
  const target = new URL(SIGN_IN_ROUTE, url).href;
  let response;
  try {
    response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: navTimeoutMs });
  } catch (err) {
    return indeterminate(`could not load ${target}: ${err?.message ?? err}`);
  }
  const status = response?.status() ?? 0;
  if (status !== 200) {
    return indeterminate(`${target} answered ${status || "nothing"} rather than 200`);
  }
  // Absent, not failed: a server that never renders the form is a verdict, and
  // `readSignInForm` reports what was there instead.
  await page
    .locator('input[type="email"]')
    .first()
    .waitFor({ state: "visible", timeout: waitMs })
    .catch(() => {});
  return judgeSignInForm(await readSignInForm(page));
}

/**
 * Probe `url` with a Chromium this process owns. `options.launch` substitutes
 * the launcher (tests); without it Playwright is imported on demand so that
 * importing this module costs nothing in the unit suite.
 */
export async function probeSignIn(url, options = {}) {
  let launch = options.launch;
  if (!launch) {
    let chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch (err) {
      return indeterminate(`playwright is not installed: ${err?.message ?? err}`);
    }
    launch = (launchOptions) => chromium.launch(launchOptions);
  }
  let browser;
  try {
    browser = await launch({ headless: true });
  } catch (err) {
    return indeterminate(`could not launch Chromium: ${err?.message ?? err}`);
  }
  try {
    const page = await browser.newPage();
    return await probeSignInPage(page, url, options);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * The smoke-verdict warnings for a probe. Only a missing form warns: a probe
 * that could not observe (no server, no browser) is not evidence of a defect,
 * and reporting it as one would make the smoke cry wolf.
 */
export function signInWarnings(result) {
  return result.status === "missing" ? [result.message] : [];
}

async function main(argv) {
  const devUrlFlag = argv.indexOf("--dev-url");
  const devUrl = devUrlFlag === -1 ? DEFAULT_DEV_URL : argv[devUrlFlag + 1];
  const result = await probeSignIn(devUrl);
  if (result.status === "ok") {
    console.log(result.message);
    process.exit(0);
  }
  console.error(result.message);
  process.exit(result.status === "missing" ? 1 : 2);
}

if (isMainModule(import.meta.url)) {
  await main(process.argv.slice(2));
}
