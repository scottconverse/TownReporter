import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The meaning model behind "Close in meaning" on the Story page (D285/D286).
 *
 * MiniLM runs inside this Node process through @huggingface/transformers --
 * no LM Studio, no Ollama, nothing shared with another project on the machine.
 * The model is loaded lazily, once per process, off a module-level promise, so
 * a desk that never searches by meaning never pays for it.
 *
 * Tests never reach the real model: the suite runs with a default-deny fetch
 * (`src/lib/test-support/model-seal.ts`), and `setEmbedderForTests` swaps in a
 * fake before any search runs. The import of the package is dynamic for the
 * same reason -- loading it at module load would drag onnxruntime into every
 * test that imports the search module.
 */

/** The model, and the three numbers the vector table is built around. */
export const EVIDENCE_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EVIDENCE_DIMS = 384;
/** How long one excerpt may be before the model's own limit clips it. */
const MAX_MODEL_CHARS = 2_000;

/** Same rule as `voice.server.ts`: the operator's data root, else the home folder. */
function dataRoot(): string {
  const configured =
    process.env.TOWNREPORTER_DATA_ROOT?.trim() || process.env.TOWNREPORTER_DATA_DIR?.trim();
  return configured ? resolve(configured) : join(homedir(), ".townreporter-data");
}

/** Where the model files live, under the operator's data root. */
export function modelCacheDir(): string {
  return join(dataRoot(), "models");
}

export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

let testEmbedder: Embedder | null = null;
let pipelinePromise: Promise<FeatureExtractor> | null = null;

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

/**
 * Swap the real model for a fake. `null` puts the real one back. Exported so a
 * test can exercise the search without a download, and so a test can hand in a
 * function that throws to prove the exact list still works when meaning does
 * not.
 */
export function setEmbedderForTests(fn: Embedder | null): void {
  testEmbedder = fn;
}

/** Drop the loaded model (tests and a crashed load). */
export function resetEmbedderForTests(): void {
  testEmbedder = null;
  pipelinePromise = null;
}

async function loadPipeline(): Promise<FeatureExtractor> {
  const { env, pipeline } = await import("@huggingface/transformers");
  const cacheDir = modelCacheDir();
  await mkdir(cacheDir, { recursive: true });
  env.cacheDir = cacheDir;
  return (await pipeline("feature-extraction", EVIDENCE_MODEL, {
    dtype: "fp32",
    // Two threads: the desk's background fill must not take the machine the
    // editor is typing on. `session_options` is ONNX Runtime's own type and is
    // passed through by @huggingface/transformers 4.3.1 (see its hub.d.ts).
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  })) as unknown as FeatureExtractor;
}

function loadExtractor(): Promise<FeatureExtractor> {
  if (!pipelinePromise) {
    // A failed load is not remembered: the next call tries again (the clock
    // waits 30 minutes before it asks, see unattended-scheduler.ts).
    pipelinePromise = loadPipeline().catch((err) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

/** Embed each text into EVIDENCE_DIMS normalized float32 numbers. */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const clipped = texts.map((t) => t.slice(0, MAX_MODEL_CHARS));
  if (testEmbedder) return testEmbedder(clipped);
  const extractor = await loadExtractor();
  const output = await extractor(clipped, { pooling: "mean", normalize: true });
  const rows = output.dims[0] ?? clipped.length;
  const dims = output.dims[1] ?? EVIDENCE_DIMS;
  const out: Float32Array[] = [];
  for (let i = 0; i < rows; i += 1) {
    out.push(output.data.slice(i * dims, (i + 1) * dims));
  }
  return out;
}

/** 384 float32 numbers as the little-endian bytes the vector table stores. */
export function vectorToBytes(vector: Float32Array): Uint8Array {
  const bytes = new Uint8Array(vector.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < vector.length; i += 1) {
    view.setFloat32(i * 4, vector[i]!, true);
  }
  return bytes;
}

/** The inverse of `vectorToBytes`. Tolerates a hex string (`\x...`) too. */
export function bytesToVector(raw: unknown): Float32Array {
  const bytes = raw as Uint8Array | Buffer | string | null;
  if (!bytes) return new Float32Array(0);
  if (typeof bytes === "string") {
    const hex = bytes.startsWith("\\x") ? bytes.slice(2) : bytes;
    const out = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < out.length; i += 1) {
      out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytesToVector(out);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dims = Math.floor(bytes.byteLength / 4);
  const out = new Float32Array(dims);
  for (let i = 0; i < dims; i += 1) out[i] = view.getFloat32(i * 4, true);
  return out;
}

/** Dot product. Vectors are normalized, so this is also the cosine score. */
export function dotProduct(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += a[i]! * b[i]!;
  return sum;
}
