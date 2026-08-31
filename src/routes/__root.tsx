import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { siteUrl } from "@/lib/paper";
import { DEFAULT_PAPER_IDENTITY, PaperProvider } from "@/lib/paper-context";
import { getPaperIdentityFn } from "@/lib/news/paper-settings";
import appCss from "../styles.css?url";
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
      return { paper: await getPaperIdentityFn() };
    } catch (err) {
      console.error("[paper] identity fetch failed, using shipped default", err);
      return { paper: DEFAULT_PAPER_IDENTITY };
    }
  },
  head: ({ match }) => {
    const paper = match.context.paper ?? DEFAULT_PAPER_IDENTITY;
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
        itself to Google before a word of the story rendered — the same kind of
        leak as the analytics beacon, on a paper whose whole pitch is that it
        does not sell its readers. The files live in `public/fonts` and the
        @font-face rules in `src/fonts.css`; regenerate with
        `node scripts/fetch-fonts.mjs`.
      */
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
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
  const { paper } = Route.useRouteContext();
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
      </head>
      <body style={{ background: "#F6F1E7", color: "#1C1410", margin: 0 }}>
        {/*
          Last resort for a page where React never started.

          This used to fire after 1200ms and decide by reading the first
          <h1>: if it said "Opening the desk", it sent the visitor to
          /login. Two things were wrong with that. A signed-in editor sees
          exactly that heading while their newsroom loads -- and that load
          runs five DDL statements before its two selects -- so an editor
          who WAS signed in got thrown out to the sign-in page whenever the
          database was slow. And 1200ms is shorter than the 2500ms the desk
          route itself waits, so this timer raced the real logic and usually
          won. An audit filed it as a Critical.

          Now it keys on an attribute that only the awaiting-a-session
          screen renders, never on copy, and it waits long enough that the
          route's own decision always lands first. If that element is still
          on the page after eight seconds, React did not start at all, and
          a static sign-in page is a better place to be stranded.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'setTimeout(function(){if(document.querySelector("[data-awaiting-session]"))location.replace("/login");},8000);',
          }}
        />
        <PreviewHostBridge />
        <AuthProvider>
          <QueryClientProvider client={client}>
            <PaperProvider value={paper}>
              <Outlet />
            </PaperProvider>
          </QueryClientProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
