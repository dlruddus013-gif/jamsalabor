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
  let recordingId: string | null = null;
  let { data: job, error } = await admin
    .from("stt_jobs")
    .select("recording_id")
    .eq("status", "queued")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (!isMissingRelationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.error("[jobs] stt_jobs table missing; processing recordings directly:", error);
  }
  recordingId = job?.recording_id ?? null;

  if (!recordingId && !error) {
    const enqueued = await enqueueMissingProcessingJobs(admin);
    if (enqueued > 0) {
      const retry = await admin
        .from("stt_jobs")
        .select("recording_id")
        .eq("status", "queued")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (retry.error) {
        if (!isMissingRelationError(retry.error)) {
          return NextResponse.json({ error: retry.error.message }, { status: 500 });
        }
        console.error("[jobs] stt_jobs retry lookup missing; falling back:", retry.error);
      } else {
        job = retry.data;
        recordingId = job?.recording_id ?? null;
      }
    }
  }

  if (!recordingId) {
    recordingId = await findProcessableRecording(admin);
  }

  if (!recordingId) {
    return NextResponse.json({ ok: true, processed: false });
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

function isMissingRelationError(error: unknown) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return (
    message.includes("stt_jobs") &&
    (message.includes("schema cache") ||
      message.includes("Could not find the table") ||
      message.includes("does not exist"))
  );
}

async function findProcessableRecording(
  admin: ReturnType<typeof createSupabaseAdminClient>
) {
  const { data, error } = await admin
    .from("recordings")
    .select("id")
    .in("status", ["uploading", "processing", "failed"])
    .not("audio_path", "is", null)
    .order("recorded_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[jobs] direct recording lookup failed:", error);
    return null;
  }

  return data?.id ?? null;
}

async function enqueueMissingProcessingJobs(
  admin: ReturnType<typeof createSupabaseAdminClient>
) {
  const { data: recordings, error: recordingsError } = await admin
    .from("recordings")
    .select("id")
    .in("status", ["uploading", "processing", "failed"])
    .not("audio_path", "is", null)
    .order("recorded_at", { ascending: true })
    .limit(50);

  if (recordingsError || !recordings?.length) {
    if (recordingsError) console.error("[jobs] missing job scan failed:", recordingsError);
    return 0;
  }

  const ids = recordings.map((row: { id: string }) => row.id);
  const { data: existing, error: existingError } = await admin
    .from("stt_jobs")
    .select("recording_id")
    .in("recording_id", ids);

  if (existingError) {
    console.error("[jobs] existing job lookup failed:", existingError);
    return 0;
  }

  const seen = new Set((existing ?? []).map((row: { recording_id: string }) => row.recording_id));
  const missing = ids.filter((id: string) => !seen.has(id));
  if (missing.length === 0) return 0;

  const { error: insertError } = await admin.from("stt_jobs").insert(
    missing.map((recordingId: string) => ({
      recording_id: recordingId,
      status: "queued",
      engine: "naver-clova-speech",
      language: "ko",
      priority: 80,
    }))
  );

  if (insertError) {
    console.error("[jobs] missing job enqueue failed:", insertError);
    return 0;
  }

  return missing.length;
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
