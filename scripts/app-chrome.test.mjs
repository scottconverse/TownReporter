import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  appNameFromHost,
  createHeadInjector,
  appXCreatorHeadTags,
  injectAppHead,
  isDocumentPath,
  publicAppHost,
  renderWebManifest,
  resolveOgCardAsset,
  snapshotOgIdentity,
} from "./app-chrome-shared.mjs";

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("injects before </head>", () => {
  const out = injectAppHead("<html><head><title>x</title></head><body></body></html>");
  assert.match(out, /rel="manifest"/);
  assert.match(out, /apple-touch-icon/);
  assert.ok(out.indexOf("manifest") < out.indexOf("</head>"));
});

/**
 * The builder's `extensions.js` banner is gone for good.
 *
 * A project id marked a page as running inside the Grok app builder, and every
 * such page loaded `https://grok.com/grok-app-builder/extensions.js` — a
 * third-party script for the "Created with Grok" banner, on a paper that is
 * self-hosted and documents that a cold load makes zero outside requests
 * (docs/manual.md). It was removed rather than gated, so this guards against
 * its return under the environment variable that used to switch it on.
 */
test("no page loads the builder's extension script, with or without a project id", () => {
  const previous = process.env.VITE_PROJECT_ID;
  process.env.VITE_PROJECT_ID = "proj-123";
  try {
    const withEnv = injectAppHead("<html><head></head></html>", { appName: "Demo" });
    const withCtx = injectAppHead("<html><head></head></html>", {
      appName: "Demo",
      projectId: "proj-123",
    });
    for (const [label, out] of [
      ["VITE_PROJECT_ID set", withEnv],
      ["a project id in the context", withCtx],
    ]) {
      assert.doesNotMatch(out, /grok\.com/, `${label}: a grok.com script or URL`);
      assert.doesNotMatch(out, /extensions\.js/, `${label}: the builder's extension script`);
      assert.doesNotMatch(out, /grok-project-id/, `${label}: the grok-project-id meta`);
      assert.doesNotMatch(out, /data-project-id/, `${label}: the script's data-project-id`);
      assert.doesNotMatch(out, /grok:app_id/, `${label}: the grok:app_id meta`);
      // The PWA chrome is unrelated and must still be applied.
      assert.match(out, /rel="manifest"/, `${label}: the manifest link`);
    }
  } finally {
    if (previous === undefined) delete process.env.VITE_PROJECT_ID;
    else process.env.VITE_PROJECT_ID = previous;
  }
});

test("repeating the injection never adds a grok.com script", () => {
  const ctx = { appName: "Demo", projectId: "proj-123" };
  const once = injectAppHead("<html><head></head></html>", ctx);
  const twice = injectAppHead(once, ctx);
  assert.equal(once, twice);
  assert.doesNotMatch(twice, /grok\.com/);
});

test("omits x:creator tags without both creator values", () => {
  assert.deepEqual(appXCreatorHeadTags("", "42"), []);
  assert.deepEqual(appXCreatorHeadTags("@alice", ""), []);
  const out = injectAppHead("<html><head></head></html>", {
    appName: "Demo",
    creator: "@alice",
    creatorId: "",
  });
  assert.doesNotMatch(out, /property="x:creator"/);
});

test("injects x:creator tags when both creator values are set", () => {
  const out = injectAppHead("<html><head></head></html>", {
    appName: "Demo",
    creator: "@alice",
    creatorId: "42",
  });
  assert.match(out, /property="x:creator" content="@alice"/);
  assert.match(out, /property="x:creator:id" content="42"/);
});

test("escapes x:creator values", () => {
  const tags = appXCreatorHeadTags('"><script>', '1" onclick="alert(1)');
  assert.equal(
    tags[0],
    '<meta property="x:creator" content="&quot;&gt;&lt;script&gt;">',
  );
  assert.equal(
    tags[1],
    '<meta property="x:creator:id" content="1&quot; onclick=&quot;alert(1)">',
  );
});

test("does not duplicate x:creator tags", () => {
  const ctx = { appName: "Demo", creator: "@alice", creatorId: "42" };
  const once = injectAppHead("<html><head></head></html>", ctx);
  const twice = injectAppHead(once, ctx);
  assert.equal(once, twice);
  assert.equal(twice.split('property="x:creator" content=').length - 1, 1);
  assert.equal(twice.split('property="x:creator:id"').length - 1, 1);
});

