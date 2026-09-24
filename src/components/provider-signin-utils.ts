import { looksLikeProviderAuthFailure, providerAuthTarget } from "@/lib/news/preflight";
import type { ProviderId } from "@/lib/news/provider-login";

/** Which CLI login this error is about, or null when no button can help. */
export function signInTargetFor(detail: string | null | undefined): ProviderId | null {
  if (!looksLikeProviderAuthFailure(detail)) return null;
  const target = providerAuthTarget(detail!);
  return target === "codex" ? "codex" : target === "claude" ? "claude" : null;
}
