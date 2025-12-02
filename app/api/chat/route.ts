// app/api/chat/route.ts
import { NextResponse } from "next/server";
import { geminiEmbed, geminiGenerate } from "@/lib/gemini";
import { pineconeQuery } from "@/lib/pinecone";

type ReqBody = { message: string; topK?: number };

// Server-only route: receives { message } and returns assistant reply + context matches
export async function POST(req: Request) {
  try {
    const { message, topK = 3 } = (await req.json()) as ReqBody;
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "message string required" }, { status: 400 });
    }

    // 1) embed query via Gemini
    const [queryEmb] = await geminiEmbed([message]);

    // 2) query pinecone for top matches
    const pineRes = await pineconeQuery(queryEmb, topK);
    const matches = pineRes?.matches ?? [];

    // 3) build context text from matches (concise)
    const contextFragments: string[] = [];
    for (const m of matches) {
      const md = m.metadata ?? {};
      const preview = md.preview ?? md.text ?? "";
      // limit preview length
      contextFragments.push(`(source: ${md.path ?? md.bucket ?? "unknown"} page:${md.page ?? "?"}) ${String(preview).slice(0, 800)}`);
    }
    const contextText = contextFragments.join("\n\n");

    // 4) build system prompt: include context but instruct assistant not to reveal it
    const systemPrompt = [
      {
        role: "system",
        content:
          "You are a concise assistant. Use the provided relevant context to answer the user's question. Do not reveal the sources or the context to the user; produce a direct, short, helpful answer.",
      },
    ];

    // 5) build user prompt combining user's message and the context
    const userPrompt = `User question:\n${message}\n\nRelevant context (do NOT reveal to user):\n${contextText}\n\nAnswer concisely:`;

    // 6) call Gemini generate
    // We send a compact prompt (system + user text) to the generate endpoint
    const fullPrompt = `${systemPrompt[0].content}\n\n${userPrompt}`;
    const assistantText = await geminiGenerate(fullPrompt, "gemini-1.0");

    // 7) return assistant answer and the raw matches (for debugging / UI)
    return NextResponse.json({
      ok: true,
      answer: assistantText,
      matches: matches.map((m: any) => ({
        id: m.id,
        score: m.score,
        metadata: m.metadata,
      })),
    });
  } catch (err: any) {
    console.error("chat route error:", err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
