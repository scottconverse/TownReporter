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
 */
interface HeaderEvent {
  url: URL;
  req: { method: string; headers: Headers };
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
  return result;
}
