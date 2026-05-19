import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  createSupabaseAdminClient,
  isUsingSupabaseServer,
} from "@/lib/supabase/server";
import {
  getExtension,
  sanitizeFilename,
  STORAGE_BUCKET,
  validateAudioFile,
} from "@/lib/upload";
import {
  inferRecordingCategory,
  mergeRecordingTags,
} from "@/lib/recording-category";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isUsingSupabaseServer()) {
    return NextResponse.json(
      { ok: false, error: "Supabase environment is required.", code: "supabase_not_configured" },
      { status: 500 }
    );
  }

  const formData = await req.formData();
  const raw = formData.get("file");
  if (!(raw instanceof File)) {
    return NextResponse.json({ ok: false, error: "file is required", code: "no_file" }, { status: 400 });
  }

  const validation = validateAudioFile({ name: raw.name, size: raw.size, type: raw.type });
  if (!validation.valid) {
    return NextResponse.json({ ok: false, error: validation.reason, code: "invalid_file" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const source = "phone_backup";
  const originalPath = stringValue(formData.get("relativePath")) || stringValue(formData.get("originalPath"));
  const sha256 = stringValue(formData.get("sha256")) || null;
  const ownerId = stringValue(formData.get("ownerId")) || process.env.MOBILE_BACKUP_OWNER_ID || null;
  const title =
    stringValue(formData.get("title")) ||
    stringValue(formData.get("filename")).replace(/\.[^.]+$/, "") ||
    raw.name.replace(/\.[^.]+$/, "");
  const recordedAt =
    stringValue(formData.get("recorded_at")) ||
    stringValue(formData.get("recordedAt")) ||
    new Date(raw.lastModified || Date.now()).toISOString();

  if (sha256) {
    const { data: existing, error: duplicateError } = await admin
      .from("recordings")
      .select("id, status")
      .eq("audio_sha256", sha256)
      .maybeSingle();

    if (!duplicateError && existing?.id) {
      return NextResponse.json({ ok: true, duplicate: true, id: existing.id, status: existing.status });
    }
  }

  if (ownerId) {
    const { data: canStore, error: quotaError } = await admin.rpc("can_store_recording", {
      p_owner_id: ownerId,
      p_bytes: raw.size,
    });
    if (!quotaError && canStore === false) {
      return NextResponse.json(
        { ok: false, error: "cloud storage quota exceeded", code: "quota_exceeded" },
        { status: 413 }
      );
    }
  }

  const ext = getExtension(raw.name) || "bin";
  const safeName = sanitizeFilename(raw.name, 90);
  const storagePath = `phone-backups/${Date.now()}_${safeName}`;
  const contentType = raw.type || `audio/${ext}`;
  const category = inferRecordingCategory({
    source,
    filename: raw.name,
    path: storagePath,
    originalPath,
  });
  const tags = mergeRecordingTags([], category);

  const { error: uploadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, raw, { contentType, upsert: false, cacheControl: "3600" });

  if (uploadError) {
    return NextResponse.json(
      { ok: false, error: `Storage upload failed: ${uploadError.message}`, code: "storage_error" },
      { status: 500 }
    );
  }

  const { data: recording, error: insertError } = await admin
    .from("recordings")
    .insert({
      owner_id: ownerId,
      title: title.slice(0, 200),
      recorded_at: recordedAt,
      duration_sec: Number(formData.get("durationSec") || 0),
      audio_path: storagePath,
      audio_mime: contentType,
      audio_size_bytes: raw.size,
      audio_sha256: sha256,
      status: "processing",
      source,
      category,
      tags,
      metadata: {
        original_filename: raw.name,
        original_path: originalPath,
        backup_client: "web-backup",
      },
    })
    .select("id")
    .single();

  if (insertError || !recording?.id) {
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json(
      { ok: false, error: `recording insert failed: ${insertError?.message ?? "unknown"}`, code: "db_error" },
      { status: 500 }
    );
  }

  const { error: jobError } = await admin.from("stt_jobs").insert({
    recording_id: recording.id,
    status: "queued",
    engine: "naver-clova-speech",
    language: "ko",
    priority: 100,
  });
  if (jobError) console.error("[mobile-backup/upload] stt_jobs insert failed:", jobError);

  revalidatePath("/recordings");
  revalidatePath("/dashboard");
  return NextResponse.json({ ok: true, id: recording.id, queued: true });
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}
