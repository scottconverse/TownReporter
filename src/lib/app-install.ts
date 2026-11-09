/**
 * "Put the paper on your phone" -- what the install bar says, and the browser's
 * one-shot install prompt kept somewhere a component can find it.
 *
 * The bar's whole job is to tell a reader on a phone, in the few seconds before
 * they scroll, that this page can live on their home screen. What it can say
 * depends on the device, and the decision is a pure function
 * (`installBarMode`) so it can be tested without a browser: a Chromium browser
 * that has already offered an install prompt gets a button, an iPhone (which
 * has no prompt) gets the two taps Safari actually needs, and any other phone
 * gets a pointer to the browser menu.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

/** The one prompt Chrome fires on a phone, before the reader can click anything. */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallBarMode = "install" | "ios-steps" | "android-steps" | "none";

export type InstallBarInput = {
  userAgent: string;
  maxTouchPoints: number;
  /** Already running from the home screen: `display-mode: standalone` or iOS's own flag. */
  standalone: boolean;
  /** The reader dismissed the bar on this phone before. */
  closed: boolean;
  /** A `beforeinstallprompt` event is in hand and can be replayed. */
  hasPrompt: boolean;
};

/** Where the reader's dismissal is remembered, per origin. */
export const INSTALL_BAR_CLOSED_KEY = "tr-install-bar-closed";

/**
 * iPadOS 13 and later report a desktop Macintosh user agent. The only thing
 * that tells an iPad from a Mac is that it has a touch screen, so a "Mac" with
 * more than one touch point is an iPad.
 */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function isAndroidDevice(userAgent: string): boolean {
  return /Android/i.test(userAgent);
}

/**
 * What the bar should show, or `none` for every screen that is not a phone and
 * for a phone that has already installed the paper or closed the bar.
 */
export function installBarMode({
  userAgent,
  maxTouchPoints,
  standalone,
  closed,
  hasPrompt,
}: InstallBarInput): InstallBarMode {
  if (closed || standalone) return "none";
  if (isIosDevice(userAgent, maxTouchPoints)) return "ios-steps";
  if (isAndroidDevice(userAgent)) return hasPrompt ? "install" : "android-steps";
  return "none";
}

/*
  The prompt, saved at the one moment it exists.

  `beforeinstallprompt` fires once, early -- usually before the story component
  has mounted -- and a browser keeps the event usable only if it was
  `preventDefault()`ed when it fired. So __root.tsx saves it here, and the bar
  and the Get the app page read it later. `appinstalled` clears it, because a
  prompt that has already been accepted cannot be shown again.
*/
let savedPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

export function rememberInstallPrompt(event: InstallPromptEvent): void {
  savedPrompt = event;
  announce();
}

export function savedInstallPrompt(): InstallPromptEvent | null {
  return savedPrompt;
}

export function clearInstallPrompt(): void {
  if (!savedPrompt) return;
  savedPrompt = null;
  announce();
}

/** For `useSyncExternalStore`: the bar re-renders the moment the prompt arrives. */
export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasInstallPrompt(): boolean {
  return savedPrompt !== null;
}

/**
 * Replay the saved prompt. The browser shows its own install sheet; whatever
 * the reader chooses, this event is spent, so it is cleared either way. The
 * returned outcome is `"unavailable"` when there was nothing to replay or the
 * browser refused, so a caller can keep the bar up in that case.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = savedPrompt;
  if (!event) return "unavailable";
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    return "unavailable";
  } finally {
    clearInstallPrompt();
  }
}

/** True when the reader is in the installed app, not a browser tab. */
export function isStandaloneNow(): boolean {
  if (typeof window === "undefined") return false;
  const iosFlag = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  if (iosFlag === true) return true;
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

/** The dismissal flag. Storage can throw (private mode, blocked cookies); that is not a failure. */
export function readInstallBarClosed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(INSTALL_BAR_CLOSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberInstallBarClosed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INSTALL_BAR_CLOSED_KEY, "1");
  } catch {
    /* the bar still hides for this page view; see InstallBar */
  }
}

/** Everything `installBarMode` needs, read from the browser in one place. */
export function currentInstallBarMode(): InstallBarMode {
  if (typeof window === "undefined") return "none";
  return installBarMode({
    userAgent: window.navigator.userAgent,
    maxTouchPoints: window.navigator.maxTouchPoints,
    standalone: isStandaloneNow(),
    closed: readInstallBarClosed(),
    hasPrompt: hasInstallPrompt(),
  });
}

/** True once the browser has handed us an install prompt that can still be shown. */
export function useInstallPrompt(): boolean {
  return useSyncExternalStore(subscribeInstallPrompt, hasInstallPrompt, () => false);
}

/**
 * The bar's decision, made after mount.
 *
 * The server and the first client render both see `mounted: false`, so the bar
 * never appears in HTML that a browser then re-renders differently -- the
 * device, the storage and the prompt are all things only the browser knows.
 */
export function useInstallBarMode(): { mounted: boolean; mode: InstallBarMode } {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<InstallBarMode>("none");
  const hasPrompt = useInstallPrompt();

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted) setMode(currentInstallBarMode());
  }, [mounted, hasPrompt]);

  return { mounted, mode };
}
