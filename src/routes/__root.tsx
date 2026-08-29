import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { PAPER, siteUrl } from "@/lib/paper";
import appCss from "../styles.css?url";
import { useState } from "react";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: `${PAPER.name} — ${PAPER.location}` },
      {
        name: "description",
        content:
          "Independent civic reporting for Longmont, Colorado. The public record is only the beginning. Human-edited. Sources shown.",
      },
      { name: "theme-color", content: "#F6F1E7" },
      // Site-wide share card. Article routes override the title, description
      // and URL; the image is the same for all of them.
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: PAPER.name },
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
  }),
  component: Root,
});

function Root() {
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
        <script
          dangerouslySetInnerHTML={{
            __html:
              'setTimeout(function(){var h=document.querySelector("h1");if(!h)return;var t=h.textContent||"";if(t.indexOf("Checking sign-in")!==-1||t.indexOf("Opening the desk")!==-1)location.replace("/login");},1200);',
          }}
        />
        <PreviewHostBridge />
        <AuthProvider>
          <QueryClientProvider client={client}>
            <Outlet />
          </QueryClientProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
