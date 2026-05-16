// ─────────────────────────────────────────────────────────
// PII 마스킹 (TypeScript)
//
// workers/stt-worker/processors/privacy_masker.py 와 동일한 정책.
// export?mask=true 옵션 처리에 사용.
// ─────────────────────────────────────────────────────────

import type { Recording, TranscriptSegment } from "@/lib/types";

const PATTERNS: { re: RegExp; replace: string }[] = [
  // 주민등록번호: 6자리-7자리
  { re: /\b(\d{6})[- ]?(\d{7})\b/g, replace: "$1-*******" },
  // 카드번호: 16자리 (4-4-4-4 또는 연속)
  { re: /\b(\d{4})[- ]?\d{4}[- ]?\d{4}[- ]?(\d{4})\b/g, replace: "$1-****-****-$2" },
  // 휴대폰: 010-XXXX-XXXX, 010 XXXX XXXX, 01012345678
  { re: /\b(01[016789])[- ]?(\d{3,4})[- ]?(\d{4})\b/g, replace: "$1-$2-****" },
  // 일반 전화: 02-XXX-XXXX, 0XX-XXX-XXXX (구분자 필수 — 휴대폰과 충돌 방지)
  { re: /\b(0\d{1,2})[- ](\d{3,4})[- ](\d{4})\b/g, replace: "$1-$2-****" },
  // 이메일: 로컬파트 일부 마스킹
  {
    re: /\b([A-Za-z0-9._%+-]{1,3})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    replace: "$1***@$2",
  },
  // 계좌/긴 숫자: 8자리 이상 연속 숫자 (휴대폰/주민/카드 보다 뒤)
  { re: /\b\d{8,16}\b/g, replace: "********" },
];

export function maskText(text: string | null | undefined): string {
  if (!text) return text ?? "";
  let out = text;
  for (const { re, replace } of PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}

export function maskSegments(
  segments: TranscriptSegment[]
): TranscriptSegment[] {
  return segments.map((s) => ({ ...s, text: maskText(s.text) }));
}

/**
 * Recording 의 텍스트성 필드(이름/번호/excerpt)와 요약 bullets, 액션 텍스트를 마스킹.
 * 통화 메타까지 함께 export 할 때 사용.
 */
export function maskRecording(rec: Recording): Recording {
  return {
    ...rec,
    customer_name: rec.customer_name, // 이름은 보존 (요구 시 정책 변경 가능)
    customer_phone: maskText(rec.customer_phone),
    excerpt: rec.excerpt ? maskText(rec.excerpt) : null,
    summary: rec.summary.map(maskText),
    actions: rec.actions.map((a) => ({ ...a, text: maskText(a.text) })),
  };
}
