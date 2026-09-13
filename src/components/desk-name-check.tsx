import { nameCheckText, readNameCheck } from "../lib/news/name-check";

export function DeskNameCheck({ research, headline, dek, body }: { research: string | null | undefined; headline: string; dek: string; body: string }) {
  const check = readNameCheck(research);
  let documentClaims: Array<{fact:string;kind:string;filename:string;locator:string;excerpt:string}> = [];
  try {
    const rows = JSON.parse(research ?? "{}").reportedDocumentClaims?.rows;
    const checkedText = JSON.parse(research ?? "{}").reportedDocumentClaims?.checkedText;
    if (checkedText === nameCheckText({headline,dek,body}) && Array.isArray(rows)) documentClaims = rows.filter(row => row && typeof row.fact === "string" && typeof row.filename === "string" && typeof row.locator === "string" && typeof row.excerpt === "string");
  } catch { /* malformed legacy research remains invisible rather than breaking the desk */ }
  const stale = Boolean(check && check.checkedText !== nameCheckText({ headline, dek, body }));
  const pending = check?.rows.filter(row => row.status === "unresolved") ?? [];
  return <section className="story-name-check" aria-label="Names and spellings">
    <h2>Names and spellings</h2>
    <p role="status">{!check ? "This draft has no recorded name check. Names copied from transcripts or OCR need confirmation against written sources." : stale ? "The story has changed since this name check. These results apply to the earlier text; review any added or changed names." : check.note}</p>
    {pending.length ? <ul>{pending.map(row => <li key={row.name}><strong>{row.name} — needs review.</strong> {row.role ? `${row.role}. ` : ""}{row.reason}</li>)}</ul> : null}
    {check?.rows.some(row => row.status !== "unresolved") ? <details><summary>Written sources and spelling corrections ({check.rows.filter(row => row.status !== "unresolved").length})</summary><ul>{check.rows.filter(row => row.status !== "unresolved").map(row => <li key={row.name}><strong>{row.status === "corrected" ? `${row.name} → ${row.spelling}` : row.name}</strong><p>{row.reason}</p>{row.evidenceKind === "uploaded-document" ? <p><strong>{row.filename}</strong>, {row.locator}</p> : <a href={row.url} target="_blank" rel="noreferrer" className="inline-link">Written source</a>}<blockquote>{row.excerpt}</blockquote></li>)}</ul></details> : null}
    {documentClaims.length ? <details><summary>Selected claims with verified uploaded passages ({documentClaims.length})</summary><p>These are exact retained passages selected during this draft pass, not an exhaustive inventory of every claim in the story.</p><ul>{documentClaims.map((row,index)=><li key={`${row.filename}-${row.locator}-${index}`}><strong>{row.fact}</strong><p>{row.filename}, {row.locator} · {row.kind}</p><blockquote>{row.excerpt}</blockquote></li>)}</ul></details> : null}
  </section>;
}
