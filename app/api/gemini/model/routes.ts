// app/api/gemini/models/route.ts
import { NextResponse } from "next/server";
import { listModels } from "@/lib/gemini";

export async function GET() {
  try {
    const j = await listModels();
    return NextResponse.json(j);
  } catch (err: any) {
    console.error("list models error:", err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
