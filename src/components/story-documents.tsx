import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  uploadStoryDocument,
  listStoryDocuments,
  downloadStoryDocument,
} from "@/lib/news/story-document-api";
import { documentKind, DOCUMENT_FILE_LIMIT } from "@/lib/news/story-document-text";
export type StoryUpload = { id: string; filename: string; size: number };
export function StoryDocumentUpload({
  documents,
  onChange,
  onBusy,
  disabled = false,
}: {
  documents: StoryUpload[];
  onChange: (docs: StoryUpload[]) => void;
  onBusy: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function upload(files: File[]) {
    if (documents.length + files.length > 20) {
      setStatus("Choose up to 20 documents per story.");
      return;
    }
    const saved = [...documents];
    setBusy(true);
    onBusy(true);
    try {
      for (const file of files) {
        documentKind(file.name);
        if (file.size > DOCUMENT_FILE_LIMIT)
          throw new Error(`${file.name} exceeds 100 MB. Split it into volumes before uploading.`);
        setStatus(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);
        let result: StoryUpload | undefined;
        for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
          const form = new FormData();
          form.append("file", file.slice(offset, offset + 4 * 1024 * 1024, file.type), file.name);
          form.append("total", String(file.size));
          form.append("offset", String(offset));
          form.append("id", result?.id ?? "");
          result = await uploadStoryDocument({ data: form });
          setStatus(
            "Uploading " +
              file.name +
              ": " +
              Math.round((Math.min(file.size, offset + 4 * 1024 * 1024) / file.size) * 100) +
              "%",
          );
        }
        if (!result) throw new Error(file.name + " is empty.");
        saved.push(result);
        onChange([...saved]);
      }
      setStatus("Documents saved. Add your instructions, choose a model, then click Write.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="my-4 space-y-2">
      <label className="block font-bold">
        Attach documents
        <input
          className="mt-2 block w-full"
          aria-label="Attach documents"
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.csv,.tsv,.srt,.vtt,.json,.log"
          disabled={disabled || busy}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void upload(files);
          }}
        />
      </label>
      <p className="text-sm">
        Up to 20 files, 100 MB each. Word (.doc/.docx), PDF, images, Markdown, text, CSV and
        transcripts. Originals are saved in full. PDFs and images use OCR when needed; long
        documents are read in sections. You can also paste website, PDF or YouTube URLs in the box
        above.
      </p>
      {documents.map((d) => (
        <div key={d.id} className="flex items-center gap-3">
          <span>
            {d.filename} · {(d.size / 1024 / 1024).toFixed(1)} MB · saved
          </span>
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => onChange(documents.filter((x) => x.id !== d.id))}
          >
            Remove from this story
          </button>
        </div>
      ))}
      {status && <p role="status">{status}</p>}
    </div>
  );
}
export function StoryDocumentList({ leadId }: { leadId: number }) {
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["story-documents", leadId],
    queryFn: () => listStoryDocuments({ data: { leadId } }),
    refetchInterval: 5000,
  });
  async function download(id: string, extracted = false) {
    try {
      const doc = await downloadStoryDocument({ data: { id, extracted } });
      const bytes = Uint8Array.from(atob(doc.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: doc.mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  if (query.error)
    return <p role="alert">Could not load source documents: {query.error.message}</p>;
  if (!query.data?.length) return null;
  return (
    <section className="my-5 border p-4">
      <h2 className="font-bold">Source documents</h2>
      <p>
        Originals remain private. Download them to check names, numbers and quotations before
        publication.
      </p>
      {query.data.map((d) => (
        <div key={d.id} className="mt-3">
          <b>{d.filename}</b> · {d.status}
          {d.total_parts > 0 ? ` · ${d.read_parts}/${d.total_parts} parts read` : ""}
          <p>{d.detail}</p>
          <button type="button" onClick={() => void download(d.id)}>
            Download original
          </button>
          {d.characters > 0 && (
            <button className="ml-4" type="button" onClick={() => void download(d.id, true)}>
              Download full extracted text
            </button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
