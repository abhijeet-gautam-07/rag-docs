// app/upload/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/* -------------------------
   Shared types
   ------------------------- */
type Message = {
  role: "user" | "model";
  content: string;
  id?: string;
  ts?: number;
};

type Item = {
  id: number;
  name: string;
  path: string;
  score: number;
};

/* -------------------------
   Supabase client (for UploadColumn)
   Uses public ANON key on client side
   ------------------------- */
const BUCKET = "pdf_files";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let supabaseClient: SupabaseClient | null = null;
if (SUPABASE_URL && SUPABASE_ANON) supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON);

/* -------------------------
   Utility
   ------------------------- */
function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/* -------------------------
   UploadColumn (left)
   - select (store local) / drag-drop
   - separate Upload button triggers actual upload + processing
   ------------------------- */
function UploadColumn() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "ready"; filename: string }
    | { status: "uploading"; filename: string }
    | { status: "uploaded"; filename: string; path: string }
    | { status: "processing"; filename: string; path: string }
    | { status: "done"; filename: string; path: string; inserted?: number; preview?: any[] }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const fileRef = useRef<HTMLInputElement | null>(null);

  const ensureClient = (): boolean => {
    if (!supabaseClient) {
      setState({ status: "error", message: "Supabase client not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." });
      return false;
    }
    return true;
  };

  const handleChoose = () => fileRef.current?.click();

  // called when user selects file (but does NOT upload yet)
  const handleSelect = (files: FileList | null) => {
    if (!files || files.length === 0) {
      setSelectedFile(null);
      setState({ status: "idle" });
      return;
    }
    const file = files[0];
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setSelectedFile(null);
      setState({ status: "error", message: "Only PDF files are supported." });
      return;
    }
    setSelectedFile(file);
    setState({ status: "ready", filename: file.name });
  };

  const onDropSelect = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    handleSelect(files);
  };

  const onDragOverSelect = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  // actual upload + processing
  const uploadSelectedFile = async () => {
    const file = selectedFile;
    if (!file) return;
    if (!ensureClient()) return;

    const filename = `${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
    try {
      setState({ status: "uploading", filename });

      const { data, error } = await supabaseClient!.storage.from(BUCKET).upload(filename, file, { upsert: false });
      if (error) {
        setState({ status: "error", message: `Upload failed: ${error.message}` });
        return;
      }
      const path = (data as any)?.path ?? filename;
      setState({ status: "uploaded", filename, path });

      // Call server to extract & embed
      setState({ status: "processing", filename, path });
      const res = await fetch("/api/extract-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: BUCKET, path, chunkSizeTokens: 800, overlapTokens: 100, previewChunks: 3 }),
      });

      let json: any = null;
      try {
        json = await res.json();
      } catch (e) {
        const text = await res.text().catch(() => "");
        setState({ status: "error", message: `Processing failed (non-JSON response): ${text}` });
        return;
      }

      if (!res.ok) {
        setState({ status: "error", message: `Processing failed: ${json?.error ?? "server error"}` });
        return;
      }

      setState({ status: "done", filename, path, inserted: json?.totalInserted ?? undefined, preview: Array.isArray(json?.sample) ? json.sample : undefined });
    } catch (err: any) {
      setState({ status: "error", message: String(err?.message ?? err) });
    }
  };

  const cancelSelection = () => {
    setSelectedFile(null);
    setState({ status: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  };

  const reset = () => {
    setSelectedFile(null);
    setState({ status: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex flex-col h-full p-4">
      <h2 className="text-lg font-semibold mb-2">Upload PDFs</h2>

      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => handleSelect(e.target.files)} />

      <div
        onDrop={onDropSelect}
        onDragOver={onDragOverSelect}
        role="button"
        tabIndex={0}
        onClick={handleChoose}
        className="flex-1 border-dashed border-2 border-gray-200 rounded p-6 flex flex-col items-center justify-center bg-white dark:bg-gray-950 cursor-pointer"
      >
        <div className="text-center">
          <div className="mb-3 text-gray-600">Drop a PDF here or click to select</div>
          <div className="flex gap-2 justify-center">
            <button type="button" onClick={handleChoose} className="px-4 py-2 rounded bg-blue-600 text-white">Choose file</button>
            <button
              type="button"
              onClick={() => {
                if (selectedFile) uploadSelectedFile();
              }}
              disabled={!selectedFile || state.status === "uploading" || state.status === "processing"}
              className={`px-4 py-2 rounded ${selectedFile ? "bg-green-600 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}`}
            >
              Upload
            </button>
            <button
              type="button"
              onClick={cancelSelection}
              disabled={!selectedFile}
              className={`px-4 py-2 rounded border ${selectedFile ? "" : "opacity-50 cursor-not-allowed"}`}
            >
              Cancel
            </button>
          </div>
          <div className="mt-4 text-xs text-gray-500">Accepted: PDF. After you press Upload the file will be processed and embedded.</div>

          {selectedFile && (
            <div className="mt-3 text-sm text-gray-700">
              Selected: <strong>{selectedFile.name}</strong> ({Math.round(selectedFile.size / 1024)} KB)
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 text-sm text-gray-700">
        {state.status === "idle" && <div>Uploaded files will appear in Document Library.</div>}
        {state.status === "ready" && <div>Ready to upload <strong>{(state as any).filename}</strong>. Click <em>Upload</em>.</div>}
        {state.status === "uploading" && <div>Uploading <strong>{(state as any).filename}</strong>…</div>}
        {state.status === "uploaded" && <div>Uploaded <strong>{(state as any).filename}</strong>. Path: <code>{(state as any).path}</code></div>}
        {state.status === "processing" && <div>Processing <strong>{(state as any).filename}</strong> on server…</div>}
        {state.status === "done" && (
          <div>
            <div><strong>{(state as any).filename}</strong> processed.</div>
            {typeof (state as any).inserted === "number" && <div>Inserted chunks: {(state as any).inserted}</div>}
            {(state as any).preview && (state as any).preview.length > 0 && (
              <div className="mt-2">
                <div className="text-sm font-medium">Preview chunks:</div>
                <ul className="list-disc ml-5 text-xs">
                  {(state as any).preview.map((p: any) => (
                    <li key={p.id}>
                      Page {p.page} — {p.tokenCount} tokens — <code>{String(p.textPreview).slice(0, 120)}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-2"><button onClick={reset} className="px-3 py-1 rounded border text-sm">Upload another</button></div>
          </div>
        )}
        {state.status === "error" && (
          <div className="text-red-600">
            Error: <span className="font-medium">{(state as any).message}</span>
            <div className="mt-2"><button onClick={reset} className="px-3 py-1 rounded border text-sm">Try again</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------
   ChatColumn (right) - unchanged
   ------------------------- */
function ChatColumn() {
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [debug, setDebug] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, items, loading]);

  function appendMessage(role: Message["role"], content: string) {
    setMessages((prev) => [...prev, { role, content, id: `${role}_${makeId()}`, ts: Date.now() }]);
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    appendMessage("user", trimmed);
    setLoading(true);
    setDebug(null);

    try {
      const historyToSend = messages.map((m) => ({ role: m.role === "user" ? "user" : "model", content: m.content }));
      historyToSend.push({ role: "user", content: trimmed });

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history: historyToSend }),
      });

      const raw = await res.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        appendMessage("model", "⚠️ Server returned non-JSON. See debug.");
        setDebug(raw);
        setLoading(false);
        return;
      }

      setDebug(JSON.stringify({ status: res.status, body: data }, null, 2));
      if (!res.ok) {
        appendMessage("model", `⚠️ Server error: ${data?.error ?? res.status}`);
        setLoading(false);
        return;
      }

      const content = data?.content ?? data?.text ?? data?.message ?? "";
      appendMessage("model", String(content ?? "(no content)"));
      setItems(Array.isArray(data?.items) ? (data.items as Item[]) : null);
    } catch (err: any) {
      console.error("Network error:", err);
      appendMessage("model", "⚠️ Network error contacting server.");
      setDebug(String(err));
    } finally {
      setLoading(false);
      textRef.current?.focus();
    }
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (loading) return;
    if (!input.trim()) return;
    sendMessage(input);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b">
        <h2 className="text-lg font-semibold">Resume Chat</h2>
        <p className="text-sm text-gray-500">Ask for matching resumes. Press Enter to send.</p>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto mb-3 space-y-4 pr-2 p-4 bg-white dark:bg-gray-900">
        {messages.length === 0 && <div className="text-center text-gray-400 mt-6">Assistant answer will appear here. Start by typing a message below.</div>}

        {messages.map((m) => (
          <div
            key={m.id ?? `${m.role}-${m.ts ?? Math.random()}`}
            className={`p-3 rounded-lg max-w-[86%] whitespace-pre-wrap ${m.role === "user" ? "bg-blue-600 text-white ml-auto" : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"}`}
          >
            <div className="text-xs font-medium opacity-80">{m.role === "user" ? "You" : "Assistant"}</div>
            <div className="mt-1 break-words">
              {m.role === "model" ? <ReactMarkdown>{m.content}</ReactMarkdown> : <span>{m.content}</span>}
            </div>
          </div>
        ))}

        {loading && <div className="p-3 rounded w-fit text-gray-600 animate-pulse bg-gray-200">Thinking…</div>}
      </div>

      <form onSubmit={handleSubmit} className="p-3 border-t">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter sends, Shift+Enter newline)"
            className="flex-1 min-h-[44px] max-h-36 resize-none border rounded px-3 py-2 shadow-sm focus:outline-none focus:ring focus:ring-blue-300"
            aria-label="chat-input"
          />
          <button type="submit" disabled={loading || !input.trim()} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 hover:bg-blue-700">
            Send
          </button>
        </div>

        {/* debug area */}
        {/* <div className="mt-2 text-xs text-gray-500">
          <div>Debug:</div>
          <pre className="max-h-36 overflow-auto bg-black text-green-200 p-2 rounded text-xs">{debug ?? "No server response yet."}</pre>
        </div> */}
      </form>
    </div>
  );
}

/* -------------------------
   Page layout (both columns)
   ------------------------- */
export default function UploadWithChatPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto py-8 px-4">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Upload & Chat</h1>
          <div className="text-sm text-gray-500">Upload PDFs on the left · Ask resumes on the right</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4" style={{ minHeight: "70vh" }}>
          <div className="md:col-span-5 bg-white dark:bg-gray-800 rounded shadow-sm overflow-hidden">
            <UploadColumn />
          </div>

          <div className="md:col-span-7 bg-white dark:bg-gray-800 rounded shadow-sm flex flex-col overflow-hidden">
            <ChatColumn />
          </div>
        </div>
      </div>
    </div>
  );
}
