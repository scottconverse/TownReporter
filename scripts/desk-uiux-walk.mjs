#!/usr/bin/env node
/**
 * Rendered design gate for the primary desk and reader surfaces.
 *
 * Walks the existing nine desk routes plus the public front page and its
 * seeded published welcome article across explicit theme/text-size choices
 * at desktop and narrow-phone viewports. It requires a fresh disposable
 * newsroom so setup and the seeded welcome article cannot touch live data.
 *
 *   UIWALK_BASE_URL=http://127.0.0.1:3000 node scripts/desk-uiux-walk.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

const base = checkedUrl(process.env.UIWALK_BASE_URL || "http://127.0.0.1:3491").replace(/\/$/, "");
const artifactDir = resolve(process.env.UIWALK_ARTIFACT_DIR || "../desk-uiux-walk");
const screenshotDir = join(artifactDir, "screenshots");
const email = process.env.UIWALK_EMAIL || "desk-uiux-" + Date.now() + "@townreporter.test";
const password = process.env.UIWALK_PASSWORD || "desk-uiux-e2e-pass";
const PAPER_NAME = "Testerville Ledger";
const PAPER_CITY = "Testerville";
const PAPER_STATE = "Wyoming";
const DESK_MODE_KEY = "townreporter.desk.mode";
const DESK_SIZE_KEY = "townreporter.desk.textsize";
const READER_KEY =
  "townreporter:reader:" + encodeURIComponent(PAPER_NAME) + ":" + encodeURIComponent(PAPER_CITY);

const SURFACES = [
  { name: "Desk", path: "/desk", kind: "desk", heading: "Good morning." },
  { name: "Queue", path: "/desk/queue", kind: "desk", heading: "Queue" },
  { name: "Scan", path: "/desk/scan", kind: "desk", heading: "Scan" },
  { name: "Sources", path: "/desk/sources", kind: "desk", heading: "Sources & scan" },
  { name: "Published", path: "/desk/published", kind: "desk", heading: "Published" },
  { name: "Opinion", path: "/desk/opinion", kind: "desk", heading: "Opinion" },
  { name: "Dark Desk", path: "/desk/dark", kind: "desk", heading: "Dark Desk" },
  { name: "Server", path: "/desk/ops", kind: "desk", heading: "Server" },
  { name: "Stats", path: "/desk/stats", kind: "desk", heading: "Stats" },
];
const VIEWPORTS = [
  { name: "1440px", width: 1440, height: 1000 },
  { name: "1280px", width: 1280, height: 1000 },
  { name: "1024px", width: 1024, height: 1000 },
  { name: "900px", width: 900, height: 1000 },
  { name: "390px", width: 390, height: 1000 },
];
const THEMES = ["light", "dark"];
const SIZES = ["normal", "large"];
const DARK_RGB = { r: 27, g: 25, b: 22 };
const LIGHT_RGB = { r: 255, g: 253, b: 247 };
const EXPECTED_CAPTURES = VIEWPORTS.length * THEMES.length * SIZES.length * (SURFACES.length + 2);
const AUTH_RATE_LIMIT_IDLE_PAUSE_MS = 61_000;
const INTERACTIVE_SELECTOR =
  'a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"]';
const ACCESSIBLE_CONTROL_ROLES = new Set([
  "link",
  "button",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "slider",
  "spinbutton",
  "menuitem",
]);

mkdirSync(screenshotDir, { recursive: true });
const report = {
  ok: false,
  base,
  expectedCaptures: EXPECTED_CAPTURES,
  completedCaptures: 0,
  matrix: {
    viewports: VIEWPORTS.map(({ name, width, height }) => ({ name, width, height })),
    themes: THEMES,
    textSizes: SIZES,
    deskSurfaces: SURFACES.map(({ name, path }) => ({ name, path })),
    readerSurfaces: ["Front page", "Published welcome article"],
    setup: "fresh throwaway editor and first-run paper on disposable test server",
    sessionPolicy:
      "The walk signs out and re-authenticates the disposable editor through the rendered sign-in form before cases 11 and 16; it records a 61-second auth-idle interval after case 11 to reset the disposable server's inactivity-window limiter. These are recorded boundaries, and no matrix cases are replayed or skipped.",
    exclusions: [
      "unset/system-following appearance defaults and live media changes (UX-002)",
      "other public informational/legal routes and desk routes outside the existing nine",
      "cross-combinations where desk and reader use different explicit themes or text sizes",
      "interactive workflow outcomes beyond entering the desk and opening the seeded published story",
      "conditional front-page More sections navigation is absent from the fresh fixture's section set; content-rich navigation is reserved for the final installed walkthrough",
    ],
    disclosurePolicy:
      "Collapsed details descendants and inert mobile-drawer controls are excluded from the collapsed-state control denominator. Visible details summaries and the mobile navigation toggle are checked in the collapsed state; the walk temporarily opens existing disclosures and the mobile drawer, checks revealed controls and overflow, then restores their original state.",
  },
  captures: [],
  scaleChecks: [],
  failures: [],
  sessionBoundaries: [],
  authIdleIntervals: [],
  authTelemetry: [],
};
let browser;
let page;
let currentCapture = null;
let createdOwner = false;
let authTelemetrySequence = 0;
const authTelemetryPending = [];

function persistReport() {
  writeFileSync(join(artifactDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
}

function authCaptureContext() {
  if (!currentCapture) return null;
  const { scenario, viewport, theme, size, surface, path } = currentCapture;
  return { scenario, viewport, theme, size, surface, path };
}

function cookieHeaderNames(value) {
  return String(value || "")
    .split(";")
    .map((part) => part.split("=", 1)[0].trim())
    .filter(Boolean);
}

function summarizeSetCookie(value) {
  const [pair = "", ...attributes] = String(value || "").split(";").map((part) => part.trim());
  return {
    name: pair.split("=", 1)[0],
    attributes: attributes.filter(Boolean).map((attribute) => {
      const separator = attribute.indexOf("=");
      return separator < 0
        ? { name: attribute.toLowerCase(), value: true }
        : { name: attribute.slice(0, separator).toLowerCase(), value: attribute.slice(separator + 1) };
    }),
  };
}

function trackAuthHttp(page) {
  const relevant = (request) => {
    const pathname = new URL(request.url()).pathname;
    return pathname.startsWith("/api/auth/") ||
      (request.isNavigationRequest() &&
        (pathname === "/login" || pathname.startsWith("/desk") || pathname === "/" || pathname.startsWith("/articles/")));
  };

  page.on("request", (request) => {
    if (!relevant(request)) return;
    const sequence = ++authTelemetrySequence;
    const context = authCaptureContext();
    const at = new Date().toISOString();
    authTelemetryPending.push(
      request.allHeaders().then((headers) => {
        report.authTelemetry.push({
          sequence,
          at,
          kind: "request",
          method: request.method(),
          path: new URL(request.url()).pathname,
          resourceType: request.resourceType(),
          cookieNames: cookieHeaderNames(headers.cookie),
          authorization: headers.authorization
            ? { present: true, scheme: headers.authorization.split(" ", 1)[0] || "present" }
            : { present: false },
          capture: context,
        });
      }).catch((error) => {
        report.authTelemetry.push({
          sequence,
          at,
          kind: "request",
          method: request.method(),
          path: new URL(request.url()).pathname,
          telemetryError: String(error),
          capture: context,
        });
      }),
    );
  });

  page.on("response", (response) => {
    if (!relevant(response.request())) return;
    const sequence = ++authTelemetrySequence;
    const context = authCaptureContext();
    const at = new Date().toISOString();
    authTelemetryPending.push(
      response.headersArray().then((headers) => ({
        sequence,
        at,
        kind: "response",
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
        location: headers.find((header) => header.name.toLowerCase() === "location")?.value || null,
        setCookies: headers
          .filter((header) => header.name.toLowerCase() === "set-cookie")
          .map((header) => summarizeSetCookie(header.value)),
        capture: context,
      })).then((entry) => report.authTelemetry.push(entry)).catch((error) => {
        report.authTelemetry.push({
          sequence,
          at,
          kind: "response",
          method: response.request().method(),
          path: new URL(response.url()).pathname,
          status: response.status(),
          telemetryError: String(error),
          capture: context,
        });
      }),
    );
  });

  page.on("requestfailed", (request) => {
    if (!relevant(request)) return;
    report.authTelemetry.push({
      sequence: ++authTelemetrySequence,
      at: new Date().toISOString(),
      kind: "request-failed",
      method: request.method(),
      path: new URL(request.url()).pathname,
      failure: request.failure()?.errorText || "unknown",
      capture: authCaptureContext(),
    });
  });
}

async function flushAuthTelemetry() {
  while (authTelemetryPending.length) {
    const pending = authTelemetryPending.splice(0);
    await Promise.allSettled(pending);
  }
  report.authTelemetry.sort((left, right) => left.sequence - right.sequence);
}

function authSessionTelemetryFailures(events) {
  return events.flatMap((event) => {
    if (event.method !== "GET" || event.path !== "/api/auth/get-session") return [];

    let problem = null;
    if (event.kind === "request-failed") {
      problem = "request failed: " + (event.failure || "unknown network error");
    } else if (event.kind === "response" && (!Number.isInteger(event.status) || event.status < 200 || event.status >= 300)) {
      problem = "returned HTTP " + (Number.isInteger(event.status) ? event.status : "unknown");
    }
    if (!problem) return [];

    const capture = event.capture
      ? [
          [
            event.capture.scenario,
            event.capture.viewport,
            event.capture.theme,
            event.capture.size,
            event.capture.surface,
          ].filter(Boolean).join("/"),
          event.capture.path ? "path=" + event.capture.path : "",
        ].filter(Boolean).join(" ")
      : "outside a capture";
    return [
      "GET /api/auth/get-session " + problem +
        " (telemetry sequence " + event.sequence + "; " + capture + ")",
    ];
  });
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function colorParts(css) {
  const values = (css || "").match(/[\d.]+/g);
  if (!values || values.length < 3) return null;
  return {
    r: Number(values[0]),
    g: Number(values[1]),
    b: Number(values[2]),
    a: values.length > 3 ? Number(values[3]) : 1,
  };
}

function closeColor(actual, expected) {
  return Boolean(
    actual &&
      actual.a > 0.98 &&
      Math.abs(actual.r - expected.r) <= 1 &&
      Math.abs(actual.g - expected.g) <= 1 &&
      Math.abs(actual.b - expected.b) <= 1,
  );
}

function closeNumber(actual, expected, tolerance = 0.15) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function accessibleControlsFromSnapshot(snapshot) {
  return snapshot
    .split(/\r?\n/)
    .flatMap((line) => {
      const normalizedLine = line.replace(/^\s*-\s+'((?:[^']|'')*)'(.*)$/, (_, value, suffix) =>
        "- " + value.replace(/''/g, "'") + suffix,
      );
      const match = normalizedLine.match(/^\s*-\s+([a-z-]+)(?:\s+"((?:[^"\\]|\\.)*)")?(?=\s|:|$)/);
      if (!match || !ACCESSIBLE_CONTROL_ROLES.has(match[1])) return [];
      return [{ role: match[1], name: (match[2] || "").trim(), line: normalizedLine.trim() }];
    });
}

function accessibleControlFromSnapshot(snapshot) {
  return accessibleControlsFromSnapshot(snapshot)[0] || null;
}

function normalizedSnapshotText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function missingInteractiveRoleFailure(measured) {
  if (!(measured.missingInteractiveRoleControls > 0)) return null;
  return measured.missingInteractiveRoleControls +
    " rendered interactive controls have no role in Chromium's accessibility tree (" +
    measured.missingViewportRoleControls + " initially in viewport; " +
    measured.belowFoldMissingRoleControls + " initially below fold): " +
    measured.missingRoleExamples.join("; ");
}

function screenshotPathFor(scenario, surfaceName) {
  const name = [
    String(scenario.index).padStart(2, "0"),
    scenario.viewport.name,
    scenario.theme,
    scenario.size,
    safeName(surfaceName),
  ].join("-");
  return join(screenshotDir, name + ".png");
}

async function establishIdentity(page, surface, scenario) {
  const expected = {
    pathname: surface.path,
    kind: surface.kind,
    heading: surface.heading || "",
    paperName: PAPER_NAME,
    paperCity: PAPER_CITY,
  };
  await page.waitForFunction(
    (value) => {
      if (location.pathname !== value.pathname) return false;
      const h1 = document.querySelector("h1");
      const heading = (h1?.textContent || "").trim();
      if (!heading) return false;
      if (value.kind === "desk") return heading.includes(value.heading);
      if (value.kind === "home") {
        return heading.includes(value.paperName) && heading.includes(value.paperCity);
      }
      return Boolean(
        document.querySelector(".articlebody p") &&
          heading !== "That story is not in this edition",
      );
    },
    expected,
    { timeout: 20_000 },
  );

  const appearance =
    surface.kind === "desk"
      ? scenario.theme === "dark" ? "desk-dark" : "light"
      : scenario.theme === "dark" ? "reader-dark" : "light";
  const deskFont = scenario.size === "large" ? 16.8 : 14;
  const readerScale = scenario.size === "large" ? "1.2" : "1";
  const readerFont =
    (scenario.viewport.width <= 560 ? 18 : 20) * (scenario.size === "large" ? 1.2 : 1);
  await page.waitForFunction(
    (value) => {
      if (document.documentElement.getAttribute("data-appearance") !== value.appearance) return false;
      if (value.kind === "desk") {
        const desk = document.querySelector(".desk-ltr");
        return Boolean(
          desk &&
            Math.abs(parseFloat(getComputedStyle(desk).fontSize) - value.deskFont) < 0.15,
        );
      }
      const reader = document.querySelector(".reader");
      if (!reader || getComputedStyle(reader).getPropertyValue("--reader-scale").trim() !== value.readerScale) {
        return false;
      }
      if (value.kind === "home") {
        const headline = document.querySelector(".reader .lead h2.leadhead");
        return Boolean(headline && parseFloat(getComputedStyle(headline).fontSize) > 0);
      }
      const body = document.querySelector(".reader .articlebody");
      return Boolean(
        body &&
          Math.abs(parseFloat(getComputedStyle(body).fontSize) - value.readerFont) < 0.15,
      );
    },
    { kind: surface.kind, appearance, deskFont, readerScale, readerFont },
    { timeout: 20_000 },
  );
}

async function signInAndSetup(page, scenario) {
  await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByRole("heading", { name: /^(Create the desk|Editor sign-in)$/ }).waitFor({
    timeout: 30_000,
  });
  const isFirstOwner = (await page.getByRole("heading", { name: "Create the desk", exact: true }).count()) > 0;

  if (!createdOwner) {
    if (!isFirstOwner) {
      throw new Error(
        "The design walk requires a fresh disposable desk. The server already has an owner; no existing account or shared data was changed.",
      );
    }
    await page.getByLabel("Name", { exact: true }).fill("UI Walk Editor");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await fillPendingSetupCodeIfPresent(page);
    await page.getByRole("button", { name: "Create editor account" }).click();
    await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
    await completeFirstRunSetup(page, base, {
      name: PAPER_NAME,
      city: PAPER_CITY,
      state: PAPER_STATE,
    });
    createdOwner = true;
  } else {
    if (isFirstOwner) {
      throw new Error("The seeded design-walk owner disappeared between matrix cases.");
    }
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  }

  await seedPreferences(page, scenario);
  await page.goto(base + "/desk", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await establishIdentity(page, SURFACES[0], scenario);
}

async function renewDisposableSession(page, scenario) {
  const signOutState = await page.evaluate(async () => {
    const response = await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = await response.json().catch(() => null);
    const sessionResponse = await fetch("/api/auth/get-session", { credentials: "include" });
    const session = await sessionResponse.json().catch(() => null);
    return {
      signOutStatus: response.status,
      signOutError: body?.message || body?.error || "",
      signedOutSessionStatus: sessionResponse.status,
      signedOut: !session?.session && !session?.user,
    };
  });
  if (signOutState.signOutStatus !== 200 || signOutState.signedOutSessionStatus !== 200 || !signOutState.signedOut) {
    throw new Error("Could not establish a clean auth boundary before " + scenario.id + ": " + JSON.stringify(signOutState));
  }
  const previewBearerState = await page.evaluate(() => {
    const key = "grok-auth.bearer-token";
    const presentBeforeClear = Boolean(sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    return {
      previewBearerPresentBeforeClear: presentBeforeClear,
      previewBearerCleared: !sessionStorage.getItem(key),
    };
  });
  if (!previewBearerState.previewBearerCleared) {
    throw new Error("Could not clear the disposable preview bearer before " + scenario.id);
  }
  await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByRole("heading", { name: "Editor sign-in", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const signInResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/sign-in/email") && response.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Sign in with email" }).click();
  const signInResponse = await signInResponsePromise;
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session", { credentials: "include" });
    const body = await response.json().catch(() => null);
    return {
      sessionStatus: response.status,
      authenticated: Boolean(body?.session && body?.user),
      sessionExpiresAt: body?.session?.expiresAt || null,
      previewBearerPresentAfterSignIn: Boolean(sessionStorage.getItem("grok-auth.bearer-token")),
    };
  });
  result.signInStatus = signInResponse.status();
  const observedAt = new Date();
  result.sessionCookies = (await page.context().cookies())
    .filter((cookie) => cookie.name.toLowerCase().includes("session"))
    .map(({ name, expires, secure, httpOnly, sameSite, path }) => ({
      name,
      expiresAt: expires < 0 ? null : new Date(expires * 1000).toISOString(),
      lifetimeSecondsAtObservation: expires < 0 ? null : Math.round(expires - observedAt.getTime() / 1000),
      secure,
      httpOnly,
      sameSite,
      path,
    }));
  const boundary = {
    beforeScenario: scenario.id,
    reason: "Clear the throwaway session and preview bearer, then re-authenticate through the rendered sign-in form during the long 220-capture matrix.",
    method: "same-account JSON sign-out, test-owned preview bearer clear, then rendered UI sign-in",
    ...signOutState,
    ...previewBearerState,
    ...result,
  };
  await flushAuthTelemetry();
  report.sessionBoundaries.push(boundary);
  persistReport();
  console.log("  session boundary before " + scenario.id + ": " + JSON.stringify(boundary));
  if (result.signInStatus !== 200 || result.sessionStatus !== 200 || !result.authenticated) {
    throw new Error("Disposable editor session renewal failed at " + scenario.id + ": " + JSON.stringify(boundary));
  }
}

async function seedPreferences(page, scenario) {
  const error = await page.evaluate((value) => {
    try {
      localStorage.setItem(value.deskModeKey, value.theme);
      localStorage.setItem(value.deskSizeKey, value.size);
      localStorage.setItem(
        value.readerKey,
        JSON.stringify({
          dark: value.theme === "dark",
          size: value.size === "large" ? 25 : 21,
          saved: [],
        }),
      );
      return "";
    } catch (caught) {
      return String(caught);
    }
  }, {
    deskModeKey: DESK_MODE_KEY,
    deskSizeKey: DESK_SIZE_KEY,
    readerKey: READER_KEY,
    theme: scenario.theme,
    size: scenario.size,
  });
  if (error) throw new Error("pre-paint preference seeding failed: " + error);
}

async function captureSurface(page, scenario, surface) {
  const screenshot = screenshotPathFor(scenario, surface.name);
  currentCapture = {
    scenario: scenario.id,
    viewport: scenario.viewport.name,
    theme: scenario.theme,
    size: scenario.size,
    surface: surface.name,
    path: surface.path,
    screenshot,
  };

  const response = await page.goto(base + surface.path, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await establishIdentity(page, surface, scenario);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({ path: screenshot, fullPage: false });

  const measured = await page.evaluate((interactiveSelector) => {
    function colorParts(css) {
      const values = (css || "").match(/[\d.]+/g);
      if (!values || values.length < 3) return null;
      return {
        r: Number(values[0]),
        g: Number(values[1]),
        b: Number(values[2]),
        a: values.length > 3 ? Number(values[3]) : 1,
      };
    }
    function visible(el) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          Number(style.opacity) <= 0 ||
          style.contentVisibility === "hidden" ||
          ancestor.hasAttribute("inert")
        ) {
          return false;
        }
        if (ancestor.tagName === "DETAILS" && !ancestor.open) {
          const summary = ancestor.querySelector(":scope > summary");
          if (!summary?.contains(el)) return false;
        }
      }
      return true;
    }
    function inViewport(el) {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    }
    const visibleText = [...document.querySelectorAll("body *")].filter(
      (el) => visible(el) && (el.innerText || el.getAttribute("aria-label") || "").trim(),
    );
    let minFontPx = Infinity;
    let minFontSelector = "";
    for (const el of visibleText) {
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px > 0 && px < minFontPx) {
        minFontPx = px;
        minFontSelector =
          el.tagName.toLowerCase() +
          (typeof el.className === "string" && el.className.trim()
            ? "." + el.className.trim().split(/\s+/)[0]
            : "");
      }
    }

    const allControls = [...document.querySelectorAll(interactiveSelector)];
    const controls = allControls.filter(visible);
    const collapsedDetails = [...document.querySelectorAll("details:not([open])")];
    const collapsedDetailsHiddenControls = new Set(
      allControls.filter((el) => {
        const details = el.closest("details:not([open])");
        const summary = details?.querySelector(":scope > summary");
        return details && !summary?.contains(el);
      }),
    );
    const inertHiddenControls = new Set(
      allControls.filter((el) => {
        const inertAncestor = el.closest("[inert]");
        const details = el.closest("details:not([open])");
        const summary = details?.querySelector(":scope > summary");
        return inertAncestor && !(details && !summary?.contains(el));
      }),
    );
    const initialViewportControls = controls.filter(inViewport);
    const viewportControlSet = new Set(initialViewportControls);
    const visibleControlNodes = controls.map((el) => {
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
      return {
        index: allControls.indexOf(el),
        initialViewport: viewportControlSet.has(el),
        selector: el.tagName.toLowerCase() + (cls ? "." + cls : "") + (el.id ? "#" + el.id : ""),
        html: el.outerHTML.slice(0, 300),
      };
    });
    const allSummaries = [...document.querySelectorAll("details > summary")];
    const summaryNodes = allSummaries
      .filter(visible)
      .map((el) => ({
        index: allSummaries.indexOf(el),
        initialViewport: inViewport(el),
        label: (el.innerText || "").replace(/\s+/g, " ").trim(),
      }));
    const mobileNavigationToggles = [...document.querySelectorAll(
      'button[aria-controls="desk-navigation"],button[aria-controls="reader-sections"]',
    )].filter(visible);
    const mobileNavigationToggle = mobileNavigationToggles[0] || null;
    const navLinks = [...document.querySelectorAll("nav a, aside a, [aria-label*='navigation'] a")].filter(
      (el) => visible(el) && inViewport(el),
    );
    const html = document.documentElement;
    const body = document.body;
    const htmlBg = getComputedStyle(html).backgroundColor;
    const bodyBg = body ? getComputedStyle(body).backgroundColor : "rgba(0,0,0,0)";
    const bodyColor = colorParts(bodyBg);
    const canvasColor =
      bodyColor && bodyColor.a > 0.01 ? bodyBg : htmlBg;
    const desk = document.querySelector(".desk-ltr");
    const reader = document.querySelector(".reader");
    const leadHeadline = document.querySelector(".reader .lead h2.leadhead");
    const articleBody = document.querySelector(".reader .articlebody");
    const articleLink = document.querySelector(".reader article a[href^='/articles/']");
    const root = desk || reader;
    const rootRect = root?.getBoundingClientRect();
    return {
      url: location.href,
      pathname: location.pathname,
      h1: document.querySelector("h1")?.textContent?.trim() || "",
      appearance: html.getAttribute("data-appearance"),
      deskSize: html.getAttribute("data-desk-size"),
      htmlBackground: htmlBg,
      bodyBackground: bodyBg,
      canvasColor,
      minFontPx: Number.isFinite(minFontPx) ? minFontPx : null,
      minFontSelector,
      renderedControlCandidates: controls.length,
      initialViewportControls: initialViewportControls.length,
      belowFoldControlCandidates: controls.length - initialViewportControls.length,
      collapsedDetailsCount: collapsedDetails.length,
      collapsedDetailsHiddenControlCandidates: collapsedDetailsHiddenControls.size,
      inertHiddenControlCandidates: inertHiddenControls.size,
      visibleControlNodes,
      summaryNodes,
      mobileNavigationToggleCount: mobileNavigationToggles.length,
      mobileNavigationToggleIndex: mobileNavigationToggle ? allControls.indexOf(mobileNavigationToggle) : -1,
      mobileNavigationToggleTarget: mobileNavigationToggle?.getAttribute("aria-controls") || "",
      navLinks: navLinks.length,
      overflowPx: Math.max(html.scrollWidth, body?.scrollWidth || 0) - window.innerWidth,
      rootVisible: Boolean(rootRect && rootRect.width > 0 && rootRect.height > 0),
      deskFontPx: desk ? parseFloat(getComputedStyle(desk).fontSize) : null,
      readerScale: reader ? getComputedStyle(reader).getPropertyValue("--reader-scale").trim() : "",
      homeHeadlinePx: leadHeadline ? parseFloat(getComputedStyle(leadHeadline).fontSize) : null,
      articleBodyFontPx: articleBody ? parseFloat(getComputedStyle(articleBody).fontSize) : null,
      articleBodyChars: articleBody ? articleBody.innerText.trim().length : 0,
      articleHref: articleLink ? articleLink.getAttribute("href") : null,
      seedError: window.__uiWalkSeedError || "",
    };
  }, INTERACTIVE_SELECTOR);
  const controlLocator = page.locator(INTERACTIVE_SELECTOR);
  const summaryLocator = page.locator("details > summary");
  const originalScroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const measuredControlNames = [];
  const measuredSummarySnapshots = [];
  const measuredExpandedDisclosureNames = [];
  const measuredExpandedNavigationNames = [];
  let mobileNavigationScreenshot = null;
  let mobileNavigationMetrics = {
    navigationDisclosureExpanded: false,
    navigationDisclosureCollapsedAfterAudit: false,
    expandedNavigationControlCandidates: 0,
    expandedNavigationAccessibilityNameChecks: 0,
    expandedNavigationMissingRoleControls: 0,
    expandedNavigationUnnamedControls: 0,
    expandedNavigationLinks: 0,
    expandedNavigationOverflowPx: measured.overflowPx,
  };
  let expandedDisclosureMetrics = {
    detailsExpandedForAudit: 0,
    expandedDisclosureControlCandidates: 0,
    expandedDisclosureAccessibilityNameChecks: 0,
    expandedDisclosureMissingRoleControls: 0,
    expandedDisclosureUnnamedControls: 0,
    expandedOverflowPx: measured.overflowPx,
  };
  try {
    for (const node of measured.visibleControlNodes) {
      const locator = controlLocator.nth(node.index);
      await locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
      const snapshot = await locator.ariaSnapshot();
      const control = accessibleControlFromSnapshot(snapshot);
      measuredControlNames.push({
        ...node,
        role: control?.role || "",
        name: control?.name || "",
        snapshot: control?.line || "<no interactive role in Chromium accessibility tree>",
      });
    }
    for (const node of measured.summaryNodes) {
      const locator = summaryLocator.nth(node.index);
      await locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
      const snapshot = await locator.ariaSnapshot();
      measuredSummarySnapshots.push({
        ...node,
        snapshot,
        snapshotContainsLabel:
          Boolean(normalizedSnapshotText(node.label)) &&
          normalizedSnapshotText(snapshot).includes(normalizedSnapshotText(node.label)),
      });
    }

    const mobileToggleControl = measuredControlNames.find(
      (control) => control.index === measured.mobileNavigationToggleIndex,
    );
    const mobileNavigationTarget = measured.mobileNavigationToggleTarget;
    const supportedMobileNavigationTarget =
      mobileNavigationTarget === "desk-navigation" || mobileNavigationTarget === "reader-sections";
    const mobileToggleHasComputedName = measured.mobileNavigationToggleCount > 0 &&
      supportedMobileNavigationTarget &&
      mobileToggleControl?.role === "button" &&
      Boolean(mobileToggleControl.name);
    measured.mobileNavigationToggle = mobileToggleHasComputedName;
    measured.mobileNavigationToggleTarget = mobileNavigationTarget || null;
    if (mobileToggleHasComputedName) {
      const toggle = page.getByRole("button", { name: mobileToggleControl.name, exact: true });
      let menuExpanded = false;
      try {
        await toggle.click();
        await page.waitForFunction((target) => {
          const nav = document.getElementById(target);
          const button = document.querySelector(`button[aria-controls="${target}"]`);
          const revealed = target === "desk-navigation"
            ? nav && !nav.hasAttribute("inert")
            : nav?.classList.contains("open");
          return Boolean(revealed && button?.getAttribute("aria-expanded") === "true");
        }, mobileNavigationTarget);
        menuExpanded = true;
        const navigationControls = page.locator("#" + mobileNavigationTarget).locator(INTERACTIVE_SELECTOR);
        const navigationControlCount = await navigationControls.count();
        for (let index = 0; index < navigationControlCount; index += 1) {
          const locator = navigationControls.nth(index);
          if (!(await locator.isVisible())) continue;
          const snapshot = await locator.ariaSnapshot();
          const control = accessibleControlFromSnapshot(snapshot);
          measuredExpandedNavigationNames.push({
            index,
            role: control?.role || "",
            name: control?.name || "",
            snapshot: control?.line || "<no interactive role in Chromium accessibility tree>",
          });
        }
        const expandedNavigationOverflowPx = await page.evaluate(() =>
          Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) - window.innerWidth,
        );
        mobileNavigationMetrics = {
          navigationDisclosureExpanded: true,
          expandedNavigationControlCandidates: measuredExpandedNavigationNames.length,
          expandedNavigationAccessibilityNameChecks: measuredExpandedNavigationNames.filter(
            (control) => control.role,
          ).length,
          expandedNavigationMissingRoleControls: measuredExpandedNavigationNames.filter(
            (control) => !control.role,
          ).length,
          expandedNavigationUnnamedControls: measuredExpandedNavigationNames.filter(
            (control) => control.role && !control.name,
          ).length,
          expandedNavigationLinks: measuredExpandedNavigationNames.filter(
            (control) => control.role === "link",
          ).length,
          expandedNavigationOverflowPx,
        };
        if (
          mobileNavigationMetrics.expandedNavigationMissingRoleControls > 0 ||
          mobileNavigationMetrics.expandedNavigationUnnamedControls > 0 ||
          mobileNavigationMetrics.expandedNavigationLinks === 0 ||
          mobileNavigationMetrics.expandedNavigationOverflowPx > 1
        ) {
          mobileNavigationScreenshot = screenshot.replace(/\.png$/, "-navigation-expanded.png");
          await page.screenshot({ path: mobileNavigationScreenshot, fullPage: true });
        }
      } finally {
        if (menuExpanded) {
          if (mobileNavigationTarget === "desk-navigation") {
            await page.keyboard.press("Escape");
            await page.waitForFunction(
              (target) => document.getElementById(target)?.hasAttribute("inert") === true &&
                document.querySelector(`button[aria-controls="${target}"]`)?.getAttribute("aria-expanded") === "false",
              mobileNavigationTarget,
            );
          } else {
            await toggle.click();
            await page.waitForFunction(
              (target) => !document.getElementById(target)?.classList.contains("open") &&
                document.querySelector(`button[aria-controls="${target}"]`)?.getAttribute("aria-expanded") === "false",
              mobileNavigationTarget,
            );
          }
          mobileNavigationMetrics.navigationDisclosureCollapsedAfterAudit = true;
        }
      }
    }

    const disclosureState = await page.evaluate((interactiveSelector) => {
      const allControls = [...document.querySelectorAll(interactiveSelector)];
      const collapsedVisible = new Set(
        allControls.filter((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            if (
              style.display === "none" || style.visibility === "hidden" ||
              style.visibility === "collapse" || Number(style.opacity) <= 0 ||
              style.contentVisibility === "hidden" || ancestor.hasAttribute("inert")
            ) return false;
            if (ancestor.tagName === "DETAILS" && !ancestor.open) {
              const summary = ancestor.querySelector(":scope > summary");
              if (!summary?.contains(el)) return false;
            }
          }
          return true;
        }),
      );
      const details = [...document.querySelectorAll("details")];
      const originalStates = details.map((el) => el.open);
      let expandedCount = 0;
      for (let index = 0; index < details.length; index += 1) {
        if (!details[index].open) {
          details[index].open = true;
          expandedCount += 1;
        }
      }
      const controls = allControls.filter((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (
            style.display === "none" || style.visibility === "hidden" ||
            style.visibility === "collapse" || Number(style.opacity) <= 0 ||
            style.contentVisibility === "hidden" || ancestor.hasAttribute("inert")
          ) return false;
        }
        return !collapsedVisible.has(el);
      });
      const expandedDisclosureControlNodes = controls.map((el) => {
        const rect = el.getBoundingClientRect();
        const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
        return {
          index: allControls.indexOf(el),
          initialViewport:
            rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth,
          selector: el.tagName.toLowerCase() + (cls ? "." + cls : "") + (el.id ? "#" + el.id : ""),
          html: el.outerHTML.slice(0, 300),
        };
      });
      const html = document.documentElement;
      const body = document.body;
      return {
        originalStates,
        expandedCount,
        expandedDisclosureControlNodes,
        expandedOverflowPx: Math.max(html.scrollWidth, body?.scrollWidth || 0) - window.innerWidth,
      };
    }, INTERACTIVE_SELECTOR);
    expandedDisclosureMetrics = {
      detailsExpandedForAudit: disclosureState.expandedCount,
      expandedDisclosureControlCandidates: disclosureState.expandedDisclosureControlNodes.length,
      expandedDisclosureAccessibilityNameChecks: 0,
      expandedDisclosureMissingRoleControls: 0,
      expandedDisclosureUnnamedControls: 0,
      expandedOverflowPx: disclosureState.expandedOverflowPx,
    };
    try {
      for (const node of disclosureState.expandedDisclosureControlNodes) {
        const locator = controlLocator.nth(node.index);
        await locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
        const snapshot = await locator.ariaSnapshot();
        const control = accessibleControlFromSnapshot(snapshot);
        measuredExpandedDisclosureNames.push({
          ...node,
          role: control?.role || "",
          name: control?.name || "",
          snapshot: control?.line || "<no interactive role in Chromium accessibility tree>",
        });
      }
      const disclosureNameFailure = measuredExpandedDisclosureNames.some(
        (control) => !control.role || !control.name,
      );
      if (
        disclosureState.expandedCount > 0 &&
        (disclosureState.expandedOverflowPx > 1 || disclosureNameFailure)
      ) {
        measured.expandedDisclosureScreenshot = screenshot.replace(/\.png$/, "-details-expanded.png");
        await page.screenshot({ path: measured.expandedDisclosureScreenshot, fullPage: true });
      }
    } finally {
      await page.evaluate(
        ({ originalStates, position }) => {
          [...document.querySelectorAll("details")].forEach((detail, index) => {
            detail.open = originalStates[index];
          });
          window.scrollTo({ left: position.x, top: position.y, behavior: "instant" });
        },
        {
          originalStates: disclosureState.originalStates,
          position: originalScroll,
        },
      );
    }
  } finally {
    await page.evaluate(
      (position) => window.scrollTo({ left: position.x, top: position.y, behavior: "instant" }),
      originalScroll,
    );
  }
  const missingRoleControls = measuredControlNames.filter((control) => !control.role);
  const missingViewportRoleControls = missingRoleControls.filter((control) => control.initialViewport);
  const belowFoldMissingRoleControls = missingRoleControls.filter((control) => !control.initialViewport);
  const unnamedAccessibleControls = measuredControlNames.filter((control) => control.role && !control.name);
  const summariesMissingComputedText = measuredSummarySnapshots.filter((summary) => !summary.snapshotContainsLabel);
  const expandedMissingRoleControls = measuredExpandedDisclosureNames.filter((control) => !control.role);
  const expandedUnnamedControls = measuredExpandedDisclosureNames.filter((control) => control.role && !control.name);
  const expandedNavigationMissingRoleControls = measuredExpandedNavigationNames.filter((control) => !control.role);
  const expandedNavigationUnnamedControls = measuredExpandedNavigationNames.filter(
    (control) => control.role && !control.name,
  );
  mobileNavigationMetrics.expandedNavigationMissingRoleControls = expandedNavigationMissingRoleControls.length;
  mobileNavigationMetrics.expandedNavigationUnnamedControls = expandedNavigationUnnamedControls.length;
  mobileNavigationMetrics.expandedNavigationAccessibilityNameChecks = measuredExpandedNavigationNames.filter(
    (control) => control.role,
  ).length;
  expandedDisclosureMetrics.expandedDisclosureAccessibilityNameChecks = measuredExpandedDisclosureNames.filter(
    (control) => control.role,
  ).length;
  expandedDisclosureMetrics.expandedDisclosureMissingRoleControls = expandedMissingRoleControls.length;
  expandedDisclosureMetrics.expandedDisclosureUnnamedControls = expandedUnnamedControls.length;
  measured.accessibilityNameChecks = measuredControlNames.filter((control) => control.role).length;
  measured.initialViewportAccessibilityNameChecks = measuredControlNames.filter(
    (control) => control.initialViewport && control.role,
  ).length;
  measured.belowFoldAccessibilityNameChecks = measuredControlNames.filter(
    (control) => !control.initialViewport && control.role,
  ).length;
  measured.belowFoldMissingRoleControls = belowFoldMissingRoleControls.length;
  measured.belowFoldMissingRoleExamples = belowFoldMissingRoleControls
    .slice(0, 8)
    .map((control) => control.selector + " " + control.html);
  measured.missingInteractiveRoleControls = missingRoleControls.length;
  measured.missingRoleExamples = missingRoleControls
    .slice(0, 8)
    .map((control) => control.selector + " " + control.snapshot);
  measured.missingViewportRoleControls = missingViewportRoleControls.length;
  measured.unnamedControls = unnamedAccessibleControls.length;
  measured.unnamedExamples = unnamedAccessibleControls
    .slice(0, 8)
    .map((control) => control.selector + " " + control.snapshot);
  measured.summaryChecks = measuredSummarySnapshots.length;
  measured.summaryComputedTextFailures = summariesMissingComputedText.length;
  measured.summaryFailures = summariesMissingComputedText
    .slice(0, 8)
    .map((summary) => "summary[" + summary.index + "] label=" + JSON.stringify(summary.label) + " snapshot=" + summary.snapshot);
  measured.expandedDisclosureMetrics = expandedDisclosureMetrics;
  measured.expandedDisclosureScreenshot = measured.expandedDisclosureScreenshot || null;
  measured.expandedDisclosureFailures = [...expandedMissingRoleControls, ...expandedUnnamedControls]
    .slice(0, 8)
    .map((control) => control.selector + " " + control.snapshot);
  measured.mobileNavigationToggle = measured.mobileNavigationToggle || false;
  measured.inertHiddenControlCandidates = measured.inertHiddenControlCandidates || 0;
  measured.mobileNavigationMetrics = mobileNavigationMetrics;
  measured.mobileNavigationScreenshot = mobileNavigationScreenshot;
  measured.mobileNavigationFailures = [...expandedNavigationMissingRoleControls, ...expandedNavigationUnnamedControls]
    .slice(0, 8)
    .map((control) => control.snapshot);

  const expectedTheme = surface.kind === "desk"
    ? (scenario.theme === "dark" ? "desk-dark" : "light")
    : (scenario.theme === "dark" ? "reader-dark" : "light");
  const expectedColor = scenario.theme === "dark" ? DARK_RGB : LIGHT_RGB;
  const violations = [];
  const missingRoleFailure = missingInteractiveRoleFailure(measured);
  if (missingRoleFailure) violations.push(missingRoleFailure);
  const status = response?.status() ?? null;
  if (status !== 200) violations.push("HTTP status was " + status + ", expected 200");
  if (measured.pathname !== new URL(surface.path, base).pathname) {
    violations.push("route was " + measured.pathname + ", expected " + surface.path);
  }
  if (!measured.rootVisible) violations.push("the expected desk/reader root is not visible");
  if (measured.appearance !== expectedTheme) {
    violations.push("data-appearance was " + measured.appearance + ", expected " + expectedTheme);
  }
  if (measured.seedError) violations.push("pre-paint preference seeding failed: " + measured.seedError);
  if (!closeColor(colorParts(measured.canvasColor), expectedColor)) {
    violations.push(
      "painted canvas was " + measured.canvasColor + ", expected " +
        (scenario.theme === "dark" ? "#1b1916" : "#fffdf7"),
    );
  }
  if (!Number.isFinite(measured.minFontPx) || measured.minFontPx < 14) {
    violations.push(
      "smallest visible text was " + measured.minFontPx + "px at " +
        measured.minFontSelector + "; informational text must be at least 14px",
    );
  }
  if (measured.renderedControlCandidates === 0) violations.push("no rendered interactive controls were found");
  if (measured.unnamedControls > 0) {
    violations.push(
      measured.unnamedControls + " visible interactive controls have no accessible name: " +
        measured.unnamedExamples.join("; "),
    );
  }
  if (measured.summaryComputedTextFailures > 0) {
    violations.push(
      measured.summaryComputedTextFailures + " visible disclosure summaries have no matching text in Chromium's computed accessibility snapshot: " +
        measured.summaryFailures.join("; "),
    );
  }
  if (measured.expandedDisclosureMetrics.expandedDisclosureMissingRoleControls > 0) {
    violations.push(
      measured.expandedDisclosureMetrics.expandedDisclosureMissingRoleControls +
        " controls revealed by opening disclosures have no interactive role in Chromium's accessibility tree: " +
        measured.expandedDisclosureFailures.join("; "),
    );
  }
  if (measured.expandedDisclosureMetrics.expandedDisclosureUnnamedControls > 0) {
    violations.push(
      measured.expandedDisclosureMetrics.expandedDisclosureUnnamedControls +
        " controls revealed by opening disclosures have no accessible name: " +
        measured.expandedDisclosureFailures.join("; "),
    );
  }
  if (measured.navLinks === 0 && !measured.mobileNavigationToggle) {
    violations.push("no visible navigation links or collapsed mobile navigation control were found");
  }
  if (measured.mobileNavigationToggle && !measured.mobileNavigationMetrics.navigationDisclosureExpanded) {
    violations.push("the visible mobile navigation control did not open its navigation disclosure");
  }
  if (
    measured.mobileNavigationToggle &&
    !measured.mobileNavigationMetrics.navigationDisclosureCollapsedAfterAudit
  ) {
    violations.push("the mobile navigation disclosure did not return to its collapsed state after inspection");
  }
  if (measured.mobileNavigationMetrics.expandedNavigationMissingRoleControls > 0) {
    violations.push(
      measured.mobileNavigationMetrics.expandedNavigationMissingRoleControls +
        " controls revealed by opening mobile navigation have no interactive role in Chromium's accessibility tree: " +
        measured.mobileNavigationFailures.join("; "),
    );
  }
  if (measured.mobileNavigationMetrics.expandedNavigationUnnamedControls > 0) {
    violations.push(
      measured.mobileNavigationMetrics.expandedNavigationUnnamedControls +
        " controls revealed by opening mobile navigation have no accessible name: " +
        measured.mobileNavigationFailures.join("; "),
    );
  }
  if (measured.mobileNavigationToggle && measured.mobileNavigationMetrics.expandedNavigationLinks === 0) {
    violations.push("opening the mobile navigation revealed no accessible links");
  }
  if (
    measured.mobileNavigationToggle &&
    measured.mobileNavigationMetrics.expandedNavigationOverflowPx > 1
  ) {
    violations.push(
      "document overflows the viewport horizontally by " + measured.mobileNavigationMetrics.expandedNavigationOverflowPx +
        "px while mobile navigation is expanded",
    );
  }
  if (measured.overflowPx > 1) {
    violations.push("document overflows the viewport horizontally by " + measured.overflowPx + "px");
  }
  if (
    measured.expandedDisclosureMetrics.expandedOverflowPx > 1 &&
    measured.expandedDisclosureMetrics.expandedOverflowPx > Math.max(1, measured.overflowPx)
  ) {
    violations.push(
      "document overflows the viewport horizontally by " + measured.expandedDisclosureMetrics.expandedOverflowPx +
        "px while disclosures are expanded",
    );
  }

  if (surface.kind === "desk") {
    const expectedFont = scenario.size === "large" ? 16.8 : 14;
    if (measured.deskSize !== scenario.size) {
      violations.push("data-desk-size was " + measured.deskSize + ", expected " + scenario.size);
    }
    if (!closeNumber(measured.deskFontPx, expectedFont)) {
      violations.push(
        "desk shell computed font was " + measured.deskFontPx + "px, expected " + expectedFont + "px",
      );
    }
    if (!measured.h1.includes(surface.heading)) {
      violations.push("route heading was " + JSON.stringify(measured.h1) + ", expected to include " + surface.heading);
    }
  } else {
    const expectedScale = scenario.size === "large" ? "1.2" : "1";
    if (measured.readerScale !== expectedScale) {
      violations.push("reader computed scale was " + measured.readerScale + ", expected " + expectedScale);
    }
    if (surface.kind === "home") {
      if (!measured.h1.includes(PAPER_NAME) || !measured.h1.includes(PAPER_CITY)) {
        violations.push("front-page identity heading was " + JSON.stringify(measured.h1));
      }
      if (!measured.articleHref || !/^\/articles\/[a-z0-9-]+$/i.test(measured.articleHref)) {
        violations.push("front page has no link to the seeded published article");
      }
      if (!Number.isFinite(measured.homeHeadlinePx) || measured.homeHeadlinePx <= 0) {
        violations.push("front-page story headline is missing or has no computed size");
      }
    } else {
      if (!measured.h1 || measured.articleBodyChars < 40) {
        violations.push("published article identity/body is missing (" + measured.articleBodyChars + " body characters)");
      }
      const expectedBodyFont =
        (scenario.viewport.width <= 560 ? 18 : 20) * (scenario.size === "large" ? 1.2 : 1);
      if (!closeNumber(measured.articleBodyFontPx, expectedBodyFont)) {
        violations.push(
          "article body computed font was " + measured.articleBodyFontPx + "px, expected " + expectedBodyFont + "px",
        );
      }
    }
  }

  const record = {
    ...currentCapture,
    status,
    h1: measured.h1,
    appearance: measured.appearance,
    deskSize: measured.deskSize,
    canvasColor: measured.canvasColor,
    minFontPx: measured.minFontPx,
    minFontSelector: measured.minFontSelector,
    renderedControlCandidates: measured.renderedControlCandidates,
    initialViewportControls: measured.initialViewportControls,
    initialViewportAccessibilityNameChecks: measured.initialViewportAccessibilityNameChecks,
    belowFoldControlCandidates: measured.belowFoldControlCandidates,
    belowFoldAccessibilityNameChecks: measured.belowFoldAccessibilityNameChecks,
    accessibilityNameChecks: measured.accessibilityNameChecks,
    collapsedDetailsCount: measured.collapsedDetailsCount,
    collapsedDetailsHiddenControlCandidates: measured.collapsedDetailsHiddenControlCandidates,
    inertHiddenControlCandidates: measured.inertHiddenControlCandidates,
    summaryChecks: measured.summaryChecks,
    summaryComputedTextFailures: measured.summaryComputedTextFailures,
    expandedDisclosureMetrics: measured.expandedDisclosureMetrics,
    expandedDisclosureScreenshot: measured.expandedDisclosureScreenshot,
    belowFoldMissingRoleControls: measured.belowFoldMissingRoleControls,
    belowFoldMissingRoleExamples: measured.belowFoldMissingRoleExamples,
    missingInteractiveRoleControls: measured.missingInteractiveRoleControls,
    missingRoleExamples: measured.missingRoleExamples,
    missingViewportRoleControls: measured.missingViewportRoleControls,
    unnamedControls: measured.unnamedControls,
    unnamedExamples: measured.unnamedExamples,
    navLinks: measured.navLinks,
    mobileNavigationToggle: measured.mobileNavigationToggle,
    mobileNavigationToggleTarget: measured.mobileNavigationToggleTarget,
    mobileNavigationMetrics: measured.mobileNavigationMetrics,
    mobileNavigationScreenshot: measured.mobileNavigationScreenshot,
    mobileNavigationFailures: measured.mobileNavigationFailures,
    overflowPx: measured.overflowPx,
    deskFontPx: measured.deskFontPx,
    readerScale: measured.readerScale,
    homeHeadlinePx: measured.homeHeadlinePx,
    articleBodyFontPx: measured.articleBodyFontPx,
    articleBodyChars: measured.articleBodyChars,
    violations,
  };
  await flushAuthTelemetry();
  report.captures.push(record);
  report.completedCaptures = report.captures.length;
  persistReport();
  currentCapture = { ...record };

  console.log(
    "  " + scenario.id + " " + scenario.viewport.name + "/" + scenario.theme + "/" + scenario.size +
      " " + surface.name + ": " + (violations.length ? "FAIL " + violations.join("; ") : "PASS"),
  );
  if (violations.length) {
    throw new Error(surface.name + " failed rendered checks: " + violations.join("; ") + " [" + screenshot + "]");
  }
  return measured;
}

function checkScaleRatios() {
  const groups = new Map();
  for (const capture of report.captures) {
    if (capture.violations.length) continue;
    const metric = capture.surface === "Desk" ||
      SURFACES.some((surface) => surface.name === capture.surface)
      ? capture.deskFontPx
      : capture.surface === "Front page"
        ? capture.homeHeadlinePx
        : capture.articleBodyFontPx;
    const key = [capture.viewport, capture.theme, capture.surface].join("|");
    if (!groups.has(key)) groups.set(key, {});
    groups.get(key)[capture.size] = metric;
  }
  for (const [key, values] of groups) {
    if (!Number.isFinite(values.normal) || !Number.isFinite(values.large)) continue;
    const ratio = values.large / values.normal;
    const passed = closeNumber(ratio, 1.2, 0.025);
    report.scaleChecks.push({ key, normalPx: values.normal, largePx: values.large, ratio, passed });
    if (!passed) {
      report.failures.push(
        key + " Large/Normal computed font ratio was " + ratio.toFixed(3) + ", expected 1.20",
      );
    }
  }
  const expectedGroups = (SURFACES.length + 2) * VIEWPORTS.length * THEMES.length;
  if (report.scaleChecks.length !== expectedGroups) {
    report.failures.push(
      "computed scale comparison groups were " + report.scaleChecks.length +
        ", expected " + expectedGroups,
    );
  }
}

async function run() {
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
  });
  page = await context.newPage();
  trackAuthHttp(page);
  page.setDefaultNavigationTimeout(30_000);
  let index = 0;
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      for (const size of SIZES) {
        index += 1;
        const scenario = {
          index,
          id: "case-" + String(index).padStart(2, "0"),
          viewport,
          theme,
          size,
        };
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        console.log(
          "\n" + scenario.id + " " + viewport.name + " " + viewport.width + "x" + viewport.height +
            " " + theme + " " + size,
        );

        if (createdOwner && (index === 11 || index === 16)) {
          await renewDisposableSession(page, scenario);
        }

        if (!createdOwner) {
          currentCapture = {
            scenario: scenario.id,
            viewport: viewport.name,
            theme,
            size,
            surface: "Authentication and first-run setup",
            path: "/login",
            screenshot: screenshotPathFor(scenario, "authentication-setup"),
          };
          await signInAndSetup(page, scenario);
        } else {
          currentCapture = {
            scenario: scenario.id,
            viewport: viewport.name,
            theme,
            size,
            surface: "Preference state setup",
            path: "/desk",
            screenshot: screenshotPathFor(scenario, "preference-setup"),
          };
          await seedPreferences(page, scenario);
          await page.goto(base + "/desk", { waitUntil: "domcontentloaded", timeout: 30_000 });
          await establishIdentity(page, SURFACES[0], scenario);
        }
        for (const surface of SURFACES) {
          await captureSurface(page, scenario, surface);
        }
        const home = {
          name: "Front page",
          path: "/",
          kind: "home",
        };
        const homeMetrics = await captureSurface(page, scenario, home);
        if (!homeMetrics.articleHref || !/^\/articles\/[a-z0-9-]+$/i.test(homeMetrics.articleHref)) {
          throw new Error("Front page did not expose the seeded article link needed for reader coverage.");
        }
        await captureSurface(page, scenario, {
          name: "Published welcome article",
          path: homeMetrics.articleHref,
          kind: "article",
        });
        if (index === 11) {
          const before = report.authTelemetry.filter(
            (event) => event.kind === "request" && event.path === "/api/auth/get-session",
          ).length;
          const waitStartedAt = Date.now();
          await page.waitForTimeout(AUTH_RATE_LIMIT_IDLE_PAUSE_MS);
          await flushAuthTelemetry();
          const waitEndedAt = Date.now();
          const during = report.authTelemetry.filter(
            (event) =>
              event.kind === "request" &&
              event.path === "/api/auth/get-session" &&
              Date.parse(event.at) >= waitStartedAt &&
              Date.parse(event.at) <= waitEndedAt,
          ).length;
          const requests = report.authTelemetry.filter(
            (event) => event.kind === "request" && event.path === "/api/auth/get-session",
          );
          const lastRequestAt = requests.length ? Date.parse(requests[requests.length - 1].at) : null;
          const actualIdleMs = lastRequestAt === null ? null : waitEndedAt - lastRequestAt;
          const interval = {
            afterScenario: scenario.id,
            beforeScenario: "case-12",
            configuredWaitMs: AUTH_RATE_LIMIT_IDLE_PAUSE_MS,
            actualWaitMs: waitEndedAt - waitStartedAt,
            getSessionRequestsBefore: before,
            getSessionRequestsDuring: during,
            lastGetSessionRequestAt: lastRequestAt === null ? null : new Date(lastRequestAt).toISOString(),
            measuredIdleMs: actualIdleMs,
          };
          report.authIdleIntervals.push(interval);
          persistReport();
          console.log("Auth inactivity-window reset interval: " + JSON.stringify(interval));
          if (during !== 0 || actualIdleMs === null || actualIdleMs <= 60_000) {
            throw new Error("The measured auth idle interval did not exceed the server's 60-second inactivity window.");
          }
        }
      }
    }
  }
  await context.close();
  await flushAuthTelemetry();
  report.failures.push(...authSessionTelemetryFailures(report.authTelemetry));
  checkScaleRatios();
  if (report.failures.length) throw new Error(report.failures.join("\n"));
  if (report.completedCaptures !== EXPECTED_CAPTURES) {
    throw new Error(
      "completed " + report.completedCaptures + " captures, expected " + EXPECTED_CAPTURES,
    );
  }
  report.ok = true;
}

try {
  console.log(
    "Rendered design walk: " + EXPECTED_CAPTURES + " captures across " +
      VIEWPORTS.length + " viewports × " + THEMES.length + " themes × " + SIZES.length + " text sizes.",
  );
  await run();
} catch (error) {
  await flushAuthTelemetry();
  const message = error instanceof Error ? error.message : String(error);
  const currentUrl = page ? page.url() : "";
  let screenshot = currentCapture?.screenshot || "";
  if (page && screenshot) {
    try {
      await page.screenshot({ path: screenshot, fullPage: false });
    } catch {
      screenshot = "";
    }
  }
  const failure = {
    error: message,
    url: currentUrl,
    currentCapture,
    screenshot: screenshot || null,
    completedCaptures: report.completedCaptures,
    expectedCaptures: EXPECTED_CAPTURES,
  };
  report.failures.push(failure);
  report.ok = false;
  console.error(JSON.stringify(failure, null, 2));
} finally {
  await flushAuthTelemetry();
  persistReport();
  await browser?.close().catch(() => {});
}

console.log(
  JSON.stringify(
    {
      ok: report.ok,
      completedCaptures: report.completedCaptures,
      expectedCaptures: report.expectedCaptures,
      scaleChecks: report.scaleChecks.length,
      failures: report.failures,
      artifactDir,
      report: join(artifactDir, "report.json"),
    },
    null,
    2,
  ),
);
if (!report.ok) process.exitCode = 1;
