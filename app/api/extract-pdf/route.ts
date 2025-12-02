// app/api/extract-pdf/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getDocumentProxy, extractText } from "unpdf";
import { encodingForModel, Tiktoken, TiktokenModel } from "js-tiktoken";

type ReqBody = {
  bucket: string;
  path: string;
  chunkSizeTokens?: number;
  overlapTokens?: number;
  tokenizerModel?: string;
  pineconeNamespace?: string;
  batchSize?: number;
  previewChunks?: number;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PINECONE_API_URL = process.env.PINECONE_API_URL;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const DEFAULT_NAMESPACE = process.env.PINECONE_NAMESPACE ?? "";
const MAX_BYTES = Number(process.env.EXTRACT_MAX_BYTES ?? 200 * 1024 * 1024); // 200MB

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).");
}
if (!GEMINI_API_KEY) {
  console.warn("Missing GEMINI_API_KEY.");
}
if (!PINECONE_API_URL || !PINECONE_API_KEY) {
  console.warn("Missing Pinecone configuration.");
}

const supabaseAdmin = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

function createTokenizer(model: TiktokenModel = "gpt-4o-mini") {
  const enc: Tiktoken = encodingForModel(model);
  return {
    encode: (text: string) => enc.encode(text),
    count: (text: string) => enc.encode(text).length,
    free: () => {
      try {
        (enc as any).free?.();
      } catch {}
    },
  };
}

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

function recursiveSplit(
  text: string,
  tokenizer: ReturnType<typeof createTokenizer>,
  maxTokens: number,
  separators = DEFAULT_SEPARATORS,
  level = 0
): string[] {
  text = (text || "").trim();
  if (!text) return [];
  if (tokenizer.count(text) <= maxTokens) return [text];

  if (level >= separators.length - 1) {
    const tokens = tokenizer.count(text);
    const charsPerToken = Math.max(1, Math.floor(text.length / Math.max(1, tokens)));
    const approxChars = Math.max(200, Math.floor(maxTokens * charsPerToken));
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += approxChars) {
      parts.push(text.slice(i, i + approxChars).trim());
    }
    return parts.filter(Boolean);
  }

  const sep = separators[level];
  const parts = text.split(sep).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    if (tokenizer.count(part) <= maxTokens) out.push(part);
    else out.push(...recursiveSplit(part, tokenizer, maxTokens, separators, level + 1));
  }

  return out;
}

function assembleChunks(
  segments: string[],
  tokenizer: ReturnType<typeof createTokenizer>,
  chunkSizeTokens: number,
  overlapTokens: number
) {
  const chunks: { text: string; tokenCount: number }[] = [];
  let currentText = "";
  let currentTokens = 0;

  const pushChunk = () => {
    if (!currentText) return;
    chunks.push({ text: currentText.trim(), tokenCount: currentTokens });
    if (overlapTokens > 0) {
      const charsPerToken = Math.max(1, Math.floor(currentText.length / Math.max(1, currentTokens)));
      const overlapChars = overlapTokens * charsPerToken;
      currentText = currentText.slice(-overlapChars);
      currentTokens = tokenizer.count(currentText);
    } else {
      currentText = "";
      currentTokens = 0;
    }
  };

  for (const seg of segments) {
    const segTokens = tokenizer.count(seg);

    if (segTokens >= chunkSizeTokens) {
      const charsPerToken = Math.max(1, Math.floor(seg.length / Math.max(1, segTokens)));
      const approxChars = Math.max(300, chunkSizeTokens * charsPerToken);
      for (let i = 0; i < seg.length; i += approxChars) {
        const piece = seg.slice(i, i + approxChars).trim();
        const pieceTokens = tokenizer.count(piece);
        if (currentTokens + pieceTokens > chunkSizeTokens) pushChunk();
        currentText = currentText ? `${currentText}\n\n${piece}` : piece;
        currentTokens = tokenizer.count(currentText);
      }
      continue;
    }

    if (currentTokens + segTokens <= chunkSizeTokens) {
      currentText = currentText ? `${currentText}\n\n${seg}` : seg;
      currentTokens = tokenizer.count(currentText);
    } else {
      pushChunk();
      currentText = seg;
      currentTokens = tokenizer.count(currentText);
    }
  }

  pushChunk();
  return chunks;
}

