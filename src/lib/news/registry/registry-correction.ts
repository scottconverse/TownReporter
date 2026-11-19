/**
 * The text a registry page puts in `/corrections?article=...` (Phase 4, P4-4).
 *
 * `/corrections` keeps at most 2000 characters of `article`, so the text is cut
 * here, in the name part, and the service URL at the end is kept whole: a
 * correction that arrives without its link cannot be traced to the entry.
 */

export const CORRECTION_ARTICLE_MAX = 2000;

export function registryCorrectionArticle(input: {
  id: number;
  organizationName: string;
  serviceName: string;
  /** The full URL of `/registry/<id>`, or its path when the origin is unknown. */
  url: string;
}): string {
  const suffix = ` (${input.url})`;
  const head = `Community resource ${input.id}: ${input.organizationName} — ${input.serviceName}`;
  if (head.length + suffix.length <= CORRECTION_ARTICLE_MAX) return `${head}${suffix}`;
  const room = CORRECTION_ARTICLE_MAX - suffix.length - 1;
  if (room < 1) return `${head}${suffix}`.slice(0, CORRECTION_ARTICLE_MAX);
  return `${head.slice(0, room)}…${suffix}`;
}

export function registryServicePath(id: number): string {
  return `/registry/${id}`;
}

export function registryCorrectionHref(article: string): string {
  return `/corrections?article=${encodeURIComponent(article)}`;
}
