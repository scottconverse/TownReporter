import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { inputClass } from "@/components/desk-chrome-utils";
import { inkGhost, inkSolid } from "@/components/desk-chrome-utils";
import { usePaper } from "@/lib/paper-context-state";
import {
  acceptEditorInvite,
  claimDeskWithCode,
  deskClaimState,
  inviteState,
  redeemMyRecoveryCode,
} from "@/lib/news/claim";
import { deskTakenLoginCopy } from "@/lib/news/desk-copy";
import { FormError } from "@/components/form-error";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { invite?: string } => ({
    invite: typeof s.invite === "string" && s.invite ? s.invite : undefined,
  }),
  component: Login,
});

function failMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

function looksLikeMissingAccount(message: string) {
  return /invalid email or password|invalid credentials|user not found|invalid password/i.test(
    message,
  );
}

function looksLikeExistingAccount(message: string) {
  return /already|exist|been registered/i.test(message);
}

function Login() {
  const PAPER = usePaper();
  const { user } = useCurrentUserState();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [wantCreate, setWantCreate] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  // Unit CJ (0.6.80): the first-owner setup code. Only rendered/required when
  // `claim.data.tokenRequired` is true -- a fresh install with a pending
  // code. An install that already has an owner never shows this field.
  const [setupCode, setSetupCode] = useState("");
  const claim = useQuery({ queryKey: ["desk-claim"], queryFn: () => deskClaimState() });
  const claimed = claim.isError || Boolean(claim.data?.claimed);
  /*
    An invite link opens the create door through the claimed-desk wall for
    exactly one address (v0.5.3). The token is validated server-side; a dead
    link degrades to plain sign-in with the reason shown.
  */
  const { invite } = Route.useSearch();
  const inviteQ = useQuery({
    queryKey: ["invite", invite],
    queryFn: () => inviteState({ data: invite! }),
    enabled: Boolean(invite),
    staleTime: 60_000,
  });
  const invited = Boolean(invite && inviteQ.data?.ok);
  const invitedEmail = inviteQ.data?.ok ? inviteQ.data.email : "";
  useEffect(() => {
    if (invitedEmail) setEmail(invitedEmail);
  }, [invitedEmail]);
  const mode: "create" | "signin" = invited
    ? "create"
    : claimed
      ? "signin"
      : wantCreate
        ? "create"
        : "signin";
  const taken = deskTakenLoginCopy();
  /*
    Waiting has to end in an answer, not in "Opening..." forever.

    When the client bundle failed to hydrate, this page sat on generic progress
    copy indefinitely: no timeout, no error, no retry, no way to tell a slow
    newsroom from a broken one. An audit called it a dead end (UIUX-02), and it
    is the screen where the dev-path Blocker actually showed itself — a
    permanent spinner reads as patience required rather than as a defect.

    Ten seconds is generous for a local query and short enough that nobody
    waits wondering.
  */
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  useEffect(() => {
    if (!claim.isPending) {
      setWaitedTooLong(false);
      return;
    }
    const t = window.setTimeout(() => setWaitedTooLong(true), 10_000);
    return () => window.clearTimeout(t);
  }, [claim.isPending]);

  /*
    These hooks sit ABOVE the early return on purpose.

    I first wrote them below it, where the Navigate short-circuits the render —
    so on the branch that returns early React saw fewer hooks than the previous
    render and threw error #300. Nothing in the desk noticed; the e2e walk
    written for TE-04 caught it on the very first run, tagged to /login.

    That is the whole argument for the walk existing.
  */
  /*
    Unit CR (0.6.81): the redirect waits for the desk to actually be claimed.

    This guard used to fire on the session alone (`user && !claim.isPending`),
    and that is what stranded the owner whose setup code was wrong: the account
    is created before the claim is attempted, so the refusal arrives with a live
    session and an unclaimed desk. The guard fired in the same render that
    showed the error, unmounting the error, the setup field and the typed
    address together -- and /desk refuses an unclaimed owner, so the browser
    bounced straight back here, which redirected again. A loop with no screen
    on which to retype the code.

    An unclaimed desk with a session is not a visitor to send onward; it is an
    owner mid-claim, and this form is the only place that claim can be retried
    (see `onEmailSignUp`). Every other arrival -- an owner revisiting /login, an
    invited editor, a dev-fallback user -- is claimed, and redirects as before.
  */
  if (user && !claim.isPending && claimed) return <Navigate to="/desk" />;

  async function finishEmail() {
    await authClient.getSession();
    if (invited && invite) {
      // Burn the invite and take the editor seat before the desk asks who we are.
      const seated = await acceptEditorInvite({ data: invite });
      if (!seated.ok) {
        setBusy(null);
        setError(seated.error);
        return;
      }
    } else if (!claimed) {
      // Covers both a fresh signup AND the documented retry path ("submit
      // again with the same email and password" after a signup whose claim
      // call did not complete) -- either way the desk is still unclaimed, so
      // this is the explicit, code-checked attempt to claim it.
      /*
        Unit CJ (0.6.80): the desk no longer auto-claims itself just because
        an account was created and the account fell through to /desk --
        `requireEditor` refuses to hand out an owner while a setup code is
        pending. This is the one explicit call allowed to claim through that
        gate (or, when no code is pending -- every existing install -- to
        claim exactly as before).
      */
      const claimResult = await claimDeskWithCode({ data: setupCode });
      if (!claimResult.ok) {
        setBusy(null);
        setError(claimResult.error);
        return;
      }
    }
    await qc.invalidateQueries({ queryKey: ["desk-claim"] });
    await qc.invalidateQueries({ queryKey: ["my-desk"] });
    await navigate({ to: "/desk" });
  }

  async function onEmailSignIn() {
    setError(null);
    setBusy("email-in");
    try {
      const { error: authError } = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (authError) throw new Error(authError.message ?? "Sign-in failed");
      await finishEmail();
    } catch (err) {
      setBusy(null);
      const raw = failMessage(err, "Sign-in failed");
      /*
        UX-2: on a claimed desk one line covers a wrong password and an address
        that is not on this desk. The desk never says whether the email exists,
        and it never tells the owner their own account is gone (see
        `deskTakenLoginCopy().signInFailed`).
      */
      setError(
        looksLikeMissingAccount(raw)
          ? claimed
            ? taken.signInFailed
            : "No editor account with that email yet. Use Create editor account — this password is the one you set on this desk."
          : raw,
      );
    }
  }

  async function onEmailSignUp() {
    setError(null);
    if (claimed && !invited) {
      setError(taken.api);
      return;
    }
    /*
      Unit CR (0.6.81): already signed in, desk still unclaimed -- this submit
      is a CLAIM RETRY, not a signup.

      It is the state a wrong setup code leaves behind (the account is created
      first, the claim is attempted after), and the state a reload during that
      refusal leaves behind. The account exists and the session is live, so
      there is nothing to sign up for: the one thing missing is the code. The
      password fields may well be empty by now -- they were only ever proof for
      a signup that has already happened -- so this branch is checked before
      them, and retries the claim with whatever code is in the field. Re-running
      signup here instead would fail with "account exists", fall into
      `onEmailSignIn`, and take a different path than the one under test.
    */
    if (user) {
      if (claim.data?.tokenRequired && !invited && setupCode.trim().length === 0) {
        setError("Enter the setup code printed when this desk was installed.");
        return;
      }
      setBusy("email-up");
      try {
        await finishEmail();
      } catch (err) {
        setBusy(null);
        setError(failMessage(err, "Could not claim the desk"));
      }
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (claim.data?.tokenRequired && !invited && setupCode.trim().length === 0) {
      setError("Enter the setup code printed when this desk was installed.");
      return;
    }
    setBusy("email-up");
    try {
      const display = name.trim() || email.trim().split("@")[0] || "Editor";
      const { error: authError } = await authClient.signUp.email({
        email: email.trim(),
        password,
        name: display,
      });
      if (authError) {
        const message = authError.message ?? "Could not create that account";
        if (looksLikeExistingAccount(message)) {
          await onEmailSignIn();
          return;
        }
        throw new Error(message);
      }
      await finishEmail();
    } catch (err) {
      setBusy(null);
      setError(failMessage(err, "Could not create that account"));
    }
  }

  const stalled = claim.isError || waitedTooLong;

  const heading = stalled
    ? "The desk did not answer"
    : claim.isPending
      ? "Editor desk"
      : invited
        ? "You're invited to this desk"
        : mode === "create"
          ? "Create the desk"
          : taken.title;
  const blurb = stalled
    ? "This page could not reach the newsroom. That is usually the server being down or still starting; it can also mean the page failed to load properly. Try again, and if it keeps happening check the server is running."
    : claim.isPending
    ? "One moment."
    : invited
      ? `The owner invited ${invitedEmail} to edit this paper. Set a password and you are in. The link works once.`
      : mode === "create"
        ? "First person in owns the newsroom. If you already created an account, submit again with the same email and password — we will sign you in."
        : claimed
          ? taken.body
          : "Sign in with the password you set for this desk.";

  return (
    <main
      className="r2-login min-h-dvh bg-paper text-ink"
    >
      <header className="r2-login-masthead">
        <Link to="/" className="r2-login-brand">{PAPER.name}</Link>
        <span>Editor desk</span>
      </header>
      <div className="r2-login-panel stagger-in space-y-5">
        {stalled ? (
          <p role="alert" className="border border-danger/35 bg-paper-2 px-3 py-2.5 text-sm text-danger">
            {claim.isError ? "The newsroom refused the request." : "No answer after ten seconds."}{" "}
            <button
              type="button"
              className={inkGhost}
              onClick={() => {
                setWaitedTooLong(false);
                void claim.refetch();
              }}
            >
              Try again
            </button>
          </p>
        ) : null}
        <div>
          <p className="r2-login-kicker">Editor access</p>
          <h1 className="mt-2 font-display text-3xl font-semibold">{heading}</h1>
          {!claim.isPending && !claimed && !invited ? (
            <section className="r2-first-owner" aria-label="First owner">
              <h2>First owner</h2>
              <p>First person in owns the newsroom.</p>
              <details><summary className="r2-login-quiet">About creating the desk</summary><p>{blurb}</p></details>
            </section>
          ) : <p className="mt-2 text-sm text-muted">{blurb}</p>}
        </div>
        {invite && inviteQ.data && !inviteQ.data.ok ? (
          <p className="border border-rust/40 bg-paper-2 px-3 py-2 text-sm text-ink">
            {inviteQ.data.reason} You can still sign in below if you already have an account.
          </p>
        ) : null}
        {error ? (
          // UX-3: announced. This is the line "Passwords do not match.", "Wrong
          // setup code." and every failed sign-in arrive on -- it used to be a
          // plain paragraph, so a screen reader was told nothing at all. The
          // class is the one it already had.
          <FormError className="border border-rust/40 bg-paper-2 px-3 py-2 text-sm text-ink">
            {error}
          </FormError>
        ) : null}

        {claim.isPending ? (
          <p className="text-sm text-muted">Opening…</p>
        ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === "create") void onEmailSignUp();
            else void onEmailSignIn();
          }}
        >
          {mode === "create" ? (
            <label className="block text-sm">
              Name
              <input
                className={inputClass + " mt-1"}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Masthead or editor name"
              />
            </label>
          ) : null}
          <label className="block text-sm">
            Email
            <input
              className={inputClass + " mt-1"}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              // The invite is issued to one address; the field says so.
              readOnly={invited}
              aria-describedby={invited ? "invite-lock" : undefined}
            />
            {invited ? (
              <span id="invite-lock" className="mt-1 block text-xs text-muted">
                The invite was issued to this address.
              </span>
            ) : null}
          </label>
          <label className="block text-sm">
            Password
            <input
              className={inputClass + " mt-1"}
              type="password"
              required
              minLength={8}
              autoComplete={mode === "create" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {mode === "create" ? (
            <label className="block text-sm">
              Confirm password
              <input
                className={inputClass + " mt-1"}
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          ) : null}
          {mode === "create" && !invited && claim.data?.tokenRequired ? (
            <label className="block text-sm">
              Setup code
              <input
                className={inputClass + " mt-1"}
                autoComplete="off"
                autoCapitalize="characters"
                required
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                aria-describedby="setup-code-hint"
              />
            </label>
          ) : null}
          {mode === "create" && !invited && claim.data?.tokenRequired ? (
            // Kept OUTSIDE the <label> above on purpose: text inside a
            // <label> becomes part of the field's accessible name, which
            // would make `getByLabel("Setup code", { exact: true })` -- the
            // same lookup the walk scripts and this file's own tests use --
            // stop matching. `aria-describedby` still associates it for
            // assistive tech, same shape as the invite email hint above.
            <span id="setup-code-hint" className="-mt-1.5 block text-xs text-muted">
              Printed once at install, in the server log and in the data
              folder&rsquo;s <code>logs/SETUP-CODE.txt</code>.
            </span>
          ) : null}
          <p className="text-xs text-muted">At least 8 characters. Stored only on this desk.</p>
          <div className="flex flex-col gap-2">
            <button type="submit" disabled={busy !== null} className={inkSolid}>
              {mode === "create"
                ? busy === "email-up" || busy === "email-in"
                  ? "Opening the desk…"
                  : "Create editor account"
                : busy === "email-in"
                  ? "Signing in…"
                  : "Sign in with email"}
            </button>
            {claimed ? null : (
            <button
              type="button"
              disabled={busy !== null}
              className={inkGhost}
              onClick={() => {
                setError(null);
                setWantCreate(!wantCreate);
              }}
            >
              {mode === "create" ? "I already have an account" : "Create an editor account"}
            </button>
            )}
          </div>
        </form>
        )}

        {mode === "signin" && !claim.isPending ? <RecoveryCodeSignIn /> : null}

        <Link
          to="/"
          className="inline-flex min-h-11 items-center text-sm text-muted underline"
        >
          Back to the paper
        </Link>
      </div>
    </main>
  );
}

