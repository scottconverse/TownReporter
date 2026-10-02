/*
  The time zone a first run should offer (auditor finding F12).

  The first-run setup form shipped `America/Denver` as its default -- the
  shipped Longmont constant, reached through `getPaperConfig`'s fallback --
  while the example text in the same box read "America/New_York". An operator
  in Ohio was shown Colorado's zone as a REAL value (not a placeholder) and a
  different zone in the example, and the only way to get their own was to
  know the IANA name and type it.

  A brand-new install's owner is at the machine the paper is being set up on,
  so the browser's own zone is the honest default. It is a machine string and
  not a town, which is why a first run may fill it while the city and state
  boxes start blank (see src/components/paper-setup-form.tsx).

  Pure and React-free so a plain node test can hold it, and so the caller can
  decide when it is safe to READ the browser (the form does it in an effect,
  never during the server render, so the markup cannot disagree with itself).
*/

/**
 * `candidate` if it is a zone this runtime understands, else "UTC".
 *
 * "UTC" rather than a guess at the operator's region: a wrong zone silently
 * stamps every future story's dateline in the wrong day, and a paper that
 * says UTC is at least telling the truth about what it was given.
 */
export function resolveDefaultTimeZone(candidate: string | null | undefined): string {
  const zone = (candidate ?? "").trim();
  if (!zone) return "UTC";
  try {
    // The only reliable validity check: construct a formatter and let it
    // throw on an unknown zone id. There is no `isValidTimeZone` API.
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/**
 * The browser's own IANA zone, or "UTC".
 *
 * Server-side (`typeof Intl`/`resolvedOptions` missing, or a runtime that
 * answers with something this engine rejects) this is "UTC", which is why no
 * caller may render its result during a server pass -- the client's answer
 * would differ and React would flag a hydration mismatch. Set it in an effect.
 */
export function browserTimeZone(): string {
  try {
    if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") return "UTC";
    return resolveDefaultTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return "UTC";
  }
}
