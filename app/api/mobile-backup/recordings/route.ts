import { NextResponse } from "next/server";
import { createSupabaseAdminClient, isUsingSupabaseServer } from "@/lib/supabase/server";
import { getExtension, sanitizeFilename, STORAGE_BUCKET, validateAudioFile } from "@/lib/upload";
import { processRecordingNow } from "@/lib/recording-processor";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: Request) {
  const expected = process.env.MOBILE_BACKUP_API_TOKEN;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isUsingSupabaseServer()) {
    return NextResponse.json({ error: "Supabase environment is required." }, { status: 500 });
  }

  const formData = await req.formData();
  const raw = formData.get("file");
  if (!(raw instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const validation = validateAudioFile({ name: raw.name, size: raw.size, type: raw.type });
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const deviceId = String(formData.get("deviceId") || "android").replace(/[^\w.-]/g, "_");
  const sha256 = String(formData.get("sha256") || "").trim() || null;
  const originalPath = String(formData.get("originalPath") || "");
  const recordedAt = String(formData.get("recordedAt") || "") || new Date().toISOString();
  const title = String(formData.get("title") || raw.name.replace(/\.[^.]+$/, "")).slice(0, 200);
  const ownerId = String(formData.get("ownerId") || process.env.MOBILE_BACKUP_OWNER_ID || "").trim() || null;

  if (sha256) {
    const { data: existing } = await admin
      .from("recordings")
      .select("id, status")
      .eq("audio_sha256", sha256)
      .maybeSingle();
    if (existing?.id) {
      return NextResponse.json({ ok: true, duplicate: true, id: existing.id, status: existing.status });
    }
  }

  const ext = getExtension(raw.name) || "bin";
  const safeName = sanitizeFilename(raw.name, 90);
  const storagePath = `mobile-backups/${deviceId}/${Date.now()}_${safeName}`;
  const contentType = raw.type || `audio/${ext}`;

  if (ownerId) {
    const { data: canStore, error: quotaError } = await admin.rpc("can_store_recording", {
      p_owner_id: ownerId,
      p_bytes: raw.size,
    });
    if (!quotaError && canStore === false) {
      return NextResponse.json(
        { error: "cloud storage quota exceeded", code: "quota_exceeded" },
        { status: 413 }
      );
    }
  }

  const { error: uploadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, raw, { contentType, upsert: false, cacheControl: "3600" });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: recording, error: insertError } = await admin
    .from("recordings")
    .insert({
      owner_id: ownerId,
      recorded_at: recordedAt,
      duration_sec: Number(formData.get("durationSec") || 0),
      audio_path: storagePath,
      audio_mime: contentType,
      audio_size_bytes: raw.size,
      audio_sha256: sha256,
      status: "processing",
      source: "phone_backup",
      title,
      metadata: {
        device_id: deviceId,
        original_path: originalPath,
        last_modified: String(formData.get("lastModified") || ""),
        backup_client: String(formData.get("client") || "android-companion"),
      },
    })
    .select("id")
    .single();

  if (insertError || !recording?.id) {
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: insertError?.message ?? "recording insert failed" }, { status: 500 });
  }

  await admin.from("stt_jobs").insert({
    recording_id: recording.id,
    status: "queued",
    engine: "naver-clova-speech",
    language: "ko",
    priority: 90,
  });

  const processInline = formData.get("processInline") === "true" || process.env.MOBILE_BACKUP_PROCESS_INLINE === "true";
  if (processInline) {
    try {
      const processed = await processRecordingNow(recording.id);
      return NextResponse.json({ ok: true, id: recording.id, processed });
    } catch (error) {
      const message = error instanceof Error ? error.message : "processing failed";
      await admin
        .from("stt_jobs")
        .update({ status: "failed", error_code: "inline_processing_failed", error_message: message })
        .eq("recording_id", recording.id);
      return NextResponse.json({ ok: true, id: recording.id, queued: true, processingError: message });
    }
  }

  return NextResponse.json({ ok: true, id: recording.id, queued: true });
}