/**
 * The page owns its own share card; the platform only fills gaps.
 *
 * This used to overwrite, so a paper that gives every story its own `og:title`
 * and `og:description` published every story under the site's name. Links to
 * different stories were indistinguishable wherever they were pasted.
 */
test("platform chrome fills missing share metas and keeps the page's own", () => {
  const html =
    '<html><head><title>Hello World</title><meta property="og:title" content="A story headline"><meta name="twitter:card" content="summary"></head></html>';
  const out = injectAppHead(html, { appName: "Wild Race" });
  assert.match(out, /property="og:title" content="A story headline"/);
  assert.match(out, /name="twitter:card" content="summary"/);
  // The app name still names the PWA; it just no longer replaces the story.
  assert.doesNotMatch(out, /property="og:title" content="TownReporter"/);
  assert.equal(out.split('name="twitter:card"').length - 1, 1);
  assert.equal(out.split('property="og:title"').length - 1, 1);
});

test("still supplies share metas to a page that sets none", () => {
  const out = injectAppHead("<html><head><title>Hello World</title></head></html>", {
    appName: "Wild Race",
  });
  assert.match(out, /name="twitter:card" content="summary_large_image"/);
  assert.match(out, /property="og:title" content="TownReporter"/);
});

test("does not duplicate twitter:card or og:title", () => {
  const once = injectAppHead("<html><head><title>Hello World</title></head></html>");
  const twice = injectAppHead(once);
  assert.equal(once, twice);
  assert.equal(twice.split('name="twitter:card"').length - 1, 1);
  assert.equal(twice.split('property="og:title"').length - 1, 1);
});

test("a baked site.image is treated as a custom card", () => {
  const out = injectAppHead("<html><head></head></html>", {
    host: "wild-race.grok.me",
    cwd: mkdtempSync(join(tmpdir(), "app-og-image-only-")),
    site: { title: "Wild Race", image: "/og.jpg" },
  });
  assert.match(out, /property="og:image" content="https:\/\/wild-race\.grok\.me\/og\.jpg"/);
  assert.doesNotMatch(out, /og\.grok\.me/);
});

test("baked identity does not need a workspace filesystem", () => {
  const empty = mkdtempSync(join(tmpdir(), "app-og-empty-"));
  const out = injectAppHead("<html><head></head></html>", {
    host: "wild-race.grok.me",
    cwd: empty,
    site: { title: "Pixel Nova", type: "x:game", card: "custom" },
  });
  assert.match(out, /property="og:title" content="Pixel Nova"/);
  assert.match(out, /property="og:type" content="x:game"/);
  assert.match(out, /property="og:image" content="https:\/\/wild-race\.grok\.me\/og\.jpg"/);
  assert.doesNotMatch(out, /og\.grok\.me/);
});

test("a public card file wins over a baked site without card=custom", () => {
  // Deploy middleware always passes a baked `site`. If that snapshot missed
  // the file, public/og.jpg must still beat the og.grok.me placeholder.
  const root = mkdtempSync(join(tmpdir(), "app-og-card-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "public/og.jpg"), "x");
  const out = injectAppHead("<html><head></head></html>", {
    host: "wild-race.grok.me",
    cwd: root,
    site: {},
  });
  assert.match(out, /property="og:image" content="https:\/\/wild-race\.grok\.me\/og\.jpg"/);
  assert.doesNotMatch(out, /og\.grok\.me/);
});

test("public/og.png wins when jpg is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "app-og-png-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "public/og.png"), "x");
  const out = injectAppHead("<html><head></head></html>", {
    host: "wild-race.grok.me",
    cwd: root,
    site: { title: "Wild Race" },
  });
  assert.match(out, /property="og:image" content="https:\/\/wild-race\.grok\.me\/og\.png"/);
  assert.doesNotMatch(out, /og\.grok\.me/);
});

