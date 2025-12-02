// app/api/chat/route.ts
import { NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { pineconeQuery } from "@/lib/pinecone";
import { geminiEmbed } from "@/lib/gemini";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

// --- Helper: Clean Filename ---
function filenameToFriendlyName(path?: string | null): string {
  if (!path) return "Unknown File";
  const parts = String(path).split("/");
  const file = parts[parts.length - 1] ?? path;
  // Removes extension and typical ID prefixes
  return file.replace(/\.[^/.]+$/, "").replace(/^[0-9-_]+_/, "").replace(/[_-]+/g, " ").trim();
}

// --- Helper: Deduplicate Matches ---
function deduplicateMatches(matches: any[]) {
  const uniqueMap = new Map();
  matches.forEach((m) => {
    const key = m.path || m.id;
    if (!uniqueMap.has(key) || m.score > uniqueMap.get(key).score) {
      uniqueMap.set(key, m);
    }
  });
  return Array.from(uniqueMap.values());
}

// --- Tool: Search Pinecone ---
async function fetchMatchingResumes(requirements: string) {
  try {
    const [embedding] = await geminiEmbed([requirements]);
    
    // Get more results initially to allow for deduplication
    const search = await pineconeQuery(embedding, 10); 
    const matches = search?.matches || [];

    const mappedMatches = matches.map((m: any) => {
      const meta = m.metadata ?? {};
      return {
        id: m.id,
        name: meta.fileName || meta.name || filenameToFriendlyName(meta.path ?? m.id),
        path: meta.path ?? "no-path",
        excerpt: meta.summary ?? meta.text?.slice(0, 500) ?? "",
        // Convert 0.85 -> 85 for easier AI reading
        score: Math.round((m.score ?? 0) * 100), 
      };
    });

    return deduplicateMatches(mappedMatches).slice(0, 5); 

  } catch (err) {
    console.error("[TOOL ERROR]", err);
    return [];
  }
}

// --- Main Route ---
export async function POST(req: Request) {
  try {
    const { message, history } = await req.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "Missing API Key" }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      // --- UPDATED FORMATTING INSTRUCTIONS ---
      systemInstruction: 
        "You are a Recruiter AI. When showing results, you MUST use this exact format for each candidate:\n\n" +
        "1. First Line: `[file_path]` **File Name**\n" +
        "2. Second Line: Score: <score>% - <One sentence summary of skills>\n" +
        "3. Leave an empty line between candidates.\n\n" +
        "Example Output:\n" +
        "`[uploads/resume.pdf]` **John Doe**\n" +
        "Score: 85% - Extensive experience in Java and Spring Boot found in recent projects.\n\n" +
        "Do not group them. List them one by one.",
      tools: [
        {
          functionDeclarations: [
            {
              name: "fetch_matching_resumes",
              description: "Finds resumes based on skills.",
              parameters: {
                type: SchemaType.OBJECT,
                properties: {
                  requirements: { type: SchemaType.STRING, description: "Job requirements." },
                },
                required: ["requirements"],
              },
            },
          ],
        },
      ],
    });

    const cleanHistory = (history || []).map((m: any) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content || "" }],
    }));

    const chat = model.startChat({ history: cleanHistory });

    const result = await chat.sendMessage(message);
    const response = result.response;
    const calls = response.functionCalls();

    if (calls && calls.length > 0) {
      const call = calls[0];
      
      if (call.name === "fetch_matching_resumes") {
        const args = call.args as any;
        const matches = await fetchMatchingResumes(args.requirements || message);

        // Feed results back to Gemini
        const toolResponse = await chat.sendMessage([
          {
            functionResponse: {
              name: "fetch_matching_resumes",
              response: { content: matches },
            },
          },
        ]);

        const aiSummary = toolResponse.response.text();

        // Data for frontend cards (optional)
        const itemsForFrontend = matches.map((m: any) => ({
          id: m.id,
          name: m.name,
          score: m.score, // Already converted to 0-100 in tool
          path: m.path,
          reason: m.excerpt.slice(0, 150) + "..."
        }));

        return NextResponse.json({
          role: "model",
          content: aiSummary, 
          items: itemsForFrontend 
        });
      }
    }

    return NextResponse.json({
      role: "model",
      content: response.text(),
    });

  } catch (err: any) {
    console.error("API ERROR:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}