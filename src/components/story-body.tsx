import type { ReactNode } from "react";
function Inline({ text, publicReading = false }: { text: string; publicReading?: boolean }) {
  const nodes: ReactNode[] = [];
  /*
    Group order matters, and so does what each alternative refuses to match:

    - `**bold**` is tried before single-asterisk italic, or `**` would be read
      as an empty italic phrase.
    - a `*`/`_` pair only counts as emphasis when it hugs its text on both
      sides (`*word*`, never `5 * 3`), which is also what stops arithmetic and
      spaced-out asterisks being swallowed.
    - `_` is only emphasis when it is not inside a word, so `source_kind`
      survives.
  */
  const re = publicReading
    ? /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*(.+?)\*\*|\*([^\s*](?:[^*\n]*[^\s*])?)\*|(?<![A-Za-z0-9])_([^\s_](?:[^_\n]*[^\s_])?)_(?![A-Za-z0-9])|(https?:\/\/[^\s<>]+)/g
    : /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*(.+?)\*\*|\*([^\s*](?:[^*\n]*[^\s*])?)\*|(?<![A-Za-z0-9])_([^\s_](?:[^_\n]*[^\s_])?)_(?![A-Za-z0-9])/g;
  let last = 0,
    k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] && m[2])
      nodes.push(
        <a key={k++} href={m[2]} className="text-rust underline" target="_blank" rel="noreferrer">
          {m[1]}
        </a>,
      );
    else if (m[3]) nodes.push(<strong key={k++}>{m[3]}</strong>);
    else if (m[4]) nodes.push(<em key={k++}>{m[4]}</em>);
    else if (m[5]) nodes.push(<em key={k++}>{m[5]}</em>);
    else if (m[6]) {
      const url = m[6].replace(/[.,;:)]+$/, "");
      nodes.push(
        <a key={k++} href={url} className="text-rust underline" target="_blank" rel="noreferrer">
          {url}
        </a>,
      );
      nodes.push(m[6].slice(url.length));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : text;
}
export function StoryBody({
  body,
  publicReading = false,
}: {
  body: string;
  publicReading?: boolean;
}) {
  const blocks = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  let claimsUsed = false;
  return (
    <div className="space-y-4 text-[1.05rem] leading-7 text-ink-2">
      {blocks.map((block, i) => {
        const heading = block
          .replace(/^#{1,3}\s+/, "")
          .replace(/^\*\*|\*\*$/g, "")
          .trim();
        const claims = publicReading && !claimsUsed && /^claims and sources\s*:?$/i.test(heading);
        if (claims) claimsUsed = true;
        if (block.startsWith("## ") || claims)
          return (
            <h2
              key={i}
              id={claims ? "claims" : undefined}
              className="font-display text-xl font-semibold text-ink"
            >
              <Inline text={claims ? heading : block.slice(3)} publicReading={publicReading} />
            </h2>
          );
        // `- item` and `* item` are both bullets (the same two markers the
        // drafting prompts use); a `*` followed by a space is a bullet, never
        // the opening half of an italic phrase.
        if (/^[-*] /.test(block))
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.split("\n").map((l, j) => (
                <li key={j}>
                  <Inline text={l.replace(/^[-*] /, "").trim()} publicReading={publicReading} />
                </li>
              ))}
            </ul>
          );
        return (
          <p key={i} className="whitespace-pre-wrap">
            <Inline text={block} publicReading={publicReading} />
          </p>
        );
      })}
    </div>
  );
}
