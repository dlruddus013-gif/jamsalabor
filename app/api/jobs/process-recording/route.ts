import { NextResponse } from "next/server";
import { createSupabaseAdminClient, isUsingSupabaseServer } from "@/lib/supabase/server";
import { processRecordingNow } from "@/lib/recording-processor";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isUsingSupabaseServer()) {
    return NextResponse.json({ error: "Supabase environment is required." }, { status: 500 });
  }

  const admin = createSupabaseAdminClient();
  const { data: job, error } = await admin
    .from("stt_jobs")
    .select("recording_id")
    .eq("status", "queued")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!job?.recording_id) {
    return NextResponse.json({ ok: true, processed: false });
  }

  try {
    const result = await processRecordingNow(job.recording_id);
    return NextResponse.json({ ok: true, processed: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "processing failed";
    await admin
      .from("stt_jobs")
      .update({
        status: "failed",
        error_code: "processing_failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("recording_id", job.recording_id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isUsingSupabaseServer()) {
    return NextResponse.json({ error: "Supabase environment is required." }, { status: 500 });
  }

  const { recordingId } = (await req.json().catch(() => ({}))) as { recordingId?: string };
  if (!recordingId) {
    return NextResponse.json({ error: "recordingId is required." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: recording, error } = await admin
    .from("recordings")
    .select("id")
    .eq("id", recordingId)
    .maybeSingle();
  if (error || !recording) {
    return NextResponse.json({ error: "recording not found" }, { status: 404 });
  }

  try {
    const result = await processRecordingNow(recordingId);
    return NextResponse.json({ ok: true, processed: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "processing failed";
    await admin
      .from("stt_jobs")
      .update({
        status: "failed",
        error_code: "processing_failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("recording_id", recordingId);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
