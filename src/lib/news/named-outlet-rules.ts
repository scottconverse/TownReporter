/*
  THE RULES AN OWNER'S OUTLET LIST HAS TO PASS (0.6.63, Unit W).

  The section list (src/lib/news/sections.server.ts) validates before it
  stores, and the outlet list has the same blast radius: it decides which
  published stories the paper refuses to print while the reader is not shown
  the source. So it gets the same treatment, and the same fold -- the one the
  gate matches with, via outletNameKey in outlet-credit.ts.

  Three things are refused, and only three:

  * an outlet with no name, because the gate records overrides and refusals
    by the printed name and an unnamed row would record "".

  * two outlets the fold cannot tell apart. "Denver Post" and "DENVER POST"
    are one name; "Longmont Times-Call" and an alias "longmont times-call" are
    one name; a hyphen is kept by the fold, so that pair really does collide.
    A row repeating its own name as its own alias is NOT a collision -- that is
    the shape the shipped list uses.

  * a domain that is really a URL or is not a host at all. The gate compares
    hosts (urlIsOutletDomain strips `www.` and lowercases), so "https://x.com"
    or "x.com/news" stored as a domain would never match a source URL and would
    quietly mean "this outlet has no website". An empty domain list is fine:
    not every outlet has one.

  What is deliberately NOT refused: a name that contains another outlet's name
  as a whole run of words. The matcher's `includes` would let one body match
  both rows, which is a real (if unlikely) hazard, but refusing it would block
  a legitimate list ("Denver Post" and "Post" as two outlets is a mistake;
  "Boulder Daily Camera" and "Daily Camera" as two is a judgement call this
  editor is not entitled to make for the owner) and the owner can always see
  what each row will match. Documented, not enforced.
*/

import { NAMED_OUTLETS, outletNameKey, type NamedOutlet } from "./outlet-credit.ts";

/** Ceilings, stated once. Every one is far above the longest real value. */
export const OUTLET_LIMITS = {
  /** More rows than any town has outlets to check. */
  outlets: 100,
  /** Matches the 80 the section name field allows (sections-setup.tsx). */
  name: 80,
  alias: 80,
  /** LIMITS.url is 500; a host is far shorter than a URL. */
  domain: 200,
} as const;

export type OutletProblemField = "name" | "aliases" | "domains";

export type OutletProblem = {
  /** Which row, 0-based, in the draft the owner is looking at. */
  row: number;
  field: OutletProblemField;
  /** Shown to the owner as-is. */
  text: string;
};

/** The one domain message pair, kept here so the panel and the tests share them. */
const DOMAIN_ALONE = "Write the domain alone, without https:// or a path — like denverpost.com.";
const NOT_A_DOMAIN = "That is not a domain. Write it like denverpost.com.";

/**
 * A bare hostname, as urlIsOutletDomain will compare it: labels of letters,
 * digits and inner hyphens, at least one dot, and a letters-only last label.
 * "denverpost" is not a domain; neither is "-denverpost.com".
 */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

