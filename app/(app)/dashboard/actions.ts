"use server";

import { revalidatePath } from "next/cache";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isUsingSupabaseServer,
} from "@/lib/supabase/server";

// ─────────────────────────────────────────────────────────
// 실패한 STT 잡 재시도
//
// 동작:
//   - 해당 stt_jobs row 를 status='queued' 로 되돌리고 error_* 필드 초기화
//   - recording.status='processing' 으로 동기화
//   - retry_count 는 증가시키지 않음 (워커가 다음 실행 때 ++)
//   - audit_logs 에 update 로 기록
//
// 권한:
//   - mock 모드: 인증 우회
//   - Supabase 모드: 인증된 사용자 + recording 의 owner 만 허용
//     (관리자 role 이 도입되면 그 검사로 교체)
// ─────────────────────────────────────────────────────────

export type RetryResult =
  | { ok: true; jobId: string; mock?: boolean }
  | { ok: false; error: string; code: "auth" | "not_found" | "forbidden" | "db_error" };

export async function retryFailedJob(jobId: string): Promise<RetryResult> {
  if (!isUsingSupabaseServer()) {
    // mock 모드: 시뮬레이션만
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true, jobId, mock: true };
  }

  // 1) 인증 사용자 확인
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "로그인이 필요합니다.", code: "auth" };
  }

  // 2) 잡과 recording 정보 조회 (admin 으로 — 관리자 화면)
  const admin = createSupabaseAdminClient();
  const { data: job, error: jobErr } = await admin
    .from("stt_jobs")
    .select("id, recording_id, status, recordings:recording_id(owner_id)")
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr || !job) {
    return { ok: false, error: "잡을 찾을 수 없습니다.", code: "not_found" };
  }

  // 3) 권한 — recording owner 본인만 (관리자 role 도입 전 보호장치)
  const ownerId = (job as { recordings: { owner_id: string | null } | null })
    .recordings?.owner_id;
  if (ownerId && ownerId !== user.id) {
    return {
      ok: false,
      error: "이 통화에 대한 재시도 권한이 없습니다.",
      code: "forbidden",
    };
  }

  // 4) 잡 → queued 로 되돌리기
  const { error: updErr } = await admin
    .from("stt_jobs")
    .update({
      status: "queued",
      started_at: null,
      completed_at: null,
      error_code: null,
      error_message: null,
    })
    .eq("id", jobId);

  if (updErr) {
    return {
      ok: false,
      error: `잡 갱신 실패: ${updErr.message}`,
      code: "db_error",
    };
  }

  // 5) recording.status 동기화
  await admin
    .from("recordings")
    .update({ status: "processing" })
    .eq("id", (job as { recording_id: string }).recording_id);

  // 6) audit log
  await admin.from("audit_logs").insert({
    user_id: user.id,
    action: "update",
    resource_type: "stt_job",
    resource_id: jobId,
    metadata: { reason: "retry_failed_job" } as never,
  });

  revalidatePath("/dashboard");
  revalidatePath("/recordings");
  revalidatePath(`/recordings/${(job as { recording_id: string }).recording_id}`);

  return { ok: true, jobId };
}
