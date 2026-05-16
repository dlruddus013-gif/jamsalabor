"use server";

import { revalidatePath } from "next/cache";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isUsingSupabaseServer,
} from "@/lib/supabase/server";
import {
  STORAGE_BUCKET,
  getExtension,
  sanitizeFilename,
  validateAudioFile,
} from "@/lib/upload";
import { inferRecordingCategory, mergeRecordingTags } from "@/lib/recording-category";

// ─────────────────────────────────────────────────────────
// Upload Server Action
//
// 클라이언트가 FormData 로 전송:
//   - file:    File           (필수)
//   - source:  string         (선택, 'upload' | 'mobile_recording' | 'web_recording')
//   - title:   string         (선택, recording 제목)
//
// 처리:
//   1) 파일 검증 (서버 측 재검증)
//   2) Mock 모드면 가짜 id 반환
//   3) 인증 체크
//   4) Storage 업로드 (RLS: 경로가 user.id 로 시작)
//   5) recordings INSERT (RLS: owner_id = user.id)
//   6) 실패 시 Storage 객체 롤백
//   7) stt_jobs INSERT (admin)
//   8) audit_logs INSERT (admin)
//   9) /recordings, /dashboard 캐시 무효화
//
// 참고: Next.js 15 server action 기본 body limit 1MB → next.config.mjs 에서 110MB 로 상향.
// ─────────────────────────────────────────────────────────

const ALLOWED_SOURCES = ["upload", "mobile_recording", "web_recording", "phone_backup"] as const;
type AllowedSource = (typeof ALLOWED_SOURCES)[number];

export type UploadErrorCode =
  | "no_file"
  | "invalid_file"
  | "unauthenticated"
  | "quota_exceeded"
  | "storage_error"
  | "db_error"
  | "unknown";

export type UploadResult =
  | { ok: true; id: string; mock?: boolean; duplicate?: boolean }
  | { ok: false; error: string; code: UploadErrorCode };

export async function registerDirectUploadedRecording(
  formData: FormData
): Promise<UploadResult> {
  if (!isUsingSupabaseServer()) {
    await new Promise((r) => setTimeout(r, 250));
    return { ok: true, id: "rec_001", mock: true };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { ok: false, error: "로그인이 필요합니다.", code: "unauthenticated" };
    }

    const path = String(formData.get("path") || "");
    const originalName = String(formData.get("originalName") || "");
    const contentType = String(formData.get("contentType") || "audio/mpeg");
    const size = Number(formData.get("size") || 0);
    const sourceInput = formData.get("source");
    const source: AllowedSource =
      typeof sourceInput === "string" && (ALLOWED_SOURCES as readonly string[]).includes(sourceInput)
        ? (sourceInput as AllowedSource)
        : "upload";
    const titleInput = formData.get("title");
    const title = typeof titleInput === "string" && titleInput.trim().length > 0 ? titleInput.trim().slice(0, 200) : null;
    const originalPath = String(formData.get("relativePath") || formData.get("originalPath") || "");
    const category = inferRecordingCategory({ source, filename: originalName, path, originalPath });
    const tags = mergeRecordingTags([], category);

    if (!path || !path.startsWith(`${user.id}/`)) {
      return { ok: false, error: "Storage 경로가 올바르지 않습니다.", code: "storage_error" };
    }
    if (!originalName || !Number.isFinite(size) || size <= 0) {
      return { ok: false, error: "업로드 메타데이터가 올바르지 않습니다.", code: "invalid_file" };
    }

    const validation = validateAudioFile({ name: originalName, size, type: contentType });
    if (!validation.valid) {
      return { ok: false, error: validation.reason, code: "invalid_file" };
    }

    const duplicate = await findDuplicateRecording(supabase, {
      ownerId: user.id,
      source,
      originalName,
      originalPath,
      size,
    });
    if (duplicate?.id) {
      await rollbackStorage(path);
      return { ok: true, id: duplicate.id, duplicate: true };
    }

    const { data: canStore, error: quotaError } = await supabase.rpc("can_store_recording", {
      p_owner_id: user.id,
      p_bytes: size,
    });
    if (!quotaError && canStore === false) {
      return {
        ok: false,
        error: "클라우드 보관 용량 1TB 한도를 초과합니다. 기존 파일을 정리하거나 할당량을 늘려 주세요.",
        code: "quota_exceeded",
      };
    }

    const metadata: Record<string, unknown> = { original_filename: originalName, direct_storage_upload: true };
    if (originalPath) metadata.original_path = originalPath;
    if (title) metadata.title = title;

    const { data: recording, error: insertError } = await supabase
      .from("recordings")
      .insert({
        owner_id: user.id,
        title: title ?? originalName.replace(/\.[^.]+$/, ""),
        recorded_at: new Date().toISOString(),
        duration_sec: 0,
        audio_path: path,
        audio_mime: contentType,
        audio_size_bytes: size,
        status: "processing",
        source,
        category,
        tags,
        metadata,
      })
      .select("id")
      .single();

    if (insertError || !recording) {
      await rollbackStorage(path);
      return {
        ok: false,
        error: `메타데이터 저장 실패: ${insertError?.message ?? "unknown"}`,
        code: "db_error",
      };
    }

    const admin = createSupabaseAdminClient();
    const { error: jobError } = await admin.from("stt_jobs").insert({
      recording_id: recording.id,
      status: "queued",
      engine: "naver-clova-speech",
      language: "ko",
      priority: 100,
    });
    if (jobError) console.error("[direct-upload] stt_jobs insert failed:", jobError);

    await admin.from("audit_logs").insert({
      user_id: user.id,
      action: "create",
      resource_type: "recording",
      resource_id: recording.id,
      metadata: {
        original_filename: originalName,
        size_bytes: size,
        mime: contentType,
        path,
        source,
        direct_storage_upload: true,
        ...(title ? { title } : {}),
      },
    });

    revalidatePath("/recordings");
    revalidatePath("/dashboard");
    return { ok: true, id: recording.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return { ok: false, error: `예기치 못한 오류: ${msg}`, code: "unknown" };
  }
}

