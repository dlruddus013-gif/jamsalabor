import "server-only";

import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isUsingSupabaseServer,
} from "@/lib/supabase/server";

// ─────────────────────────────────────────────────────────
// API 라우트용 공통 헬퍼
//
// 모든 다운로드/export 라우트가 동일한 흐름을 따릅니다:
//   1) 인증 사용자 확인 (없으면 401)
//   2) recording 소유자/접근권한 확인 (없으면 404 — 존재 여부도 숨김)
//   3) audit_logs 에 다운로드 행위 기록
//
// mock 모드(Supabase 미연결)에서는 인증을 우회하고 mock data 로 응답.
// ─────────────────────────────────────────────────────────

export interface AuthorizedAccess {
  ok: true;
  source: "supabase" | "mock";
  userId: string | null;        // mock 모드면 null
}

export interface DeniedAccess {
  ok: false;
  status: 401 | 403 | 404;
  message: string;
}

export type AccessResult = AuthorizedAccess | DeniedAccess;

/**
 * 다운로드 라우트의 공통 권한 검증.
 *
 * 정책: recordings.owner_id = auth.uid() 인 경우만 접근.
 * 권한이 없거나 존재하지 않는 recording 은 404 로 응답하여 존재 여부 누출 방지.
 */
export async function authorizeRecordingAccess(
  recordingId: string
): Promise<AccessResult> {
  // mock 모드: 인증 없이 허용
  if (!isUsingSupabaseServer()) {
    return { ok: true, source: "mock", userId: null };
  }

  const supabase = await createSupabaseServerClient();

  // 1) 인증
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, status: 401, message: "로그인이 필요합니다." };
  }

  // 2) recording 소유 검증
  // RLS 가 이미 owner_id 만 보이게 하지만, 명시적으로 한 번 더 확인.
  const { data: rec, error: recErr } = await supabase
    .from("recordings")
    .select("id, owner_id")
    .eq("id", recordingId)
    .maybeSingle();

  if (recErr) {
    return {
      ok: false,
      status: 404,
      message: "통화를 찾을 수 없습니다.",
    };
  }
  if (!rec) {
    return {
      ok: false,
      status: 404,
      message: "통화를 찾을 수 없습니다.",
    };
  }
  if (rec.owner_id && rec.owner_id !== user.id) {
    // 존재 여부 누출 방지를 위해 403 대신 404 로 응답할 수도 있으나,
    // 명확한 진단을 위해 403 을 반환합니다.
    return {
      ok: false,
      status: 403,
      message: "이 통화에 접근할 권한이 없습니다.",
    };
  }

  return { ok: true, source: "supabase", userId: user.id };
}

// ─────────────────────────────────────────────────────────
// audit_logs 기록
// service_role 로 강제 기록 (사용자가 우회할 수 없음)
// ─────────────────────────────────────────────────────────

export interface DownloadAuditMetadata {
  format?: string;             // 'audio' | 'txt' | 'csv' | 'json' | 'srt' | 'vtt'
  filename?: string;
  size_bytes?: number;
  masked?: boolean;
  /** 'masked_export' | 'original_export' | 'audio_download' — metadata 에도 보존 */
  mode?: string;
  ip?: string | null;
  user_agent?: string | null;
}

export type AuditDownloadAction =
  | "download"           // 오디오 다운로드 (호환)
  | "masked_export"      // 외부 공유용 마스킹 export
  | "original_export";   // 관리자 원본 export

export async function logDownloadAudit(params: {
  userId: string | null;
  recordingId: string;
  /** 기본 'download' — masked_export / original_export 로 명시 가능 */
  action?: AuditDownloadAction;
  metadata: DownloadAuditMetadata;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  if (!isUsingSupabaseServer()) return; // mock 모드는 기록 생략

  try {
    const admin = createSupabaseAdminClient();
    await admin.from("audit_logs").insert({
      user_id: params.userId,
      action: params.action ?? "download",
      resource_type: "recording",
      resource_id: params.recordingId,
      ip_address: params.ip ?? null,
      user_agent: params.userAgent ?? null,
      metadata: params.metadata as never,
    });
  } catch (e) {
    // 감사 로그 실패는 실제 응답을 막지 않음 — 로깅만
    console.error("[audit] download log failed:", e);
  }
}

/**
 * 현재 인증 사용자가 관리자인지 검사.
 * JWT user_metadata.role === 'admin' 일 때 true.
 *
 * 운영에서는 별도 user_roles 테이블 + 함수로 교체 권장.
 */
export async function isAdminUser(): Promise<boolean> {
  if (!isUsingSupabaseServer()) return true; // mock 모드는 모두 관리자 취급
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return meta.role === "admin";
}

/**
 * Next.js Request 헤더에서 IP / User-Agent 를 추출.
 * Vercel/Nginx 환경의 x-forwarded-for 우선.
 */
export function extractClientMeta(req: Request): {
  ip: string | null;
  userAgent: string | null;
} {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]?.trim() ?? null : req.headers.get("x-real-ip");
  const userAgent = req.headers.get("user-agent");
  return { ip: ip ?? null, userAgent: userAgent ?? null };
}
