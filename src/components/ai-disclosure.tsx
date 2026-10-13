/*
  The one line an article page can carry under its story: wording an editor
  typed (an imported story's own line, stored on the article). Scott, Oct 12
  2026: "NO reference to AI anywhere in this system except ONE place and I'll
  write it. In the about section." So no line is derived for AI work, and a
  routine notice carries no line either.
*/
export function AiDisclosure({ routine = false, text = "" }: { routine?: boolean; text?: string }) {
  void routine;
  const line = text.trim();
  if (!line) return null;
  return <p className="ai-disclosure">{line}</p>;
}
