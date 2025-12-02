// lib/gemini.ts — robust geminiEmbed replacement (REST)
export async function geminiEmbed(texts: string[], model = "gemini-embedding-001"): Promise<number[][]> {
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) throw new Error("GEMINI_API_KEY not configured");
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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify(body),
  });

  const txt = await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(`Gemini embed failed ${res.status}: ${txt || "<empty response>"}`);
  }

  let j: any;
  try {
    j = JSON.parse(txt || "{}");
  } catch {
    throw new Error(`Gemini embed returned non-JSON: ${txt}`);
  }

  const embeddings: number[][] = [];
  const isNumberArray = (arr: any): arr is number[] =>
    Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "number";

  const normalizeEmbedding = (value: any): number[] | null => {
    if (!value) return null;
    if (isNumberArray(value)) return value;
    if (typeof value !== "object") return null;

    if (isNumberArray((value as any).embedding)) return (value as any).embedding;
    if (isNumberArray((value as any).values)) return (value as any).values;
    if (isNumberArray((value as any).vector)) return (value as any).vector;
    if (isNumberArray((value as any).embedding?.values)) return (value as any).embedding.values;
    if (isNumberArray((value as any).vector?.values)) return (value as any).vector.values;

    return null;
  };

  const pushEmbedding = (value: any) => {
    const vec = normalizeEmbedding(value);
    if (vec) embeddings.push(vec);
  };

  // Handle batch response (batchEmbedContents)
  if (Array.isArray(j.embeddings)) {
    for (const it of j.embeddings) {
      pushEmbedding(it);
    }
  }
  // Handle single response (embedContent) - wrap in array for consistency
  else if (j.embedding) {
    pushEmbedding(j.embedding);
  }
  // Handle alternative response formats
  else if (Array.isArray(j.result?.embeddings)) {
    for (const it of j.result.embeddings) {
      pushEmbedding(it);
    }
  } else if (Array.isArray(j.data)) {
    for (const d of j.data) {
      pushEmbedding(d);
    }
  }

  if (embeddings.length === texts.length) {
    return embeddings;
  }

  // If still can't match counts — give a clear error including the returned JSON (truncated)
  const snippet = txt.length > 2000 ? txt.slice(0, 2000) + "...(truncated)" : txt;
  // Fallback: walk the payload and collect numeric arrays if still missing
  const found: number[][] = [];
  const walk = (obj: any) => {
    if (!obj) return;
    const maybe = normalizeEmbedding(obj);
    if (maybe) {
      found.push(maybe);
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
    } else if (typeof obj === "object") {
      for (const key of Object.keys(obj)) {
        walk(obj[key]);
      }
    }
  };
  walk(j);
  if (found.length >= texts.length) {
    return found.slice(0, texts.length);
  }

  throw new Error(`Unexpected Gemini embed response: expected ${texts.length} embeddings but got ${embeddings.length}. Response: ${snippet}`);
}

/**
 * Generate text using Gemini
 */
export async function geminiGenerate(prompt: string, model = "gemini-1.5-flash"): Promise<string> {
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) throw new Error("GEMINI_API_KEY not configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify(body),
  });

  const txt = await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(`Gemini generate failed ${res.status}: ${txt || "<empty response>"}`);
  }

  let j: any;
  try {
    j = JSON.parse(txt || "{}");
  } catch {
    throw new Error(`Gemini generate returned non-JSON: ${txt}`);
  }

  // Extract text from response
  const candidates = j.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error(`Gemini generate returned no candidates. Response: ${txt}`);
  }

  const content = candidates[0]?.content;
  if (!content || !Array.isArray(content.parts)) {
    throw new Error(`Gemini generate returned invalid content structure. Response: ${txt}`);
  }

  const textParts = content.parts
    .map((part: any) => part.text)
    .filter((text: any) => typeof text === "string")
    .join("");

  return textParts || "";
}

/**
 * List available Gemini models
 */
export async function listModels(): Promise<any> {
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) throw new Error("GEMINI_API_KEY not configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  const txt = await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(`Gemini listModels failed ${res.status}: ${txt || "<empty response>"}`);
  }

  try {
    return JSON.parse(txt || "{}");
  } catch {
    throw new Error(`Gemini listModels returned non-JSON: ${txt}`);
  }
}
