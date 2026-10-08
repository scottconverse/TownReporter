import { useEffect, useState } from "react";
import { characterLength, pdfReadMarker } from "@/lib/news/pdf-read";

export function ReadMoreText({
  text,
  totalCharacters,
  onReadRest,
}: {
  text: string;
  totalCharacters: number;
  onReadRest: (offset: number) => Promise<string>;
}) {
  const [shown, setShown] = useState(text);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const read = characterLength(shown);
  const marker = pdfReadMarker(read, totalCharacters);
  useEffect(() => {
    setShown(text);
    setFailed(false);
  }, [text]);

  async function readRest() {
    setPending(true);
    setFailed(false);
    try {
      const next = await onReadRest(read);
      if (next) setShown((current) => current + next);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {marker ? <p className="np-meta">{marker}</p> : null}
      <div className="read-full">{shown}</div>
      {marker ? (
        <button
          type="button"
          className="btn quiet"
          aria-label="Read the rest"
          disabled={pending}
          onClick={() => void readRest()}
        >
          {pending ? "Reading the rest…" : "Read the rest"}
        </button>
      ) : null}
      {failed ? (
        <p className="note err" role="alert">
          Could not read the next part. Try again.
        </p>
      ) : null}
    </>
  );
}
