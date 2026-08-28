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

const SESSION_WAIT_MS = 2500;

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
  const [gaveUp, setGaveUp] = useState(false);
  const desk = useQuery({
    queryKey: ["my-desk"],
    queryFn: () => myDesk(),
    enabled: Boolean(user),
    retry: false,
  });

  useEffect(() => {
    if (user) {
      setGaveUp(false);
      return;
    }
    const t = window.setTimeout(() => setGaveUp(true), SESSION_WAIT_MS);
    return () => window.clearTimeout(t);
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
          title={copy.deskTitle}
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

  if (isPending && !gaveUp) {
    return (
      <ScreenPending
        title="Opening the desk"
        kicker="Editor desk"
        hint="If this sits here, use Sign in."
        action={<SignInLink />}
      />
    );
  }

  return <RedirectToSignIn />;
}
