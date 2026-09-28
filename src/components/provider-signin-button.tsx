/**
 * "Sign in to Claude Code" / "Sign in to Codex", on the error that says so.
 *
 * A failed draft used to end at a sentence — "Claude Code needs you to sign in
 * again" — with no way to act on it from the desk. The editor had to know that
 * meant a terminal. This is the button that closes that loop: it starts the
 * CLI's own headless login and sends the editor to the panel, where the link and
 * the countdown live.
 *
 * Unit CX2 moved that panel: the sign-in control is on the Writing models
 * screen (`/desk/ops/writing-models`), not on the Server page, which now draws
 * that card as a summary with a door. The button follows the control, because
 * landing on a page of twelve summaries and having to pick the right card is
 * the same dead end this button was built to close.
 *
 * It renders nothing unless the error really is a lapsed CLI login, and nothing
 * for an ANTHROPIC_API_KEY rejection — a bad key is edited in a file, not signed
 * in to, and a button that cannot help is the bug this whole feature is fixing.
 */
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import { startProviderLogin, type ProviderId } from "@/lib/news/provider-login";
import { signInTargetFor } from "@/components/provider-signin-utils";

const LABEL: Record<ProviderId, string> = {
  claude: "Sign in to Claude Code",
  codex: "Sign in to Codex",
};

export function ProviderSignInButton({ detail }: { detail: string | null | undefined }) {
  const navigate = useNavigate();
  const provider = signInTargetFor(detail);

  const start = useMutation({
    mutationFn: (p: ProviderId) => startProviderLogin({ data: p }),
    /*
      Go to the panel either way. A refusal (not the owner, rate limited) is
      shown there in full, and a button that silently does nothing on failure
      is worse than one that hands over to the page that can explain.
    */
    onSettled: () => {
      void navigate({
        to: "/desk/ops/$card",
        params: { card: "writing-models" },
        search: { signin: provider ?? undefined },
      });
    },
  });

  if (!provider) return null;
  return (
    <span className="mt-3 block">
      <InkButton small disabled={start.isPending} onClick={() => start.mutate(provider)}>
        {start.isPending ? "Starting…" : LABEL[provider]}
      </InkButton>
    </span>
  );
}
