// app/upload/page.tsx
"use client";

import React, { useRef, useState, FormEvent } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export default function UploadAndChatPage() {
  const [status, setStatus] = useState<"idle" | "uploading" | "parsing" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState("");
  const [uploadedName, setUploadedName] = useState("");

  // chat
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const formRef = useRef<HTMLFormElement | null>(null);
  const BUCKET = "pdf_files";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setUploadedUrl("");
    setUploadedName("");
    setAnswer("");

    const input = formRef.current?.querySelector<HTMLInputElement>('input[type="file"]');
    const file = input?.files?.[0] ?? null;

    if (!file) {
      setError("Choose a PDF file first.");
      return;
    }
    if (file.type !== "application/pdf") {
      setError("Only PDF files are allowed.");
      return;
    }

    // Optional client-side size guard (10MB default)
    const MAX_UPLOAD_BYTES = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`File too large. Max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
      return;
    }

    try {
      setStatus("uploading");
      const path = `${Date.now()}_${file.name.replace(/\s+/g, "_")}`;

      const { data, error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: "application/pdf",
      });
      if (uploadErr) throw uploadErr;

      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(data.path).data.publicUrl;
      setUploadedUrl(publicUrl);
      setUploadedName(file.name);

      setStatus("parsing");

      // call API route to parse, chunk, embed, store in pinecone
      const res = await fetch("/api/extract-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucket: BUCKET,
          path: data.path,
          chunkSizeTokens: 400,
          overlapTokens: 50,
          tokenizerModel: "gpt-4o-mini",
          batchSize: 16,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Server error ${res.status}`);

      setStatus("done");
      formRef.current?.reset();
    } catch (err: any) {
      console.error(err);
      setStatus("error");
      setError(err.message ?? "Unexpected error");
    }
  }

  async function handleChat(e?: FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;

    setChatLoading(true);
    setAnswer("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query, topK: 4 }),
      });
      const j = await res.json();

      if (!res.ok) throw new Error(j.error ?? `Server error ${res.status}`);

      setAnswer(j.answer ?? "");
      // Keep UI minimal: do not surface matches
      setQuery("");
    } catch (err: any) {
      console.error("chat error:", err);
      setAnswer(`Error: ${err?.message ?? String(err)}`);
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <div className="min-h-screen p-6 bg-gray-50 flex items-start justify-center">
      <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-12 gap-6">

        {/* LEFT: Narrow Upload/Card area (integrated) */}
        <div className="md:col-span-3 bg-white p-4 rounded shadow flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold">Upload</h2>
            <p className="text-xs text-gray-500">Upload a PDF to enable chat over its content.</p>
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
            <input type="file" accept="application/pdf" className="block w-full text-sm" />
            <button
              type="submit"
              disabled={status === "uploading" || status === "parsing"}
              className="w-full bg-blue-600 text-white px-3 py-2 rounded disabled:opacity-60"
            >
              {status === "uploading" ? "Uploading..." : status === "parsing" ? "Processing..." : "Upload & Process"}
            </button>
          </form>

          {error && <div className="text-red-600 text-sm">{error}</div>}

          <div className="text-sm text-gray-600 mt-auto">
            <div>
              <span className="font-medium">File: </span>
              {uploadedName || "No file"}
            </div>
            <div className="mt-1">
              <span className="font-medium">Status: </span>
              {status}
            </div>
            {uploadedUrl && (
              <a href={uploadedUrl} target="_blank" rel="noreferrer" className="block mt-2 text-blue-600 underline text-sm">
                View PDF
              </a>
            )}
          </div>
        </div>

        {/* RIGHT: Large vertical chat area */}
        <div className="md:col-span-9 bg-white p-6 rounded shadow flex flex-col">
          <div className="mb-4">
            <h1 className="text-2xl font-semibold">Chat with your document</h1>
            <p className="text-sm text-gray-500 mt-1">
              Ask questions about the uploaded PDF. Keep prompts concise for best results.
            </p>
          </div>

          {/* Large chat / conversation box (vertical) */}
          <div className="flex-1 border rounded p-4 bg-gray-50 overflow-auto mb-4 min-h-[60vh]">
            {/* If you later want to show chat history, render messages here */}
            <div className="whitespace-pre-wrap text-gray-900">{answer || <span className="text-gray-400">Assistant answer will appear here.</span>}</div>
          </div>

          {/* Chat input */}
          <form onSubmit={handleChat} className="flex gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 border p-3 rounded"
              placeholder={uploadedName ? `Ask about ${uploadedName}...` : "Upload a PDF first, then ask a question..."}
            />
            <button
              type="submit"
              disabled={chatLoading}
              className="bg-indigo-600 text-white px-5 py-3 rounded disabled:opacity-60"
            >
              {chatLoading ? "Thinking…" : "Send"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
