import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "pdf_files";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("Missing Supabase credentials for file listing route.");
}

const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

export async function GET() {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: 100, sortBy: { column: "created_at", order: "desc" } });

    if (error) {
      console.error("Supabase list error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const files =
      data?.map((file) => {
        const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(file.name).data.publicUrl;
        return {
          name: file.name,
          size: file.metadata?.size ?? null,
          created_at: file.created_at,
          updated_at: file.updated_at,
          publicUrl,
        };
      }) ?? [];

    return NextResponse.json({ files });
  } catch (err: any) {
    console.error("files route error:", err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

