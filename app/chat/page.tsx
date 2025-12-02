// app/chat/page.tsx
"use client";

import React, { useState } from "react";

export default function ChatPage() {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!msg.trim()) return;
    setLoading(true);
    setAnswer("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, topK: 3 }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Server error");
      setAnswer(j.answer ?? "");
      setMsg("");
    } catch (err: any) {
      setAnswer(`Error: ${err?.message ?? String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto bg-white rounded shadow p-6 flex flex-col">
        <h1 className="text-xl font-semibold mb-4">Chat (RAG)</h1>

        <div className="flex-1 mb-4 min-h-[60vh] border rounded p-4 bg-gray-50 overflow-auto">
          <div className="whitespace-pre-wrap text-gray-900">{answer || <span className="text-gray-400">No answer yet.</span>}</div>
        </div>

        <form onSubmit={handleSend} className="flex gap-2">
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            className="flex-1 border p-2 rounded"
            placeholder="Ask something..."
          />
          <button disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded">
            {loading ? "..." : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}
