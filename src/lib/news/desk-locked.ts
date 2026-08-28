/** Locked Design strings for 0.4.3. Re-exported from desk-copy. */

export function unclaimedLoginCopy() {
  return {
    title: "Create editor",
    submit: "Create editor",
    ghost: "I already have an account",
  };
}

export function claimedLoginCopy() {
  return {
    title: "Editor sign-in",
    submit: "Sign in with email",
  };
}

export function deskTakenPageCopy() {
  return {
    title: "This desk is taken",
    body: "This desk already has an editor. Sign in if that's you. Anyone can read the paper without an account.",
  };
}

export function themeCopy() {
  return {
    day: "Day desk",
    night: "Night desk",
    aria: "Day desk or night desk",
  };
}

export function firstRunCopy() {
  return {
    band: "You own this desk. The Longmont watch list is already seeded.",
    primary: "Run the first scan",
    secondary: "File a lead",
    tertiary: "View paper",
  };
}

export function setupTokenPlaceholder() {
  return "Paste the token the operator gave you";
}

export function queueFilterLabels() {
  return {
    all: "All",
    new: "New",
    drafted: "Drafted",
    held: "Held",
    killed: "Killed",
  } as const;
}

/** Same locked strings; name a parallel login.tsx already imports. */
export function createEditorLoginCopy() {
  const u = unclaimedLoginCopy();
  return {
    title: u.title,
    submit: u.submit,
    ghost: u.ghost,
    reverseGhost: u.submit,
    setupPlaceholder: setupTokenPlaceholder(),
    missingEmail:
      "No editor account with that email yet. Use Create editor — this is not your Grok password.",
  };
}
