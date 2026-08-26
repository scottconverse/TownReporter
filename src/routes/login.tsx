import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { inkGhost, inkSolid, inputClass } from "@/components/desk-chrome";
import { PAPER } from "@/lib/paper";

export const Route = createFileRoute("/login")({ component: Login });

/** Must match `BEARER_KEY` in `@/lib/auth/client` — preview iframe can't read cookies. */
const PREVIEW_BEARER_KEY = "grok-auth.bearer-token";

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

function storePreviewBearer(token: string | null | undefined) {
  if (!token || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PREVIEW_BEARER_KEY, token);
  } catch {
    /* storage blocked */
  }
}

function tokenFromResult(data: unknown, headers?: Headers | null) {
  const headerToken = headers?.get("set-auth-token");
  if (headerToken) return headerToken;
  if (data && typeof data === "object" && "token" in data) {
    const token = (data as { token?: unknown }).token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

function Login() {
  const { user } = useCurrentUserState();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"create" | "signin">("create");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  if (user) return <Navigate to="/desk" />;

  async function finishEmail(data?: unknown, headers?: Headers | null) {
    storePreviewBearer(tokenFromResult(data, headers));
    await authClient.getSession();
    await navigate({ to: "/desk" });
  }

  async function onEmailSignIn() {
    setError(null);
    setBusy("email-in");
    try {
      let headerBag: Headers | null = null;
      const { data, error: authError } = await authClient.signIn.email({
        email: email.trim(),
        password,
        fetchOptions: {
          onSuccess(ctx) {
            headerBag = ctx.response.headers;
          },
        },
      });
      if (authError) throw new Error(authError.message ?? "Sign-in failed");
      await finishEmail(data, headerBag);
    } catch (err) {
      setBusy(null);
      const raw = failMessage(err, "Sign-in failed");
      setError(
        looksLikeMissingAccount(raw)
          ? "No editor account with that email yet. Use Create editor account — this is not your Grok password."
          : raw,
      );
    }
  }

  async function onEmailSignUp() {
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy("email-up");
    try {
      let headerBag: Headers | null = null;
      const display = name.trim() || email.trim().split("@")[0] || "Editor";
      const { data, error: authError } = await authClient.signUp.email({
        email: email.trim(),
        password,
        name: display,
        fetchOptions: {
          onSuccess(ctx) {
            headerBag = ctx.response.headers;
          },
        },
      });
      if (authError) {
        const message = authError.message ?? "Could not create that account";
        if (looksLikeExistingAccount(message)) {
          await onEmailSignIn();
          return;
        }
        throw new Error(message);
      }
      await finishEmail(data, headerBag);
    } catch (err) {
      setBusy(null);
      setError(failMessage(err, "Could not create that account"));
    }
  }

  return (
    <main
      className="grid min-h-dvh place-items-center bg-paper px-6 py-10 text-ink"
      style={{ background: "#F6F1E7", color: "#1C1410", minHeight: "100dvh" }}
    >
      <div className="stagger-in w-full max-w-sm space-y-5">
        <div>
          <p className="text-[11px] tracking-[0.18em] text-rust uppercase">
            {PAPER.name}
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold">
            {mode === "create" ? "Create the desk" : "Editor sign-in"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {mode === "create"
              ? "First person in owns the newsroom. If you already created an account, submit again with the same email and password — we will sign you in."
              : "Sign in with the password you set for this desk."}
          </p>
        </div>
        {error ? (
          <p className="border border-rust/40 bg-paper-2 px-3 py-2 text-sm text-ink">
            {error}
          </p>
        ) : null}

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
            />
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
            <button
              type="button"
              disabled={busy !== null}
              className={inkGhost}
              onClick={() => {
                setError(null);
                setMode(mode === "create" ? "signin" : "create");
              }}
            >
              {mode === "create" ? "I already have an account" : "Create an editor account"}
            </button>
          </div>
        </form>

        {authEnabled ? (
          <div className="space-y-2 border-t border-rule pt-4">
            <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
              Or a small window
            </p>
            {GROK_PROVIDERS.map((p) => (
              <button
                key={p.providerId}
                type="button"
                disabled={busy !== null}
                className="pressable w-full min-h-11 border border-ink bg-paper px-4 text-sm hover:bg-paper-2 disabled:cursor-wait disabled:opacity-60"
                onClick={() => {
                  setError(null);
                  setBusy(p.providerId);
                  void signIn(p.providerId, { callbackURL: "/desk" }).catch(
                    (err: unknown) => {
                      setBusy(null);
                      setError(
                        failMessage(
                          err,
                          "Sign-in failed. Allow pop-ups and try again.",
                        ),
                      );
                    },
                  );
                }}
              >
                {busy === p.providerId
                  ? "Opening sign-in…"
                  : `Continue with ${p.label}`}
              </button>
            ))}
          </div>
        ) : null}

        <Link
          to="/"
          className="inline-flex min-h-11 items-center text-sm text-muted transition-[color] duration-150 ease-out hover:text-ink"
        >
          Back to the paper
        </Link>
      </div>
    </main>
  );
}
