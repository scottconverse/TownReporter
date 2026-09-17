import { useRef, useState } from "react";
import { Upload, FileText, Check, X } from "lucide-react";
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
  const picker = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  async function upload(files: File[]) {
    if (disabled || uploadLock.current || !files.length) return;
    setFailed(false);
    if (documents.length + files.length > 20) {
      setFailed(true);
      setStatus("Choose up to 20 documents per story.");
      return;
    }
    const saved = [...documents];
    uploadLock.current = true;
    setProgress(0);
    setBusy(true);
    onBusy(true);
    try {
      for (const file of files) {
        setProgress(0);
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
          setProgress(
            Math.round((Math.min(file.size, offset + 4 * 1024 * 1024) / file.size) * 100),
          );
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
      setStatus("Documents saved. Ready to draft when you are.");
    } catch (e) {
      setFailed(true);
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      uploadLock.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="document-upload">
      <div
        className={
          "document-dropzone" +
          (dragging ? " is-dragging" : "") +
          (busy || disabled ? " is-busy" : "")
        }
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy && !disabled) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(Array.from(e.dataTransfer.files));
        }}
      >
        <Upload className="document-upload-icon" size={28} aria-hidden="true" />
        <h3>Start with your documents</h3>
        <p>Drop meeting packets, transcripts or notes here.</p>
        <button
          type="button"
          className="document-add-button"
          disabled={disabled || busy}
          onClick={() => picker.current?.click()}
        >
          <Upload size={18} aria-hidden="true" />{" "}
          {busy
            ? "Uploading documents…"
            : documents.length
              ? "Add more documents"
              : "Add documents"}
        </button>
        <input
          ref={picker}
          className="document-file-input"
          tabIndex={-1}
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
        <p className="document-formats">
          PDF · Word · Markdown · Text · Images · CSV · Transcripts
        </p>
        <p className="document-limits">Up to 20 files · 100 MB each · OCR included</p>
      </div>
      {busy && (
        <progress
          className="document-progress"
          value={progress}
          max={100}
          aria-label="Document upload progress"
        />
      )}
      {status && (
        <p
          className={"document-status" + (failed ? " is-error" : "")}
          role={failed ? "alert" : "status"}
        >
          {status}
        </p>
      )}
      {documents.length > 0 && (
        <p className="document-count">
          {documents.length} document{documents.length === 1 ? "" : "s"} attached
        </p>
      )}
      {documents.map((d) => (
        <div key={d.id} className="document-file-row">
          <FileText size={20} aria-hidden="true" />
          <div className="document-file-detail">
            <strong>{d.filename}</strong>
            <span>
              <Check size={14} aria-hidden="true" /> Saved · {(d.size / 1024 / 1024).toFixed(1)} MB
            </span>
          </div>
          <button
            type="button"
            className="document-remove"
            aria-label={"Remove " + d.filename + " from this story"}
            disabled={busy || disabled}
            onClick={() => onChange(documents.filter((x) => x.id !== d.id))}
          >
            <X size={16} aria-hidden="true" /> Remove
          </button>
        </div>
      ))}
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
        <div key={d.id} className="astra-source-document mt-3">
          <b>{d.filename}</b> · {d.status}
          {d.total_parts > 0 ? ` · ${d.read_parts}/${d.total_parts} parts read` : ""}
          <p>{d.detail}</p>
          <button className="btn small" type="button" onClick={() => void download(d.id)}>
            Download original
          </button>
          {d.characters > 0 && (
            <button className="btn small" type="button" onClick={() => void download(d.id, true)}>
              Download full extracted text
            </button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