test("resolveOgCardAsset: disk file, then bake, then empty (placeholder)", () => {
  const empty = mkdtempSync(join(tmpdir(), "app-og-none-"));
  assert.equal(resolveOgCardAsset({}, empty), "");
  assert.equal(resolveOgCardAsset({ title: "X" }, empty), "");

  const baked = resolveOgCardAsset({ card: "custom", image: "/og.jpg" }, empty);
  assert.equal(baked, "/og.jpg");

  const root = mkdtempSync(join(tmpdir(), "app-og-disk-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "public/og.jpg"), "x");
  assert.equal(resolveOgCardAsset({}, root), "/og.jpg");
  assert.equal(resolveOgCardAsset({ card: "custom", image: "/other.png" }, root), "/og.jpg");
});

test("snapshotOgIdentity stamps card=custom from a public card file", () => {
  const root = mkdtempSync(join(tmpdir(), "app-og-snap-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "public/og.jpg"), "x");
  const { site } = snapshotOgIdentity(root);
  assert.equal(site.card, "custom");
  assert.equal(site.image, "/og.jpg");
  assert.equal(site.banner, undefined);
});

test("snapshotOgIdentity stamps banner from public/x-banner.jpg", () => {
  const root = mkdtempSync(join(tmpdir(), "app-og-banner-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "public/x-banner.jpg"), "x");
  const { site } = snapshotOgIdentity(root);
  assert.equal(site.banner, "/x-banner.jpg");
});

test("emits x:game:image for a public host when site.banner is set", () => {
  // The page sets none of these, so the platform supplies them.
  const html = "<html><head></head></html>";
  const out = injectAppHead(html, {
    host: "wild-race.grok.me",
    site: { title: "Wild Race", type: "x:game", card: "custom", banner: "/x-banner.jpg" },
  });
  assert.match(
    out,
    /property="x:game:image" content="https:\/\/wild-race\.grok\.me\/x-banner\.jpg"/,
  );
  assert.match(out, /property="x:game:image:width" content="1200"/);
  assert.match(out, /property="x:game:image:height" content="264"/);
  assert.equal(out.split('property="x:game:image"').length - 1, 1);
});

test("does not emit x:game:image without a public host or banner", () => {
  const noHost = injectAppHead("<html><head></head></html>", {
    site: { banner: "/x-banner.jpg" },
  });
  assert.doesNotMatch(noHost, /x:game:image/);
  const noBanner = injectAppHead("<html><head></head></html>", {
    host: "wild-race.grok.me",
    site: { type: "x:game", card: "custom" },
  });
  assert.doesNotMatch(noBanner, /x:game:image/);
});

test("site title Grok App is a real name, not a sentinel", () => {
  const out = injectAppHead("<html><head></head></html>", {
    host: "wild-race.grok.me",
    site: { title: "Grok App" },
  });
  assert.match(out, /property="og:title" content="Grok App"/);
});

test("published grok.me slug is still a title fallback", () => {
  const out = injectAppHead("<html><head></head></html>", {
    host: "wild-race.grok.me",
  });
  assert.match(out, /property="og:title" content="TownReporter"/);
});

test("rejects Vercel system hosts as og:image origins", () => {
  assert.equal(publicAppHost("01a020b6-803a-71a2-bb47-e2bec57eb9a2-662k8x1l1-xai-org.vercel.app"), "");
  assert.equal(publicAppHost("demo.vercel.app:443"), "");
  assert.equal(publicAppHost("vercel.app"), "");
  assert.equal(publicAppHost("wild-race.grok.me"), "wild-race.grok.me");
});

test("published VITE_PUBLIC_HOSTNAME wins over request Host for og:image", () => {
  const prev = process.env.VITE_PUBLIC_HOSTNAME;
  process.env.VITE_PUBLIC_HOSTNAME = "plum-plaza-reef-dream.grok.me";
  try {
    const vercelHost = injectAppHead("<html><head><title>RACK</title></head></html>", {
      host: "01a020b6-803a-71a2-bb47-e2bec57eb9a2-662k8x1l1-xai-org.vercel.app",
      site: { title: "RACK", card: "custom" },
    });
    assert.match(
      vercelHost,
      /property="og:image" content="https:\/\/plum-plaza-reef-dream\.grok\.me\/og\.jpg"/,
    );
    assert.doesNotMatch(vercelHost, /vercel\.app/);

    const otherPublicHost = injectAppHead("<html><head><title>RACK</title></head></html>", {
      host: "custom.example.com",
      site: { title: "RACK", card: "custom" },
    });
    assert.match(
      otherPublicHost,
      /property="og:image" content="https:\/\/plum-plaza-reef-dream\.grok\.me\/og\.jpg"/,
    );
    assert.doesNotMatch(otherPublicHost, /custom\.example\.com/);
  } finally {
    if (prev === undefined) delete process.env.VITE_PUBLIC_HOSTNAME;
    else process.env.VITE_PUBLIC_HOSTNAME = prev;
  }
});

test("vercel Host without a public hostname emits no og:image", () => {
  const prev = process.env.VITE_PUBLIC_HOSTNAME;
  delete process.env.VITE_PUBLIC_HOSTNAME;
  try {
    const out = injectAppHead("<html><head><title>RACK</title></head></html>", {
      host: "01a020b6-803a-71a2-bb47-e2bec57eb9a2-662k8x1l1-xai-org.vercel.app",
      site: { title: "RACK", card: "custom" },
    });
    assert.doesNotMatch(out, /property="og:image"/);
    assert.doesNotMatch(out, /vercel\.app/);
  } finally {
    if (prev === undefined) delete process.env.VITE_PUBLIC_HOSTNAME;
    else process.env.VITE_PUBLIC_HOSTNAME = prev;
  }
});

test("never points og:image at a third-party card service", () => {
  const empty = mkdtempSync(join(tmpdir(), "app-og-placeholder-"));
  const noCard = injectAppHead("<html><head></head></html>", {
    appName: "Wild Race",
    host: "wild-race.grok.me",
    cwd: empty,
    site: { title: "Wild Race" },
  });
  // A paper with no card of its own gets NO og:image. It used to be routed
  // through a hosted placeholder service, which sent every reader social
  // preview to a third-party origin that this product does not own.
  assert.doesNotMatch(noCard, /og:image/);
  assert.doesNotMatch(noCard, /grok\.me\/v1\/card/);

  const custom = injectAppHead("<html><head></head></html>", {
    appName: "Wild Race",
    host: "wild-race.grok.me",
    cwd: empty,
    site: { title: "Wild Race", card: "custom", type: "x:game" },
  });
  assert.match(custom, /property="og:image" content="https:\/\/wild-race\.grok\.me\/og\.jpg"/);
  assert.match(custom, /property="og:type" content="x:game"/);
});

test("a site colour never leaks into a third-party card URL", () => {
  const empty = mkdtempSync(join(tmpdir(), "app-og-color-"));
  const themed = injectAppHead("<html><head></head></html>", {
    host: "wild-race.grok.me",
    cwd: empty,
    site: { title: "Wild Race", color: "#FF4D2E" },
  });
  assert.doesNotMatch(themed, /og:image/);
  assert.doesNotMatch(themed, /\/v1\/card\.png/);

  const custom = injectAppHead("<html><head></head></html>", {
    host: "wild-race.grok.me",
    cwd: empty,
    site: { title: "Wild Race", card: "custom", color: "FF4D2E" },
  });
  assert.match(custom, /property="og:image" content="https:\/\/wild-race\.grok\.me\/og\.jpg"/);
  assert.doesNotMatch(custom, /color=/);
});


test("document title entities are not double-escaped on og:title", () => {
  const empty = mkdtempSync(join(tmpdir(), "app-og-entities-"));
  const out = injectAppHead(
    "<html><head><title>Cats &amp; Dogs</title></head></html>",
    { cwd: empty, site: {} },
  );
  assert.match(out, /property="og:title" content="Cats &amp; Dogs"/);
  assert.doesNotMatch(out, /Cats &amp;amp; Dogs/);
});

test("site.json title wins over the host slug", () => {
  const out = injectAppHead("<html><head></head></html>", {
    host: "wild-race.grok.me",
    site: { title: "Pixel Nova" },
  });
  assert.match(out, /property="og:title" content="Pixel Nova"/);
});

test("injects into documents with no head element", () => {
  const out = injectAppHead("<html><body>hi</body></html>", { appName: "Solo" });
  assert.match(out, /<head>/);
  assert.match(out, /property="og:title" content="TownReporter"/);
  assert.match(out, /<\/head>/);
});

test("streaming injector matches </HEAD> case-insensitively", () => {
  const injector = createHeadInjector({ appName: "Wild Race" });
  const chunks = [
    ...injector.push("<html><HEAD><title>x</title></HE"),
    ...injector.push("AD><body>hello</body></html>"),
  ];
  const out = Buffer.concat(chunks).toString("utf8");
  assert.match(out, /property="og:title" content="TownReporter"/);
  assert.match(out, /<body>hello<\/body>/);
});

test("is idempotent", () => {
  const once = injectAppHead("<html><head></head></html>");
  const twice = injectAppHead(once);
  assert.equal(once, twice);
});

test("uses the app name in the injected title tag", () => {
  const out = injectAppHead("<html><head></head></html>", { appName: "Wild Race" });
  assert.match(out, /apple-mobile-web-app-title" content="TownReporter"/);
});

test("streaming injector handles </head> split across chunks", () => {
  const injector = createHeadInjector({ appName: "Wild Race" });
  const chunks = [
    ...injector.push("<html><head><title>x</title></he"),
    ...injector.push("ad><body>hello</body></html>"),
  ];
  const out = Buffer.concat(chunks).toString("utf8");
  assert.match(out, /rel="manifest"/);
  assert.ok(out.indexOf("manifest") < out.indexOf("</head>"));
  assert.match(out, /<body>hello<\/body>/);
  assert.deepEqual(injector.flush(), []);
});

test("streaming injector passes post-head chunks through untouched", () => {
  const injector = createHeadInjector();
  injector.push("<html><head></head>");
  const [tail] = injector.push("<body>tail</body>");
  assert.equal(tail.toString("utf8"), "<body>tail</body>");
});

test("streaming injector falls back when no </head> is seen", () => {
  const injector = createHeadInjector();
  assert.deepEqual(injector.push("<html><head>"), []);
  const out = Buffer.concat(injector.flush()).toString("utf8");
  assert.match(out, /rel="manifest"/);
});

test("filters non-document paths", () => {
  assert.equal(isDocumentPath("/"), true);
  assert.equal(isDocumentPath("/app"), true);
  assert.equal(isDocumentPath("/api/thing"), false);
  assert.equal(isDocumentPath("/__app/manifest.webmanifest"), false);
  assert.equal(isDocumentPath("/logo.png"), false);
});

// The display name must come from the product, never from the deployment host.
// Before this fix a self-hosted newspaper was named after the host it happened
// to be served from, and fell back to "Grok App" when the host did not resolve
// to a slug — branding somebody else's paper with the builder's name.
test("name is the product's own, never derived from the host", () => {
  assert.equal(appNameFromHost("localhost:8080"), "TownReporter");
  assert.equal(appNameFromHost("172.17.154.217:8080"), "TownReporter");
  assert.equal(appNameFromHost("wild-race.grok.me"), "TownReporter");
  assert.equal(appNameFromHost("news.example.org"), "TownReporter");
  assert.equal(appNameFromHost(""), "TownReporter");
  assert.equal(appNameFromHost(undefined), "TownReporter");
});

test("hostile hosts cannot influence the display name", () => {
  assert.equal(appNameFromHost("<script>alert(1)</script>"), "TownReporter");
  assert.equal(appNameFromHost('"><img src=x onerror=1>.grok.me'), "TownReporter");
});

test("renders the manifest with the product name", () => {
  const manifest = JSON.parse(renderWebManifest("wild-race.grok.me"));
  assert.equal(manifest.name, "TownReporter");
  assert.equal(manifest.short_name, "TownReporter");
  assert.equal(manifest.icons[0].src, "/__app/icon-180.png");
});

// Tripwires: the deployed-app path only works if Nitro scans server/ — an
// accidental edit that drops serverDir or the middleware file would otherwise
// fail silently (a deployed paper would serve no manifest and inject no
// share-card metas).
test("vite config keeps the nitro serverDir wiring", () => {
  const viteConfig = readFileSync(join(TEMPLATE_ROOT, "vite.config.ts"), "utf8");
  assert.match(viteConfig, /serverDir:\s*"\.\/server"/);
  assert.match(viteConfig, /appPwaPlugin\(\)/);
});

test("nitro middleware and its bundled assets exist", () => {
  const middleware = readFileSync(join(TEMPLATE_ROOT, "server/middleware/app-chrome.ts"), "utf8");
  assert.match(middleware, /virtual:app-og-identity/);
  assert.match(middleware, /\/__app\/manifest\.webmanifest/);
  readFileSync(join(TEMPLATE_ROOT, "public/__app/icon-180.png"));
});

test("vite plugin bakes og identity as a virtual module", () => {
  const plugin = readFileSync(join(TEMPLATE_ROOT, "scripts/app-chrome-plugin.mjs"), "utf8");
  assert.match(plugin, /virtual:app-og-identity/);
  assert.match(plugin, /snapshotOgIdentity/);
});

