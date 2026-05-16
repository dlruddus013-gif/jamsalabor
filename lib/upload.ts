// ─────────────────────────────────────────────────────────
// 업로드 검증 유틸 (클라이언트·서버 공통)
//
// 클라이언트에서는 즉시 피드백, 서버 액션에서는 재검증을 위해 사용합니다.
// 'use client' / 'use server' 지시어 없는 순수 모듈이므로 양쪽 모두 import 가능.
// ─────────────────────────────────────────────────────────

export const ACCEPTED_EXTENSIONS = ["mp3", "m4a", "wav", "webm"] as const;
export type AcceptedExt = (typeof ACCEPTED_EXTENSIONS)[number];

/**
 * 브라우저별로 같은 파일 형식을 다른 MIME 타입으로 보고하므로
 * 화이트리스트 패턴으로 정리.
 */
export const ACCEPTED_MIME_PATTERNS: RegExp[] = [
  /^audio\/mpeg$/,
  /^audio\/mp3$/,
  /^audio\/mp4$/,
  /^audio\/m4a$/,
  /^audio\/x-m4a$/,
  /^audio\/wav$/,
  /^audio\/x-wav$/,
  /^audio\/wave$/,
  /^audio\/webm$/,
];

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
export const MIN_FILE_SIZE = 100;               // 100 B (그 미만은 잘못된 파일)

/**
 * Supabase Storage 버킷 이름.
 * 환경변수로 override 가능, 기본값 'recordings'.
 */
export const STORAGE_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_AUDIO_BUCKET ?? "recordings";

// ─────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────

export function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 파일명을 안전한 storage key 로 변환.
 * 한글·특수문자 제거, 길이 제한.
 */
export function sanitizeFilename(name: string, maxLen = 60): string {
  const base = name.replace(/[^\w.-]/g, "_").replace(/_+/g, "_");
  return base.length > maxLen ? base.slice(0, maxLen) : base;
}

// ─────────────────────────────────────────────────────────
// 검증
// ─────────────────────────────────────────────────────────

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

export function validateAudioFile(
  file: { name: string; size: number; type: string }
): ValidationResult {
  if (file.size < MIN_FILE_SIZE) {
    return { valid: false, reason: "파일이 비어 있거나 손상되었습니다." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      reason: `파일 크기 ${formatBytes(file.size)} 가 한도(${formatBytes(MAX_FILE_SIZE)})를 초과합니다.`,
    };
  }

  const ext = getExtension(file.name);
  if (!ext) {
    return { valid: false, reason: "확장자가 없는 파일입니다." };
  }
  if (!ACCEPTED_EXTENSIONS.includes(ext as AcceptedExt)) {
    return {
      valid: false,
      reason: `지원하지 않는 형식 .${ext} — mp3, m4a, wav, webm 만 허용됩니다.`,
    };
  }

  // MIME 은 보조 검사 — 일부 브라우저는 빈 string 으로 보냄.
  // 값이 있는데 화이트리스트 외인 경우만 거부.
  if (file.type && !ACCEPTED_MIME_PATTERNS.some((re) => re.test(file.type))) {
    return {
      valid: false,
      reason: `MIME 타입 "${file.type}" 이 오디오로 인식되지 않습니다.`,
    };
  }

  return { valid: true };
}
