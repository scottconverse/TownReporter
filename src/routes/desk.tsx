import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ScreenPending } from "@/components/states";

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

  useEffect(() => {
    if (user) {
      setGaveUp(false);
      return;
    }
    const t = window.setTimeout(() => setGaveUp(true), SESSION_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [user]);

  if (user) {
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
