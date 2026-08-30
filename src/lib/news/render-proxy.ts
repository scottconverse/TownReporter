import { guardedLookup } from "./fetch-url.ts";

/**
 * A loopback forward-proxy that pins Chromium's DNS to a vetted address.
 *
 * The `undici` fetch path closes DNS rebinding by resolving inside the
 * connector (`guardedLookup` in fetch-url.ts): the address it approves is the
 * address it connects to. The Playwright render path had no such guard — it
 * called `assertPublicHttpUrl` (one lookup), then handed the HOSTNAME to
 * Chromium, which resolved it a SECOND time and connected to whatever that
 * answered. A hostile authoritative server answers the two lookups differently
 * and lands Chromium on a private address (127.0.0.1, 169.254.169.254, the LAN).
 * The render path is the worst place for this: it drives a real browser with
 * JavaScript enabled at a URL the model extracted from an attacker-influenced
 * source, unattended. Audit finding ENG-201.
 *
 * The fix, matching option (2) the audit recommended: route Chromium through a
 * proxy on loopback whose CONNECT/forward resolves each host exactly once via
 * `guardedLookup` and dials that vetted IP. Chromium configured with a proxy
 * does not resolve DNS itself — the proxy does — so there is no second lookup to
 * rebind, for the top navigation OR any subresource. A blocked address (private,
 * loopback, link-local) is refused before a socket opens.
 *
 * One shared server serves every render (renders are infrequent — JS civic
 * portals only). It binds 127.0.0.1 on an ephemeral port and is never reachable
 * off the box.
 */

type ProxyHandle = { port: number };

let started: Promise<ProxyHandle | null> | null = null;

/** Resolve a host to one vetted IPv4/IPv6 literal, or reject if blocked. */
function resolveGuarded(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // family 0 = either; guardedLookup rejects any blocked address.
    void guardedLookup(host, { family: 0 }, (err, address) => {
      if (err) {
        reject(err);
        return;
      }
      const ip = Array.isArray(address) ? address[0]?.address : address;
      if (!ip) {
        reject(new Error("That host could not be resolved"));
        return;
      }
      resolve(ip);
    });
  });
}

/** Split "host:port" (host may be a bracketed IPv6 literal) into parts. */
function splitHostPort(authority: string, fallbackPort: number): { host: string; port: number } {
  const m = /^\[(.+)\]:(\d+)$/.exec(authority) ?? /^\[(.+)\]$/.exec(authority);
  if (m) return { host: m[1]!, port: m[2] ? Number(m[2]) : fallbackPort };
  const idx = authority.lastIndexOf(":");
  if (idx > 0 && /^\d+$/.test(authority.slice(idx + 1))) {
    return { host: authority.slice(0, idx), port: Number(authority.slice(idx + 1)) };
  }
  return { host: authority, port: fallbackPort };
}

/**
 * Start (once) the guarded proxy and return its loopback port.
 *
 * Returns null when the Node net/http modules cannot be loaded (never, on a
 * server) — the caller then falls back to the pre-existing per-request
 * `assertPublicHttpUrl` guard, which still blocks the common cases.
 */
export function startGuardedRenderProxy(): Promise<ProxyHandle | null> {
  started ??= (async () => {
    try {
      const httpSpec = "node:http";
      const netSpec = "node:net";
      const http = (await import(/* @vite-ignore */ httpSpec)) as typeof import("node:http");
      const net = (await import(/* @vite-ignore */ netSpec)) as typeof import("node:net");

      const server = http.createServer();

      // Plain HTTP: Chromium sends the request in absolute form to the proxy.
      server.on("request", (req, res) => {
        void (async () => {
          try {
            const target = new URL(req.url ?? "");
            if (target.protocol !== "http:") {
              res.writeHead(400).end("bad scheme");
              return;
            }
            const port = target.port ? Number(target.port) : 80;
            const ip = await resolveGuarded(target.hostname);
            const upstream = net.connect(port, ip, () => {
              const path = target.pathname + target.search;
              upstream.write(`${req.method} ${path} HTTP/1.1\r\n`);
              for (let i = 0; i < req.rawHeaders.length; i += 2) {
                upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
              }
              upstream.write("\r\n");
              req.pipe(upstream);
            });
            upstream.on("error", () => res.writeHead(502).end("upstream error"));
            upstream.pipe(res.socket!);
          } catch {
            // Blocked address or unresolvable host: refuse.
            if (!res.headersSent) res.writeHead(403).end("blocked");
          }
        })();
      });

      // HTTPS: Chromium sends CONNECT host:443. We open a raw tunnel to the
      // vetted IP and pipe bytes — TLS stays end-to-end, we never see plaintext.
      server.on("connect", (req, clientSocket, head) => {
        void (async () => {
          try {
            const { host, port } = splitHostPort(req.url ?? "", 443);
            const ip = await resolveGuarded(host);
            const upstream = net.connect(port, ip, () => {
              clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
              if (head?.length) upstream.write(head);
              upstream.pipe(clientSocket);
              clientSocket.pipe(upstream);
            });
            upstream.on("error", () => clientSocket.destroy());
            clientSocket.on("error", () => upstream.destroy());
          } catch {
            // Blocked or unresolvable: 403 and drop.
            clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            clientSocket.destroy();
          }
        })();
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      // A helper proxy must never keep the process alive on its own — unref so
      // Node can exit (and `node --test` can finish) when nothing else is pending.
      server.unref();
      const addr = server.address();
      if (!addr || typeof addr === "string") return null;
      return { port: addr.port };
    } catch {
      return null;
    }
  })();
  return started;
}
