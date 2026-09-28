/**
 * The headers a browser needs to defend this desk, which were entirely absent.
 *
 * A gate audit checked every route with curl and with Chromium and found none
 * of them: no `X-Frame-Options`, no `frame-ancestors`, no
 * `X-Content-Type-Options`, no referrer policy. On a reader's page that is
 * untidy. On `/desk/ops` it is a real hole, because that page carries controls
 * that restart the app and the Cloudflare Tunnel on the operator's own Windows
 * machine.
 *
 * The attack it opens is clickjacking, and the session guard does not stop it.
 * A hostile page frames `/desk/ops`, floats something inviting over the restart
 * button, and waits for a signed-in editor to click. The request that follows
 * is a genuine same-origin request from the framed page, carrying the real
 * session cookie, so `assertSameSiteRequest` sees `same-origin` and is
 * satisfied -- it was never designed to answer "was this click the operator's
 * idea?". Only the browser can refuse to draw the frame in the first place.
 *
 * `frame-ancestors 'none'` is the modern spelling and `X-Frame-Options: DENY`
 * the older one; both ship, because the cost is a few bytes and the older
 * header is still what some embedded views honour.
 *
 * The Content-Security-Policy is deliberately narrow rather than complete. The
 * app inlines styles and hydration state, so `unsafe-inline` for style and
 * script would be needed to keep it working, and a policy that permits inline
 * script is not really a script policy -- claiming one here would be the kind
 * of decorative security this project has already been caught shipping. What
 * IS worth stating and is honest: nothing may frame this, no plugins, no base
 * tag rewriting, and forms may only post back to this origin.
 *
 * `connect-src 'self'` is left OUT on purpose. The desk legitimately talks to
 * a model provider and to search engines from the SERVER, not the browser, but
 * pinning connect-src here would be a promise about the browser that a future
 * client-side fetch would quietly break, and a CSP that gets loosened in a
 * hurry is worse than one that was never over-claimed.
 *
 * HSTS is not set here either. This server sits behind a Cloudflare Tunnel
 * that terminates TLS; the app itself is reached over plain HTTP on loopback,
 * so an HSTS header from here would be both meaningless and, if the operator
 * ever moved to a LAN address, actively harmful.
 *
 * ---
 *
 * The same header set carries the document cache rule, added for 0.6.81.
 *
 * A reviewer saw townreporter.org pages from 0.6.68 and 0.6.76 after 0.6.80
 * had shipped. The pages were new; the bytes the browser (or Cloudflare, or a
 * proxy in between) handed over were not. Nothing on a document response said
 * how long it stayed good, so whatever held it was free to keep it.
 *
 * Every HTML page now says. Two answers, one rule each:
 *
 * - The desk tree (`/desk` and everything under it) is somebody's own
 *   workspace: `private, no-store`. Not stored by a shared cache, not stored
 *   by the browser. A release that changes the desk changes it on the next
 *   request, always.
 * - Every other document is the public paper: `no-cache`. That is not "do not
 *   cache" -- it is "revalidate before you use it", so a browser or an edge
 *   still serves a fast 304 when nothing changed, and serves the new page the
 *   moment anything did. That is exactly the property that was missing.
 *
 * The hashed bundles under `/assets` are deliberately NOT touched: their names
 * change when their bytes change, so their long cache is correct and is what
 * keeps the paper quick. The gate is the response's own content type, so
 * anything that is not an HTML document -- JS, CSS, the feed, the sitemap,
 * images, JSON -- keeps whatever policy it already had.
 */
interface HeaderEvent {
  url: URL;
  req: { method: string; headers: Headers };
}

/** The desk layout route and every screen under it. */
const DESK_PREFIX = "/desk";

/**
 * The cache answer for one document path.
 *
 * The split is by path, not by session, and that is on purpose: the HTML of a
 * public page is the same document whoever asks for it, so `no-cache` is both
 * sufficient and honest there. The desk is the only surface whose document is
 * one person's workspace, and it is one path prefix, so there is no guess to
 * make -- a request either is under `/desk` or is not.
 */
function documentCacheControl(pathname: string): string {
  if (pathname === DESK_PREFIX || pathname.startsWith(`${DESK_PREFIX}/`)) {
    return "private, no-store";
  }
  return "no-cache";
}

/**
 * One policy for every route.
 *
 * An earlier instinct was to lock the desk down harder than the paper. That is
 * a worse design: the reader-facing pages are the ones a stranger can reach, so
 * a split policy means the surface most exposed to the internet gets the weaker
 * half. Nothing here costs a reader anything, so everything gets it.
 */
const HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  // Send the full URL to ourselves, only the origin to anyone else, and
  // nothing at all when leaving HTTPS for HTTP. A civic paper links out to
  // agenda portals and court records constantly; those sites do not need to
  // learn which story the reader came from.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Features this app never uses. Naming them denies them to anything that
  // does end up embedded, including a compromised dependency.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Content-Security-Policy": [
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "),
};

export default async function securityHeadersMiddleware(
  event: HeaderEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();

  /*
    Only a Response can carry headers.

    Middleware here may return a Response, or it may return nothing and leave
    the rendering to what comes after. Reaching into a non-Response and hoping
    would throw on the request path that matters most, so anything else is
    passed through untouched and the header set is applied by whichever layer
    does produce the Response.
  */
  if (!(result instanceof Response)) return result;

  for (const [name, value] of Object.entries(HEADERS)) {
    // Never overwrite: a route that has deliberately set its own policy knows
    // something this blanket does not.
    if (!result.headers.has(name)) result.headers.set(name, value);
  }

  /*
    The document cache rule, gated the same way app-chrome.ts decides what a
    document is: by the response's own content type. A non-HTML response -- a
    hashed `/assets` bundle, the feed, an image, a server-function JSON reply --
    is left alone. Same never-overwrite rule as above.
  */
  const contentType = String(result.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/html") && !result.headers.has("Cache-Control")) {
    result.headers.set("Cache-Control", documentCacheControl(event.url.pathname));
  }

  return result;
}
