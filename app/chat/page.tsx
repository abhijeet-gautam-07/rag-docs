"use client";

import React, { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "model";
  content: string;
  id?: string;
  ts?: number;
}

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [debug, setDebug] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // expose messages for quick debugging in console
  useEffect(() => {
    try {
      (window as any).__CHAT_MESSAGES = messages;
    } catch {}
  }, [messages]);

  // auto-scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // scroll to bottom smoothly
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  function makeId() {
    return Math.random().toString(36).slice(2, 9);
  }

  function appendMessage(msg: Message) {
    setMessages((prev) => {
      const next = [...prev, msg];
      return next;
    });
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // optimistic user message
    const userMsg: Message = { role: "user", content: text, id: `u_${makeId()}`, ts: Date.now() };
    appendMessage(userMsg);

    // build history to send (include optimistic user message)
    const historyToSend = [...messages, userMsg];

    setLoading(true);
    setDebug(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: historyToSend }),
      });

      let data: any;
      try {
        data = await res.json();
      } catch (jsonErr) {
        const raw = await res.text().catch(() => "");
        setDebug(`Non-JSON response (status ${res.status}):\n\n${raw}`);
        appendMessage({ role: "model", content: "Server returned non-JSON. See debug.", id: `s_${makeId()}`, ts: Date.now() });
        return;
      }

      setDebug(JSON.stringify({ status: res.status, body: data }, null, 2));

      if (!res.ok) {
        const errMsg = data?.error ?? `Server error ${res.status}`;
        appendMessage({ role: "model", content: `⚠️ ${errMsg}`, id: `s_${makeId()}`, ts: Date.now() });
        return;
      }

      const modelContent =
        data?.content ??
        data?.text ??
        data?.message ??
        (data?.response && typeof data.response === "string" ? data.response : undefined) ??
        (Array.isArray(data?.choices) && (data.choices[0]?.message?.content ?? data.choices[0]?.text)) ??
        null;

      if (!modelContent) {
        appendMessage({
          role: "model",
          content: "⚠️ Empty model response. See debug for details.",
          id: `s_${makeId()}`,
          ts: Date.now(),
        });
        return;
      }

      const assistantMsg: Message = { role: "model", content: String(modelContent), id: `m_${makeId()}`, ts: Date.now() };
      appendMessage(assistantMsg);
    } catch (err) {
      console.error("Network error:", err);
      appendMessage({ role: "model", content: "⚠️ Network error contacting server.", id: `e_${makeId()}`, ts: Date.now() });
      setDebug(String(err));
    } finally {
      setLoading(false);
    }
  }

  // form submit handler
  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (loading) return;
    if (!input.trim()) return;
    sendMessage(input);
    setInput("");
    // focus back to input
    inputRef.current?.focus();
  }

  // key handler: Enter to send, Shift+Enter for newline
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto p-4">
      <header className="mb-4 pb-2 border-b">
        <h1 className="text-2xl font-semibold">Resume Chat</h1>
        <p className="text-sm text-gray-500">Ask for matching resumes — press Enter to send, Shift+Enter for newline.</p>
      </header>

      <main ref={containerRef} className="flex-1 overflow-y-auto mb-3 space-y-4 pr-2">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-8">
            Assistant answer will appear here. Start by typing a message below.
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id ?? `${m.role}_${m.ts ?? Math.random()}`}
            data-testid="chat-message"
            className={`p-3 rounded-lg max-w-[80%] whitespace-pre-wrap ${m.role === "user" ? "bg-blue-600 text-white ml-auto" : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"}`}
          >
            <div className="text-xs font-medium opacity-80">{m.role === "user" ? "You" : "Assistant"}</div>
            <div className="mt-1 break-words">{m.content}</div>
          </div>
        ))}

        {loading && (
          <div className="p-3 rounded w-fit text-gray-600 animate-pulse bg-gray-200">Thinking…</div>
        )}
      </main>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t pt-3 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          className="flex-1 min-h-[44px] max-h-36 resize-none border rounded px-3 py-2 shadow-sm focus:outline-none focus:ring focus:ring-blue-300"
          aria-label="chat-input"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 hover:bg-blue-700"
        >
          Send
        </button>
      </form>

      {/* small debug panel */}
      <div className="mt-3 border-t pt-3">
        <h2 className="text-sm font-medium mb-1">Debug</h2>
        <pre className="max-h-36 overflow-auto bg-black text-green-200 p-2 rounded text-xs">
          {debug ?? "No server response yet."}
        </pre>
      </div>
    </div>
  );
}
