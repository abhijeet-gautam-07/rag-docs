// lib/pinecone.ts
const PINECONE_API_URL = process.env.PINECONE_API_URL!;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const DEFAULT_NAMESPACE = process.env.PINECONE_NAMESPACE ?? "";

if (!PINECONE_API_URL || !PINECONE_API_KEY) {
  console.warn("Missing Pinecone env config.");
}

/**
 * Query Pinecone for a vector (nearest neighbors).
 * vector: number[]
 */
export async function pineconeQuery(vector: number[], topK = 3, namespace = DEFAULT_NAMESPACE) {
  const url = `${PINECONE_API_URL.replace(/\/$/, "")}/query`;
  const body = {
    vector,
    topK,
    includeMetadata: true,
    includeValues: false,
    namespace: namespace || undefined,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": PINECONE_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Pinecone query failed ${res.status}: ${txt}`);
  }
  const j = await res.json();
  // j.matches is array of { id, score, metadata }
  return j;
}
