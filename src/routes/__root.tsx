import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { PAPER } from "@/lib/paper";
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
          "A civic newspaper for Longmont, Colorado. Human-edited. Grok-reported from the public record.",
      },
      { name: "theme-color", content: "#F6F1E7" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
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
