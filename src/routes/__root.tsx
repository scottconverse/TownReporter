import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { siteUrl } from "@/lib/paper";
import { DEFAULT_PAPER_IDENTITY, resolvePaperIdentity } from "@/lib/paper-identity";
import { PaperProvider } from "@/lib/paper-context";
import { getPaperIdentityFn } from "@/lib/news/paper-settings";
import { AppearanceProvider } from "@/lib/appearance-provider";
import { appearanceHeadScript } from "@/lib/appearance";
import { readerStorageKey } from "@/lib/reader";
import appCss from "../styles.css?url";
import deskCss from "../desk-astra.css?url";
import readerCss from "../reader-astra.css?url";
import { useState } from "react";

/*
  A tab left open across a deploy heals itself.

  Every promote replaces the content-hashed script files, so a page loaded
  before the deploy asks for chunks that no longer exist the moment the
  reader clicks anything -- and got "Something went wrong: Failed to fetch
  dynamically imported module" (seen live on three of the operator's own
  tabs after v0.5.4). Vite announces exactly this as `vite:preloadError`;
  one reload fetches the current page and the current chunks together. The
  sessionStorage guard allows a single automatic attempt per minute so a
  genuinely broken deploy still shows its error instead of reload-looping.
*/
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem("chunk-reload-at") ?? 0);
    } catch {
      /* storage can be unavailable; reload once anyway */
    }
    if (Date.now() - last < 60_000) return; // let the error screen show
    try {
      sessionStorage.setItem("chunk-reload-at", String(Date.now()));
    } catch {
      /* best effort */
    }
    event.preventDefault();
    window.location.reload();
  });
}

export const Route = createRootRoute({
  /*
    Fetched ONCE per page load, on the server: this `beforeLoad` runs a
    single time per navigation, and its returned object is merged into every
    descendant route's `context` (TanStack's normal context-inheritance
    behaviour) -- not re-fetched per component or per route. Falls back to
    the shipped PAPER constant if the call ever throws, so a database hiccup
    degrades to today's fixed copy rather than a broken page.
  */
  beforeLoad: async () => {
    try {
      // A thrown error is caught below, but a server function can also
      // resolve to `undefined` without throwing (e.g. under DB stress, or a
      // slow/short-circuited server function) -- coerce that case too, or
      // `paper` ends up `undefined` in route context, `<PaperProvider
      // value={undefined}>` overrides the context's own default, and every
      // `usePaper()`/`usePaperDateFormatters()` call downstream throws
      // "Cannot destructure property 'timezone' of undefined", white-screening
      // the public page.
      return { paper: resolvePaperIdentity(await getPaperIdentityFn()) };
    } catch (err) {
      console.error("[paper] identity fetch failed, using shipped default", err);
      return { paper: DEFAULT_PAPER_IDENTITY };
    }
  },
  head: ({ match }) => {
    const paper = resolvePaperIdentity(match.context.paper);
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: `${paper.name} — ${paper.location}` },
        // The deck IS this sentence, and it is configurable. Hard-coding it
        // here left a second city describing Longmont in its own <head>.
        { name: "description", content: `${paper.deck} ${paper.trust}` },
        { name: "theme-color", content: "#F6F1E7" },
        // Site-wide share card. Article routes override the title, description
        // and URL; the image is the same for all of them.
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: paper.name },
        { property: "og:image", content: siteUrl("/og.jpg") },
        { name: "twitter:image", content: siteUrl("/og.jpg") },
      ],
      links: [
        /*
        The fonts are served from this origin, not from Google.

        Linking `fonts.googleapis.com` meant every reader's browser announced
        itself to Google before a word of the story rendered. Self-hosting
        removes that third-party dependency at build and runtime. The files
        live in `public/fonts` and the @font-face rules in `src/fonts.css`;
        regenerate with `node scripts/fetch-fonts.mjs`.
      */
        { rel: "stylesheet", href: appCss },
        { rel: "stylesheet", href: deskCss },
        { rel: "stylesheet", href: readerCss },
        { rel: "manifest", href: "/__app/manifest.webmanifest" },
        { rel: "apple-touch-icon", href: "/__app/icon-180.png" },
        // Without an explicit icon the browser falls back to /favicon.ico, which
        // does not exist — a 404 on every page load and a blank tab icon.
        // public/favicon.svg was shipped but never referenced.
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      ],
    };
  },
  component: Root,
});

