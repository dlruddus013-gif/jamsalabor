import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { STORAGE_BUCKET } from "@/lib/upload";
import { transcribeSignedUrlWithNaver } from "@/lib/integrations/naver-speech";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const admin = createSupabaseAdminClient();
    const { data: recording, error } = await admin
      .from("recordings")
      .select("id, audio_path")
      .eq("id", id)
      .single();

    if (error || !recording?.audio_path) {
      return NextResponse.json({ error: "recording audio not found" }, { status: 404 });
    }

    const { data: signed, error: signedError } = await admin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(recording.audio_path, 60 * 30);
    if (signedError || !signed?.signedUrl) {
      return NextResponse.json({ error: signedError?.message ?? "signed url failed" }, { status: 500 });
    }

    const result = await transcribeSignedUrlWithNaver(signed.signedUrl);
    if (result.segments.length > 0) {
      await admin.from("transcript_segments").delete().eq("recording_id", id);
      await admin.from("transcript_segments").insert(
        result.segments.map((seg) => ({
          recording_id: id,
          start_sec: seg.startSec,
          end_sec: seg.endSec,
          speaker: seg.speaker === "1" ? "customer" : "agent",
          text: seg.text,
          text_raw: seg.text,
          confidence: seg.confidence,
        }))
      );
    }

    await admin.from("recordings").update({ status: "completed" }).eq("id", id);
    return NextResponse.json({ ok: true, text: result.text, segments: result.segments.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