async function geminiEmbeddingsBatch(texts: string[], model = "gemini-embedding-001", maxRetries = 3) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
  if (!Array.isArray(texts) || texts.length === 0) return [];

  // Use batchEmbedContents for multiple texts, embedContent for single text
  const url = texts.length === 1
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`;

  let body: any;
  if (texts.length === 1) {
    // Single content embedding
    body = {
      model,
      content: {
        parts: [{ text: texts[0] }],
      },
    };
  } else {
    // Batch embedding - model should be full path format: "models/model-name"
    const modelPath = model.startsWith("models/") ? model : `models/${model}`;
    body = {
      requests: texts.map((text) => ({
        model: modelPath,
        content: {
          parts: [{ text }],
        },
      })),
    };
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    });

    const txt = await res.text().catch(() => "");
    if (!res.ok) {
      if (res.status >= 500 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw new Error(`Gemini failed ${res.status}: ${txt}`);
    }

    let j: any = {};
    try {
      j = JSON.parse(txt || "{}");
    } catch {
      throw new Error("Gemini returned invalid JSON");
    }

    const embeddings: number[][] = [];

    // Handle batch response (batchEmbedContents)
    if (Array.isArray(j.embeddings)) {
      for (const it of j.embeddings) {
        if (Array.isArray(it.embedding)) {
          embeddings.push(it.embedding);
        } else if (Array.isArray(it)) {
          embeddings.push(it);
        } else if (Array.isArray(it.vector)) {
          embeddings.push(it.vector);
        } else if (Array.isArray(it.values)) {
          embeddings.push(it.values);
        }
      }
    }
    // Handle single response (embedContent)
    else if (j.embedding && Array.isArray(j.embedding)) {
      embeddings.push(j.embedding);
    }
    // Handle alternative response formats
    else if (Array.isArray(j.result?.embeddings)) {
      for (const it of j.result.embeddings) {
        if (Array.isArray(it.embedding)) {
          embeddings.push(it.embedding);
        } else if (Array.isArray(it)) {
          embeddings.push(it);
        }
      }
    } else if (Array.isArray(j.result)) {
      for (const it of j.result) {
        if (Array.isArray(it.embedding)) {
          embeddings.push(it.embedding);
        } else if (Array.isArray(it)) {
          embeddings.push(it);
        }
      }
    } else if (Array.isArray(j.data)) {
      for (const d of j.data) {
        if (Array.isArray(d.embedding)) {
          embeddings.push(d.embedding);
        } else if (Array.isArray(d)) {
          embeddings.push(d);
        }
      }
    } else {
      // Fallback: try to find any numeric arrays in the response
      const found: number[][] = [];
      const walk = (o: any) => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) {
          if (o.length > 0 && typeof o[0] === "number") {
            found.push(o as number[]);
            return;
          }
          for (const x of o) walk(x);
        } else {
          for (const k of Object.keys(o)) walk(o[k]);
        }
      };
      walk(j);
      if (found.length > 0) {
        for (const f of found) embeddings.push(f);
      }
    }

    if (embeddings.length === texts.length) return embeddings;
    throw new Error(`Gemini returned ${embeddings.length} embeddings for ${texts.length} texts`);
  }

  throw new Error("Gemini embedding request retries exhausted");
}

async function pineconeUpsertBatch(
  vectors: { id: string; values: number[]; metadata?: Record<string, any> }[],
  namespace = DEFAULT_NAMESPACE,
  maxRetries = 3
) {
  if (!PINECONE_API_URL || !PINECONE_API_KEY) throw new Error("Pinecone config missing");
  const url = `${PINECONE_API_URL.replace(/\/$/, "")}/vectors/upsert`;

  let attempt = 0;
  const body = { vectors, namespace: namespace || undefined };

  while (attempt < maxRetries) {
    attempt++;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": PINECONE_API_KEY,
      },
      body: JSON.stringify(body),
    });

    const txt = await res.text().catch(() => "");
    if (!res.ok) {
      if (res.status >= 500 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      throw new Error(`Pinecone upsert failed ${res.status}: ${txt}`);
    }

    try {
      return JSON.parse(txt || "{}");
    } catch {
      return {};
    }
  }

  throw new Error("Pinecone upsert retries exhausted");
}

async function extractPageTextRobust(pdfProxy: any, pageIndex: number) {
  // Prefer low-level getPage -> getTextContent (pdfjs-like) which many proxies support.
  try {
    if (typeof pdfProxy.getPage === "function") {
      const pageObj = await pdfProxy.getPage(pageIndex);
      // pageObj.getTextContent might exist (pdf.js-like)
      if (typeof pageObj.getTextContent === "function") {
        const textContent = await pageObj.getTextContent();
        return (textContent.items ?? []).map((it: any) => it.str ?? "").join(" ");
      }
      // if no getTextContent, try to extract text via unpdf's extractText on a single-page pdfProxy slice:
      // but unpdf doesn't provide a simple per-page API, so fallback to returning empty and let merged fallback handle it.
    }
  } catch (e) {
    console.warn(`Low-level getPage extraction failed for page ${pageIndex}:`, e);
  }

  // As a final fallback, try to call extractText( pdfProxy, { mergePages: true } ) and heuristically slice
  // around the page index — but avoid loading whole huge doc into memory except for small PDFs.
  try {
    const merged = await extractText(pdfProxy, { mergePages: true });
    const full = (merged as any)?.text ?? "";
    if (!full) return "";
    // If pdfProxy has a totalPages, try to split by rough equal-length pages
    const totalPages = (pdfProxy && ((pdfProxy as any).numPages ?? (pdfProxy as any)._pdfInfo?.numPages)) ?? null;
    if (!totalPages || totalPages <= 0) {
      return full;
    }
    // compute approx slice
    const approxLen = Math.ceil(full.length / totalPages);
    const start = Math.max(0, (pageIndex - 1) * approxLen);
    const slice = full.slice(start, start + approxLen);
    return slice;
  } catch (e) {
    console.warn(`Merged-extract fallback failed for page ${pageIndex}:`, e);
    return "";
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const bucket = body.bucket;
    const path = body.path;
    const chunkSizeTokens = Number(body.chunkSizeTokens ?? 800);
    const overlapTokens = Number(body.overlapTokens ?? 100);
    const tokenizerModel = (body.tokenizerModel ?? "gpt-4o-mini") as TiktokenModel;
    const batchSize = Number(body.batchSize ?? 32);
    const namespace = body.pineconeNamespace ?? DEFAULT_NAMESPACE;
    const previewChunks = Number(body.previewChunks ?? 5);

    if (!bucket || !path) {
      return NextResponse.json({ error: "bucket and path are required" }, { status: 400 });
    }

    const { data: blob, error: downloadError } = await supabaseAdmin.storage.from(bucket).download(path);
    if (downloadError || !blob) {
      console.error("Supabase download error:", downloadError);
      return NextResponse.json({ error: "Failed to download file", detail: downloadError?.message }, { status: 500 });
    }

    const fileSize = Number((blob as any).size ?? 0);
    if (fileSize > MAX_BYTES) {
      return NextResponse.json({ error: `File too large (${fileSize}). Max ${MAX_BYTES}` }, { status: 413 });
    }

    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    const pdfProxy = await getDocumentProxy(uint8);
    const totalPages = (pdfProxy && ((pdfProxy as any).numPages ?? (pdfProxy as any)._pdfInfo?.numPages)) ?? null;

    const tokenizer = createTokenizer(tokenizerModel);

    let insertedCount = 0;
    const preview: { id: string; page: number; tokenCount: number; textPreview: string }[] = [];

    const pagesToProcess = typeof totalPages === "number" ? totalPages : null;

    const processPage = async (p: number) => {
      const pageText = await extractPageTextRobust(pdfProxy, p);
      if (!pageText || !pageText.trim()) return 0;

      const segments = recursiveSplit(pageText, tokenizer, chunkSizeTokens);
      const chunks = assembleChunks(segments, tokenizer, chunkSizeTokens, overlapTokens);
      if (!chunks.length) return 0;

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const texts = batch.map((c) => c.text);

        const embeddings = await geminiEmbeddingsBatch(texts);

        const vectors = embeddings.map((vec, idx) => {
          const chunkIndex = i + idx;
          const id = `${bucket}::${path}::p${p}::c${chunkIndex}`;
          const metadata = {
            bucket,
            path,
            page: p,
            chunk_index: chunkIndex,
            token_count: batch[idx]!.tokenCount,
            preview: (batch[idx]!.text || "").slice(0, 300),
          };
          return { id, values: vec, metadata };
        });

        await pineconeUpsertBatch(vectors, namespace);

        insertedCount += vectors.length;
        for (let k = 0; k < vectors.length && preview.length < previewChunks; k++) {
          preview.push({
            id: vectors[k].id,
            page: p,
            tokenCount: batch[k]!.tokenCount,
            textPreview: (batch[k]!.text || "").slice(0, 400),
          });
        }
      }

      return chunks.length;
    };

    if (pagesToProcess && pagesToProcess > 0) {
      for (let p = 1; p <= pagesToProcess; p++) {
        await processPage(p);
      }
    } else {
      const merged = await extractText(pdfProxy, { mergePages: true });
      const fullText = (merged as any)?.text ?? "";
      if (fullText && fullText.length > 0) {
        const windowChars = 1_000_000;
        let cursor = 0;
        let pseudoPage = 1;
        while (cursor < fullText.length) {
          const slice = fullText.slice(cursor, cursor + windowChars);
          const segments = recursiveSplit(slice, tokenizer, chunkSizeTokens);
          const chunks = assembleChunks(segments, tokenizer, chunkSizeTokens, overlapTokens);

          for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const embeddings = await geminiEmbeddingsBatch(batch.map((c) => c.text));
            const vectors = embeddings.map((vec, idx) => {
              const id = `${bucket}::${path}::p${pseudoPage}::c${i + idx}`;
              return {
                id,
                values: vec,
                metadata: {
                  bucket,
                  path,
                  page: pseudoPage,
                  chunk_index: i + idx,
                  token_count: batch[idx]!.tokenCount,
                  preview: (batch[idx]!.text || "").slice(0, 300),
                },
              };
            });
            await pineconeUpsertBatch(vectors, namespace);
            insertedCount += vectors.length;
            for (let k = 0; k < vectors.length && preview.length < previewChunks; k++) {
              preview.push({
                id: vectors[k].id,
                page: pseudoPage,
                tokenCount: batch[k]!.tokenCount,
                textPreview: (batch[k]!.text || "").slice(0, 400),
              });
            }
          }

          cursor += windowChars;
          pseudoPage++;
        }
      }
    }

    tokenizer.free?.();

    return NextResponse.json({
      ok: true,
      message: "done",
      totalInserted: insertedCount,
      sample: preview,
    });
  } catch (err: any) {
    console.error("extract & embed error:", err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
