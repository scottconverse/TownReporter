import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ScreenPending, EmptyState } from "@/components/states";
import { myDesk } from "@/lib/news/claim";
import { deskTakenLoginCopy } from "@/lib/news/desk-copy";

export const Route = createFileRoute("/desk")({
  component: DeskGate,
});

/*
  How long the desk waits before OFFERING a way out -- never before taking
  one. This used to be two numbers: a 1200ms hint and a 2500ms SESSION_WAIT_MS
  after which the route stopped showing the pending screen and rendered
  RedirectToSignIn, sending the visitor to /login on the theory that a session
  which had not resolved in two and a half seconds was not coming.

  It comes. `useSession` clears isPending when the request settles, success or
  failure, so a still-pending session is a slow answer, not a missing one --
  and on a cold server on a two-core box /api/auth/get-session past 2500ms is
  ordinary. Because /login sends a signed-in owner to /desk, and /desk sends an
  owner who has not finished first-run setup to /desk/setup, that guess put the
  browser in a loop that landed back on a BLANK setup form. It is one of the
  two timers that cost four browser walks on 2026-09-02 (the other is the
  inline fallback in __root.tsx, which for the same reason no longer navigates
  either -- see the comment there).

  So the route decides on the session and nothing else: pending means wait,
  resolved-and-empty means signed out. The timer only decides when to put a
  Sign in link on the waiting screen, which costs a visitor nothing if it is
  wrong.
*/
const SIGN_IN_OFFER_MS = 1200;

function SignInLink() {
  return (
    <a
      href="/login"
      className="pressable inline-flex min-h-11 items-center justify-center border border-ink bg-paper px-4 text-sm hover:bg-paper-2"
    >
      Sign in
    </a>
  );
}

function DeskGate() {
  const { user, isPending } = useCurrentUserState();
  /*
    The sign-in remedy waits a beat before it appears.

    Measured on this screen (QA-002, frame-by-frame over three navigations):
    a signed-in editor going straight to a desk route saw "Opening the desk
    -- If this sits here, use Sign in" for about 150ms every time. The
    session resolves in a blink, so the offer was advice to fix a problem
    that had not happened, shown to someone already signed in. Nothing was
    broken; the copy was just faster than the truth. Below the threshold the
    screen simply says it is opening.
  */
  const [slowEnoughToOfferSignIn, setSlowEnoughToOfferSignIn] = useState(false);
  const desk = useQuery({
    queryKey: ["my-desk"],
    queryFn: () => myDesk(),
    enabled: Boolean(user),
    retry: false,
  });

  useEffect(() => {
    if (user) return;
    const hint = window.setTimeout(
      () => setSlowEnoughToOfferSignIn(true),
      SIGN_IN_OFFER_MS,
    );
    return () => window.clearTimeout(hint);
  }, [user]);

  if (user) {
    if (desk.isPending) {
      return (
        <ScreenPending
          title="Opening the desk"
          kicker="Editor desk"
          hint="Checking this newsroom…"
        />
      );
    }
    const taken = desk.data && !desk.data.ok && desk.data.claimed;
    if (taken) {
      const copy = deskTakenLoginCopy();
      return (
        <EmptyState
          kicker="Editor desk"
          title={copy.title}
          body={copy.body}
          action={
            <span className="flex flex-wrap gap-2">
              <Link
                to="/"
                className="pressable inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-4 text-sm text-paper"
              >
                Back to the paper
              </Link>
              <button
                type="button"
                className="pressable inline-flex min-h-11 items-center justify-center border border-ink bg-paper px-4 text-sm hover:bg-paper-2"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </span>
          }
        />
      );
    }
    return (
      <div className="min-h-dvh">
        <Outlet />
      </div>
    );
  }

  if (isPending) {
    return (
      <ScreenPending
        title="Opening the desk"
        kicker="Editor desk"
        hint={slowEnoughToOfferSignIn ? "If this sits here, use Sign in." : undefined}
        action={slowEnoughToOfferSignIn ? <SignInLink /> : undefined}
        awaitingSession
      />
    );
  }

  return <RedirectToSignIn />;
}