/** Null when the value is usable, an owner-facing sentence when it is not. */
export function domainProblem(value: string): string | null {
  const domain = value.trim();
  // No website is a real answer for an outlet, and the gate reads an empty
  // domain list as "a source URL never covers this outlet".
  if (!domain) return null;
  const lower = domain.toLowerCase();
  if (
    /^[a-z][a-z0-9+.-]*:\/\//.test(lower) ||
    /[/\\?#@:\s]/.test(domain) ||
    lower.startsWith("www.") ||
    lower.startsWith(".")
  ) {
    return DOMAIN_ALONE;
  }
  return HOST.test(lower) ? null : NOT_A_DOMAIN;
}

/**
 * Everything wrong with a draft list, in the order an owner reads it: row by
 * row, name before aliases before domains. Empty means the list can be stored.
 */
export function outletProblems(outlets: readonly NamedOutlet[]): OutletProblem[] {
  const problems: OutletProblem[] = [];
  if (outlets.length > OUTLET_LIMITS.outlets) {
    problems.push({
      row: outlets.length - 1,
      field: "name",
      text: `A list can hold up to ${OUTLET_LIMITS.outlets} outlets.`,
    });
  }

  /* Folded name or alias -> the row that claimed it. Row order decides, so the
     first row that spells it keeps it and every later row is the one refused. */
  const claimed = new Map<string, number>();

  const claim = (text: string, row: number, field: OutletProblemField) => {
    const key = outletNameKey(text);
    if (!key) return;
    const holder = claimed.get(key);
    if (holder === undefined) {
      claimed.set(key, row);
      return;
    }
    if (holder === row) return; // a row repeating its own name is not a collision
    problems.push({
      row,
      field,
      text: `Another outlet already uses "${text}". Remove it here, or change the other outlet.`,
    });
  };

  outlets.forEach((outlet, row) => {
    const name = typeof outlet?.name === "string" ? outlet.name.trim() : "";
    if (!name) {
      problems.push({ row, field: "name", text: "Give this outlet a name." });
    } else if (name.length > OUTLET_LIMITS.name) {
      problems.push({
        row,
        field: "name",
        text: `A name can be at most ${OUTLET_LIMITS.name} characters.`,
      });
    } else {
      claim(name, row, "name");
    }

    for (const raw of Array.isArray(outlet?.aliases) ? outlet.aliases : []) {
      const alias = typeof raw === "string" ? raw.trim() : "";
      // A blank alias row is ignored rather than refused: it is an empty line
      // in a text field, not a claim about an outlet.
      if (!alias) continue;
      if (alias.length > OUTLET_LIMITS.alias) {
        problems.push({
          row,
          field: "aliases",
          text: `An alias can be at most ${OUTLET_LIMITS.alias} characters.`,
        });
        continue;
      }
      claim(alias, row, "aliases");
    }

    for (const raw of Array.isArray(outlet?.domains) ? outlet.domains : []) {
      const problem = domainProblem(typeof raw === "string" ? raw : "");
      if (problem) problems.push({ row, field: "domains", text: problem });
    }
  });

  return problems;
}

/**
 * The list as it will be stored, so that what the owner typed and what the
 * gate reads are the same thing: names and aliases trimmed, hosts lowercased
 * and de-duplicated, a row listed by its name alone named by that name.
 *
 * The name is always one of the aliases -- the gate matches aliases only, so a
 * row whose alias list did not include its own name would stop matching the
 * name the owner typed.
 */
export function cleanOutletList(outlets: readonly NamedOutlet[]): NamedOutlet[] {
  const list: NamedOutlet[] = [];
  for (const outlet of outlets ?? []) {
    const name = String(outlet?.name ?? "")
      .trim()
      .slice(0, OUTLET_LIMITS.name);
    // Only reachable for a draft that was never validated; apply() runs
    // outletProblems first, so an unnamed row is refused, not dropped.
    if (!name) continue;

    const aliases: string[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(outlet?.aliases) ? outlet.aliases : []) {
      const alias = String(raw ?? "")
        .trim()
        .slice(0, OUTLET_LIMITS.alias);
      if (!alias) continue;
      const key = outletNameKey(alias);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      aliases.push(alias);
    }
    if (!seen.has(outletNameKey(name))) aliases.unshift(name);

    const domains: string[] = [];
    for (const raw of Array.isArray(outlet?.domains) ? outlet.domains : []) {
      const domain = String(raw ?? "")
        .trim()
        .toLowerCase()
        .slice(0, OUTLET_LIMITS.domain);
      if (!domain || domains.includes(domain)) continue;
      domains.push(domain);
    }

    list.push({ name, aliases, domains });
  }
  return list;
}

/**
 * The list the gate reads for a stored value: what is stored, or the shipped
 * list when nothing is (asNamedOutlets in outlet-credit.ts).
 */
export function outletListFor(stored: NamedOutlet[] | null): NamedOutlet[] {
  return stored ?? shippedOutlets();
}

/** A copy of the shipped list, so no caller can edit the constant in place. */
export function shippedOutlets(): NamedOutlet[] {
  return NAMED_OUTLETS.map((outlet) => ({
    ...outlet,
    aliases: [...outlet.aliases],
    domains: [...outlet.domains],
  }));
}
