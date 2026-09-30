/*
  Where the request actually came from, for the one decision that needs it.

  MUST keep the `.server` suffix: this file imports
  `@tanstack/react-start/server` (Node `AsyncLocalStorage`). Imported from a
  module that reaches the client bundle, it takes the build down with
  `AsyncLocalStorage is not a constructor` -- the same trap
  src/lib/auth/isolation.server.ts documents.

  WHAT THIS IS FOR (unit U17c). `cf-ipcity` and `cf-ipcountry` are Cloudflare's
  own headers: Cloudflare sets them at its edge, from the address it saw the
  connection arrive from. Nothing about the name makes them unforgeable, so a
  client that connects straight to this server -- the LAN case SELF-HOSTING.md
  records as having happened, `HOST=0.0.0.0` before it was closed -- can put
  `cf-ipcity: <anything>` on its own request and have it counted as a place.
  That is a data-integrity hole, not a privacy one: it writes a value of the
  caller's choosing into a row an editor reads.

  THE GATE. The headers are believed only when the request arrived over
  LOOPBACK. That is where the tunnel daemon's requests come from and nowhere
  else does: `SELF-HOSTING.md` has the paper served through a Cloudflare Tunnel
  that dials OUT from the Halo box and reaches the server on 127.0.0.1, with
  nothing listening on a port the internet can reach. So loopback is a
  faithful stand-in for "this came from the tunnel", and a request from
  anywhere else has no location rather than a forged one.

  WHY NOT TRUST `x-forwarded-for` OR `cf-connecting-ip` HERE. Both are
  headers, and both are therefore attacker-controlled on a direct connection.
  A gate that can be opened by the thing it is guarding is not a gate.
  `getRequestIP()` is called with NO options, which is h3's transport-peer form
  -- it reads the socket, never a header (h3-v2's `getRequestIP` consults
  `x-forwarded-for` only when asked, and this never asks).

  WHEN THE PEER IS UNAVAILABLE. `getRequestIP()` throws outside the server
  runtime, and answers `undefined` when the adapter does not report a peer
  address. Both are treated as NOT loopback: this returns false, and the caller
  gets no location. The brief for this unit says exactly that -- an unavailable
  peer address means no location, never an accepted one. Failing closed is the
  only safe direction, because the alternative is trusting a header a client
  can set.

  THE ONE SETTING THIS GATE RESTS ON, AND IT IS OFF (unit U17d). h3's
  `getRequestIP()` answers `event.req.ip`, and on the srvx Node server `req.ip`
  is the SOCKET address only while `trustProxy` is unset or false. Turn it on
  and srvx's own plugin rewrites `req.ip` from the first `x-forwarded-for`
  value before any handler runs --
  `node_modules/srvx/dist/_chunks/_trust-proxy.mjs`:

      const forwardedFor = firstForwardedValue(headers.get("x-forwarded-for"));
      if (forwardedFor) Object.defineProperty(request, "ip", { value: forwardedFor, ... });

  With that on, this function would be reading a header the caller controls,
  the gate would open for anyone who sent `x-forwarded-for: 127.0.0.1`, and
  both the location and the visitor count would become forgeable. Nitro's
  `serve()` passes no proxy option, and nothing in this repo sets one, which is
  why the gate holds today. IF YOU EVER ADD `trustProxy` TO THE NITRO CONFIG,
  THIS GATE IS GONE -- and the fix is not to keep trusting it but to read the
  socket directly. `src/lib/news/stats-privacy.test.ts` asserts the setting is
  absent from the config this repo owns, so that change fails the suite rather
  than silently opening the door.
*/

import { getRequestIP } from "@tanstack/react-start/server";

import { isLoopbackAddress } from "./stats-privacy.ts";

/**
 * True when this request's transport peer is the loopback interface, so the
 * Cloudflare location headers on it may be believed.
 *
 * Never throws: a missing request context (a build step, a unit test outside
 * the runtime, a server function called from nowhere) is `false`.
 */
export function beaconPeerIsLoopback(): boolean {
  try {
    return isLoopbackAddress(getRequestIP());
  } catch {
    return false;
  }
}
