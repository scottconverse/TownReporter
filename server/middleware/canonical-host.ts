/**
 * One canonical origin. Redirects `www.` to the bare domain.
 *
 * Two live origins for one site is not cosmetic here. Server functions are
 * guarded by `assertSameSiteRequest`, which rejects anything that is not
 * `same-origin` — that guard is what stops a sibling subdomain riding this
 * app's session cookie, so it must stay strict.
 *
 * With both `www.` and the apex serving, a POST that crosses between them
 * arrives as `Sec-Fetch-Site: same-site` and is refused with a plain-text 403.
 * The browser client cannot parse that as a result, so the call resolves to
 * `undefined` and the page fails with "Cannot read properties of undefined" —
 * a type error, miles from the actual cause, with nothing in the server log.
 * Publishing a story failed exactly this way.
 *
 * `__Host-` cookies are host-scoped, so the two origins also cannot share a
 * sign-in. Redirecting is the fix; loosening the guard is not.
 *
 * The canonical host comes from `PUBLIC_SITE_URL` or `BETTER_AUTH_URL`. With
 * neither set (local dev) this does nothing.
 */
interface HostEvent {
  url: URL;
  req: { method: string; headers: Headers };
}

function canonicalHost(): string {
  for (const key of ["PUBLIC_SITE_URL", "BETTER_AUTH_URL"]) {
    const raw = process.env[key]?.trim();
    if (!raw) continue;
    try {
      const host = new URL(raw).host.toLowerCase();
      // Only meaningful when the configured origin is itself the bare domain.
      if (host && !host.startsWith("www.")) return host;
    } catch {
      /* not a URL — ignore */
    }
  }
  return "";
}

export default function canonicalHostMiddleware(
  event: HostEvent,
  next: () => unknown | Promise<unknown>,
): unknown | Promise<unknown> {
  const target = canonicalHost();
  if (!target) return next();

  const requested = (
    event.req.headers.get("x-forwarded-host")?.split(",")[0] ??
    event.req.headers.get("host") ??
    event.url.host
  )
    .trim()
    .toLowerCase();

  if (requested !== `www.${target}`) return next();

  const location = `https://${target}${event.url.pathname}${event.url.search}`;
  // 308 rather than 301: it preserves the method and body, so a POST that
  // lands here is retried correctly instead of being silently downgraded.
  return new Response(null, { status: 308, headers: { location } });
}