function Root() {
  // Belt-and-suspenders alongside the beforeLoad coercion above: this
  // guarantees PaperProvider is never handed `undefined`, whatever route
  // context ends up carrying (e.g. a stale/partial context during a client
  // transition), so it can never silently override the context's own default
  // and white-screen usePaper()/usePaperDateFormatters() callers.
  const paper = resolvePaperIdentity(Route.useRouteContext().paper);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false } },
      }),
  );
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/*
          The theme is chosen BEFORE the first paint.

          The saved Light/Dark and Normal/Large choices live in localStorage,
          which only script can read, and the server has no idea which one is
          set -- so the server renders the light palette and the client used
          to correct it in a mount effect, one paint too late. On a hard
          reload, and on every client-side navigation into a screen that
          renders outside the desk shell, an editor in dark mode saw a full
          white frame (owner report, 2026-09-25). This script runs as the
          head is parsed -- before <body> exists, so before anything can
          paint -- reads both values, and stamps `data-appearance` and
          `data-desk-size` on <html>. Every dark palette in styles.css,
          desk-astra.css and reader-astra.css is keyed on those attributes,
          so the first painted frame is already the right one.

          Why a head script and not a cookie the server reads: a cookie is a
          SECOND store, written at a different moment from localStorage, and
          the two can disagree -- a stale cookie means the server renders the
          wrong theme and the bug is back, silently, with nothing to notice
          it by. localStorage already holds the choice; this reads the one
          store. It is also the only mechanism that covers a page whose
          JavaScript never runs, and its reader key is per-paper, which a
          cookie (per-origin) cannot express. See src/lib/appearance.ts for
          the full rationale and src/lib/appearance.test.ts for the parity
          check against `appearanceSurface`.

          It sits AFTER <HeadContent /> on purpose: the theme-color meta it
          corrects is rendered by HeadContent, and it updates that meta
          rather than adding its own.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: appearanceHeadScript(readerStorageKey(paper.name, paper.city)),
          }}
        />
      </head>
      {/*
        No inline `background`/`color` here any more.

        This element carried `style={{ background: "#F6F1E7", ... }}`, a fixed
        light canvas -- and inline styles beat every stylesheet, so it was the
        one surface the `data-appearance` rules in styles.css could not
        repaint. It duplicated the `@layer base` body rule anyway; the
        background now comes from that rule plus
        `:root[data-appearance="desk-dark"] body` / `"reader-dark"`, which the
        script above has already applied by the time this element paints.
      */}
      <body>
        {/*
          Last resort for a page where React never started.

          This began as a redirect: after 1200ms it read the first <h1> and,
          if it said "Opening the desk", sent the visitor to /login. A
          signed-in editor sees exactly that heading while their newsroom
          loads -- and that load runs five DDL statements before its two
          selects -- so a slow database threw a signed-in editor out to the
          sign-in page. An audit filed it Critical. The repair keyed the
          check on a marker attribute instead of copy and pushed the delay
          out to 8000ms, past the desk route's own 2500ms decision.

          It fired again anyway, on 2026-09-02, and cost four browser walks
          in one day. The reason is structural, not a matter of picking a
          bigger number: this script gets one timeout and the DOM, and from
          those it cannot tell "the app's JavaScript will never run" from
          "the app's JavaScript is still loading". The marker is
          server-rendered, so it is on the page in BOTH cases. On a cold Vite
          dev server on a two-core runner, evaluating the module graph past
          eight seconds is ordinary. And a redirect is not a harmless guess:
          /login sends a signed-in owner to /desk, /desk sends an owner who
          has not finished first-run setup to /desk/setup, so every misfire
          looped the browser back to a BLANK setup form and threw away
          whatever had been typed.

          So it no longer navigates anyone. It sets one attribute, and a rule
          in styles.css reveals the escape hatch the awaiting-a-session screen
          already ships (hidden) in its own server-rendered HTML. The visitor
          decides. It stamps <html>, which is the one element React is told to
          ignore on hydration (suppressHydrationWarning, just below): touching
          anything React rendered -- undoing the link's own `hidden`, or even
          adding an attribute of our own to the pending screen -- makes the
          later hydration mismatch and log a warning, on exactly the slow page
          where this fires. The rule itself lives in styles.css because that
          is a plain <link>: it is still on the page this is for, where the
          app's JavaScript is not. A stranded visitor
          still gets a way out after eight seconds; a visitor whose app was
          merely slow gets an extra link they can ignore, and it disappears
          the moment React hydrates. Guessing wrong now costs a link instead
          of a lost session.

          `data-session-hydrated` is stamped by ScreenPending from an effect,
          so it appears only once React has hydrated that element: when the
          app is alive and deliberately waiting, the link is not offered at
          all.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "setTimeout(function(){var e=document.querySelector(" +
              '"[data-awaiting-session]:not([data-session-hydrated])");' +
              'if(e)document.documentElement.setAttribute("data-stranded","");},8000);',
          }}
        />
        <PreviewHostBridge />
        {/*
          Outermost of the app providers, so every screen -- the desk shell,
          the pending/error screens that render outside it, and the public
          paper -- can ask what the appearance is. It renders no markup of its
          own and writes no attribute React owns: the head script above owns
          `data-appearance`/`data-desk-size` until hydration, and this
          provider only re-stamps them afterwards so a toggle takes effect
          without a reload. See src/lib/appearance-context.ts.
        */}
        <AppearanceProvider readerKey={readerStorageKey(paper.name, paper.city)}>
          <AuthProvider>
            <QueryClientProvider client={client}>
              <PaperProvider value={paper}>
                <Outlet />
              </PaperProvider>
            </QueryClientProvider>
          </AuthProvider>
        </AppearanceProvider>
        <Scripts />
      </body>
    </html>
  );
}