/**
 * "I lost this setup code" for the owner who cannot sign in at all any more
 * (Unit CJ, 0.6.80). Deliberately unauthenticated on the server side --
 * `redeemMyRecoveryCode` -- because signing in is exactly what this screen
 * exists for when it is impossible. Success sets a one-time temporary
 * password on the owner's own account and shows it once; it does not sign
 * anyone in automatically.
 */
function RecoveryCodeSignIn() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        className={inkGhost}
        onClick={() => setOpen(true)}
      >
        Lost your password? Use a recovery code.
      </button>
    );
  }

  return (
    <div className="space-y-2 border-t border-rule pt-4">
      <p className="text-[11px] tracking-[0.14em] text-muted">Recovery code</p>
      {tempPassword ? (
        <div className="border border-rule bg-paper-2 p-3 text-sm">
          {/*
            UX-3: `status`, not `alert` -- this reveal is the way back in, not a
            failure. Same class situation as before: none was set, so none is
            passed.
          */}
          <FormError role="status">
            One-time temporary password: <span className="font-mono">{tempPassword}</span>
          </FormError>
          <p className="mt-2 text-muted">
            Sign in with it above, then change your password from the desk.
          </p>
        </div>
      ) : (
        <>
          <label className="block text-sm">
            Recovery code
            <input
              className={inputClass + " mt-1"}
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX"
            />
          </label>
          {/* UX-3: a refused recovery code is a failure, so it is announced. */}
          {error ? <FormError className="text-sm text-rust">{error}</FormError> : null}
          <button
            type="button"
            disabled={busy || !code.trim()}
            className={inkGhost}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const result = await redeemMyRecoveryCode({ data: code });
                if (!result.ok) {
                  setError(result.error);
                } else {
                  setTempPassword(result.tempPassword);
                }
              } catch (err) {
                setError(failMessage(err, "That did not work."));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Checking…" : "Use this code"}
          </button>
        </>
      )}
    </div>
  );
}