export async function uploadRecording(
  formData: FormData
): Promise<UploadResult> {
  const raw = formData.get("file");
  if (!(raw instanceof File)) {
    return { ok: false, error: "file is required", code: "no_file" };
  }
  const file = raw;

  const sourceInput = formData.get("source");
  const source: AllowedSource =
    typeof sourceInput === "string" &&
    (ALLOWED_SOURCES as readonly string[]).includes(sourceInput)
      ? (sourceInput as AllowedSource)
      : "upload";

  const titleInput = formData.get("title");
  const title =
    typeof titleInput === "string" && titleInput.trim().length > 0
      ? titleInput.trim().slice(0, 200)
      : null;
  const originalPath = String(formData.get("relativePath") || formData.get("originalPath") || "");

  const validation = validateAudioFile({
    name: file.name,
    size: file.size,
    type: file.type,
  });
  if (!validation.valid) {
    return { ok: false, error: validation.reason, code: "invalid_file" };
  }

  if (!isUsingSupabaseServer()) {
    await new Promise((r) => setTimeout(r, 1000));
    return { ok: true, id: "rec_001", mock: true };
  }

  let uploadedPath: string | null = null;

  try {
    const admin = createSupabaseAdminClient();
    const supabase = admin;
    const ownerId = String(formData.get("ownerId") || process.env.MOBILE_BACKUP_OWNER_ID || "").trim() || null;

    if (ownerId) {
      const { data: canStore, error: quotaError } = await supabase.rpc("can_store_recording", {
        p_owner_id: ownerId,
        p_bytes: file.size,
      });
      if (!quotaError && canStore === false) {
        return { ok: false, error: "cloud storage quota exceeded", code: "quota_exceeded" };
      }
    }

    const ext = getExtension(file.name) || "bin";
    const safeBase = sanitizeFilename(file.name);
    const path = `phone-backups/${Date.now()}_${safeBase}`;
    const contentType = file.type || `audio/${ext}`;

    const duplicate = await findDuplicateRecording(supabase, {
      ownerId,
      source,
      originalName: file.name,
      originalPath,
      size: file.size,
    });
    if (duplicate?.id) {
      return { ok: true, id: duplicate.id, duplicate: true };
    }

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, { contentType, upsert: false, cacheControl: "3600" });

    if (uploadError) {
      return { ok: false, error: `Storage upload failed: ${uploadError.message}`, code: "storage_error" };
    }
    uploadedPath = path;

    const metadata: Record<string, unknown> = { original_filename: file.name };
    if (originalPath) metadata.original_path = originalPath;
    if (title) metadata.title = title;

    const category = inferRecordingCategory({ source, filename: file.name, path, originalPath });
    const tags = mergeRecordingTags([], category);

    const { data: recording, error: insertError } = await supabase
      .from("recordings")
      .insert({
        owner_id: ownerId,
        title: title ?? file.name.replace(/\.[^.]+$/, ""),
        recorded_at: new Date(file.lastModified || Date.now()).toISOString(),
        duration_sec: 0,
        audio_path: path,
        audio_mime: contentType,
        audio_size_bytes: file.size,
        status: "processing",
        source,
        category,
        tags,
        metadata,
      })
      .select("id")
      .single();

    if (insertError || !recording) {
      await rollbackStorage(uploadedPath);
      return { ok: false, error: `recording insert failed: ${insertError?.message ?? "unknown"}`, code: "db_error" };
    }

    const { error: jobError } = await admin.from("stt_jobs").insert({
      recording_id: recording.id,
      status: "queued",
      engine: "naver-clova-speech",
      language: "ko",
      priority: 100,
    });
    if (jobError) console.error("[upload] stt_jobs insert failed:", jobError);

    const { error: auditError } = await admin.from("audit_logs").insert({
      user_id: ownerId,
      action: "create",
      resource_type: "recording",
      resource_id: recording.id,
      metadata: { original_filename: file.name, size_bytes: file.size, mime: contentType, path, source, ...(title ? { title } : {}) },
    });
    if (auditError) console.error("[upload] audit_logs insert failed:", auditError);

    revalidatePath("/recordings");
    revalidatePath("/dashboard");

    return { ok: true, id: recording.id };
  } catch (e) {
    if (uploadedPath) await rollbackStorage(uploadedPath);
    const msg = e instanceof Error ? e.message : "unknown error";
    return { ok: false, error: `unexpected error: ${msg}`, code: "unknown" };
  }
}

async function rollbackStorage(path: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.storage.from(STORAGE_BUCKET).remove([path]);
  } catch (e) {
    console.error("[upload] storage rollback failed:", e);
  }
}

async function findDuplicateRecording(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: {
    ownerId: string | null;
    source: AllowedSource;
    originalName: string;
    originalPath: string;
    size: number;
  }
): Promise<{ id: string } | null> {
  const metadataFilter: Record<string, string> = {
    original_filename: input.originalName,
  };
  if (input.originalPath) metadataFilter.original_path = input.originalPath;

  let query = supabase
    .from("recordings")
    .select("id")
    .eq("source", input.source)
    .eq("audio_size_bytes", input.size)
    .contains("metadata", metadataFilter);

  query = input.ownerId ? query.eq("owner_id", input.ownerId) : query.is("owner_id", null);

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[upload] duplicate lookup failed:", error);
    return null;
  }
  return data as { id: string } | null;
}
