// lib/gemini.ts — robust geminiEmbed replacement (REST)
export async function geminiEmbed(texts: string[], model = "gemini-embedding-001"): Promise<number[][]> {
const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) throw new Error("GEMINI_API_KEY not configured");
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`;

  // Construct one request with content.parts = one part per text
  const body = {
    content: {
      parts: texts.map((t) => ({ text: t })),
    },
  };

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

  // Try common shapes:
  // 1) j.embeddings -> array (each item maybe {embedding: [...] } or array)
  if (Array.isArray(j.embeddings)) {
    const out: number[][] = j.embeddings.map((it: any) => {
      if (Array.isArray(it)) return it as number[];
      if (Array.isArray(it.embedding)) return it.embedding;
      if (Array.isArray(it.values)) return it.values;
      return null as any;
    }).filter(Boolean);
    if (out.length === texts.length) return out;
    // fallthrough to additional parsing if counts mismatch
  }

  // 2) j.data or j.result.embeddings etc.
  const candidateArrays: number[][] = [];
  const walkCollect = (o: any) => {
    if (!o) return;
    if (Array.isArray(o) && o.length > 0 && typeof o[0] === "number") {
      candidateArrays.push(o as number[]);
      return;
    }
    if (Array.isArray(o)) {
      for (const x of o) walkCollect(x);
    } else if (typeof o === "object") {
      for (const k of Object.keys(o)) walkCollect(o[k]);
    }
  };
  walkCollect(j);

  // If we found candidate numeric arrays, try to group them into embeddings (may overcollect)
  if (candidateArrays.length >= texts.length) {
    // Heuristic: if we have exact multiple-of texts.length, try to slice; else return first N
    // Prefer contiguous arrays that match expected dimension (if we can infer)
    const dims = candidateArrays.map((a) => a.length);
    // Return first 'texts.length' arrays
    return candidateArrays.slice(0, texts.length);
  }

  // Last fallback: check j.result.embeddings or j.data
  if (Array.isArray(j.result?.embeddings)) {
    const out: number[][] = j.result.embeddings.map((it: any) => it.embedding ?? it).filter(Boolean);
    if (out.length === texts.length) return out;
  }
  if (Array.isArray(j.data)) {
    const out: number[][] = j.data.map((d: any) => d.embedding ?? d).filter(Boolean);
    if (out.length === texts.length) return out;
  }

  // If still can't match counts — give a clear error including the returned JSON (truncated)
  const snippet = txt.length > 2000 ? txt.slice(0, 2000) + "...(truncated)" : txt;
  throw new Error(`Unexpected Gemini embed response: expected ${texts.length} embeddings but could not parse them. Response: ${snippet}`);
}
