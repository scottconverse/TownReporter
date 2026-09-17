import type { ReactNode } from "react";
function Inline({ text, publicReading = false }: { text: string; publicReading?: boolean }) {
  const nodes: ReactNode[] = [];
  const re = publicReading
    ? /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*(.+?)\*\*|(https?:\/\/[^\s<>]+)/g
    : /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*(.+?)\*\*/g;
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
    else if (m[4]) {
      const url = m[4].replace(/[.,;:)]+$/, "");
      nodes.push(
        <a key={k++} href={url} className="text-rust underline" target="_blank" rel="noreferrer">
          {url}
        </a>,
      );
      nodes.push(m[4].slice(url.length));
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
        if (block.startsWith("- "))
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.split("\n").map((l, j) => (
                <li key={j}>
                  <Inline text={l.replace(/^- /, "").trim()} publicReading={publicReading} />
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
