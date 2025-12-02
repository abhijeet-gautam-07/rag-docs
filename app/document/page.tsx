"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, RefreshCcw, FileText } from "lucide-react";

type StoredFile = {
  name: string;
  size: number | null;
  created_at: string | null;
  updated_at: string | null;
  publicUrl: string;
};

export default function DocumentPage() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/files");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch files");
      setFiles(json.files ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const formatSize = (size: number | null) => {
    if (!size || size <= 0) return "Unknown size";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Document Library</h1>
          <p className="text-sm text-gray-500">
            Every PDF you upload lives here. Download resumes or open them in a new tab.
          </p>
        </div>
        <button
          onClick={fetchFiles}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium shadow-sm disabled:opacity-60"
        >
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {loading && files.length === 0 ? (
        <div className="text-sm text-gray-500">Loading documents…</div>
      ) : files.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-gray-500">
          No documents stored yet. Upload a PDF from the dashboard to see it here.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((file) => (
            <article key={file.name} className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-gray-100 p-2">
                  <FileText className="h-5 w-5 text-gray-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-sm font-semibold break-all">{file.name}</h2>
                  <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
                  {file.updated_at && (
                    <p className="text-xs text-gray-400">
                      Updated {new Date(file.updated_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <a
                  href={file.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold text-gray-700"
                >
                  Open
                </a>
                <a
                  href={file.publicUrl}
                  download
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
                >
                  <DownloadIcon className="h-4 w-4" />
                  Download
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

