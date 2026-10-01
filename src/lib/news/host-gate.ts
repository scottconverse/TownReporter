/**
 * One request at a time to any one host, with a short gap between them.
 *
 * WHY THIS EXISTS. A scan reads up to `SCAN_WATCH_CAP` sources six at a time,
 * and one source is not one request: the main page plus up to four
 * sub-documents, each of which can redirect, plus a retry. Measured on this
 * codebase that is roughly fifty sends to a single host with six of them in
 * flight and no gap at all -- which is the shape of an attack from the other
 * end of the wire, and the reason a civic site starts answering 403.
 *
 * Reddit already had this treatment (`reddit.server.ts`, and it is the only
 * thing in the tree that keeps working against a rate-limited host); this is
 * the same idea, generalised to every host the desk reads and made a little
 * gentler because most of our hosts are small municipal servers rather than a
 * datacentre.
 *
 * THE RULES, and they are deliberately few:
 *
 *  - at least `minGapMs` between two sends to the same host,
 *  - never two sends to one host in flight at once,
 *  - a small random jitter on top, so six workers that started together do
 *    not stay locked in step and produce a visible six-request burst at every
 *    tick,
 *  - different hosts do not wait for each other at all -- the pacing is per
 *    host, not a global throttle, so a scan of thirty city sites is not
 *    silently slowed to thirty times one site's pace.
 *
 * THE CLOCK IS INJECTABLE, and that is not a testing nicety. A pacing rule is
 * a rule about *time*, and a test that asserts it by actually sleeping for
 * eight seconds is a test nobody runs. `HostGate` takes `now`/`sleep`/`random`
 * so a test can drive time by hand and assert the exact gap between two sends
 * without waiting for it.
 */
import { performance } from "node:perf_hooks";

/** A scheduler owns the send and the body lifetime of one HTTP hop. The URL is
 *  passed so a scheduler can pace per host; schedulers that do not care (the
 *  Reddit one paces a single host by construction) simply ignore it. */
export type FetchSchedule = (send: () => Promise<Response>, url: URL) => Promise<Response>;

/** Default spacing between two requests to the same host. */
export const HOST_MIN_GAP_MS = 2_000;
/** Extra random spacing on top of the minimum, to break up lockstep bursts. */
export const HOST_GAP_JITTER_MS = 750;

export type HostGateClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

type HostState = { tail: Promise<void>; lastSendAt: number };

export type HostGateOptions = {
  minGapMs?: number;
  jitterMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export class HostGate {
  private readonly states = new Map<string, HostState>();
  private readonly clock: HostGateClock;
  readonly minGapMs: number;
  readonly jitterMs: number;

  constructor(options: HostGateOptions = {}) {
    this.minGapMs = options.minGapMs ?? HOST_MIN_GAP_MS;
    this.jitterMs = options.jitterMs ?? HOST_GAP_JITTER_MS;
    this.clock = {
      now: options.now ?? (() => performance.now()),
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      random: options.random ?? Math.random,
    };
  }

  /** The gap this gate will apply to the next send after one that starts now. */
  gapForNextSend(): number {
    return this.minGapMs + this.clock.random() * this.jitterMs;
  }

  /**
   * Run `send` once the host is free and its gap has elapsed.
   *
   * Order is reserved synchronously and the queue head keeps the host until
   * `send` settles, so a host can never have two requests in flight -- which
   * is the half of "be polite" that a sleep alone does not give you.
   */
  run<T>(host: string, send: () => Promise<T>): Promise<T> {
    const key = host.toLowerCase();
    const state = this.states.get(key) ?? {
      tail: Promise.resolve(),
      // A host that has never been asked is not owed a wait.
      lastSendAt: Number.NEGATIVE_INFINITY,
    };
    this.states.set(key, state);
    const gap = this.gapForNextSend();
    const run = state.tail.then(async () => {
      const wait = state.lastSendAt + gap - this.clock.now();
      if (wait > 0) await this.clock.sleep(wait);
      let pending: Promise<T>;
      try {
        pending = send();
      } finally {
        // Measure from the moment the send starts, after any per-request
        // setup, so setup variance cannot quietly shorten the gap.
        state.lastSendAt = this.clock.now();
      }
      return pending;
    });
    state.tail = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /** The scheduler to hand to `fetchPublicHttpOnce` / `ingestUrl`. */
  get schedule(): FetchSchedule {
    return (send, url) => this.run(url.hostname, send);
  }

  /** Drop every host's remembered pace. Used when a pass ends, so the first
   *  request of the next pass is not held back by the last one of this one. */
  reset(): void {
    this.states.clear();
  }
}

export function createHostGate(options: HostGateOptions = {}): HostGate {
  return new HostGate(options);
}
