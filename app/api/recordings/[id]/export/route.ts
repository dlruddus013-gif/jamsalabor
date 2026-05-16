import { NextResponse } from "next/server";
import {
  authorizeRecordingAccess,
  extractClientMeta,
  isAdminUser,
  logDownloadAudit,
} from "@/lib/api/auth";
import {
  EXPORT_FORMATS,
  FORMAT_MIME,
  buildFilename,
  contentDisposition,
  toCsv,
  toJson,
  toSrt,
  toTxt,
  toVtt,
  type ExportFormat,
} from "@/lib/api/exporters";
import { maskRecording, maskSegments, maskText } from "@/lib/api/privacy";
import { fetchRecordingDetail, type RecordingSummaryView } from "@/lib/recordings";

// ─────────────────────────────────────────────────────────
// GET /api/recordings/[id]/export
//
// 쿼리:
//   format=txt|csv|json|srt|vtt    (필수, 기본 txt)
//   mask=true                       외부 공유용 마스킹 (기본 동작)
//   original=true                   관리자 원본 다운로드 — 권한 필요
//
// 정책:
//   - 일반 사용자에게 mask=false 또는 original=true 는 허용되지 않음
//     (text_raw 컬럼에 GRANT 가 없으므로 어차피 fetch 단계에서 못 읽음)
//   - 관리자(JWT user_metadata.role=admin) 만 original=true 사용 가능
//   - mock 모드에서는 원본·마스킹 모두 가짜 데이터로 시뮬레이션
//
// audit_logs.action:
//   - 마스킹 다운로드  → 'masked_export'
//   - 원본 다운로드    → 'original_export'
// ─────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1) 쿼리 파싱
  const url = new URL(req.url);
  const formatRaw = (url.searchParams.get("format") || "txt").toLowerCase();
  const wantsMask = parseBool(url.searchParams.get("mask"));
  const wantsOriginal = parseBool(url.searchParams.get("original"));

  if (!isExportFormat(formatRaw)) {
    return NextResponse.json(
      {
        error: `지원하지 않는 포맷: ${formatRaw}`,
        supported: EXPORT_FORMATS,
      },
      { status: 400 }
    );
  }
  const format: ExportFormat = formatRaw;

  // 2) 권한
  const access = await authorizeRecordingAccess(id);
  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  // 3) 관리자 권한 체크 — original 다운로드는 관리자만
  let admin = false;
  if (wantsOriginal) {
    admin = await isAdminUser();
    if (!admin && access.source === "supabase") {
      return NextResponse.json(
        {
          error:
            "원본 다운로드는 관리자 권한이 필요합니다. (?original=true)",
        },
        { status: 403 }
      );
    }
  }

  // 4) 데이터 로드 — admin 모드일 때 raw 컬럼 사용
  const detail = await fetchRecordingDetail(id, { admin: wantsOriginal && admin });
  if (!detail) {
    return NextResponse.json({ error: "통화를 찾을 수 없습니다." }, { status: 404 });
  }

  // 5) 마스킹 결정
  // - original=true 가 명시되었고 권한 통과 → 마스킹 안 함
  // - 그 외에는 항상 마스킹 (기본 안전)
  const applyMask = !(wantsOriginal && (admin || access.source === "mock"));

  // 호환: ?mask=false 만 지정한 일반 사용자 → 무시하고 항상 마스킹
  // (요구 3번: 외부 공유용 마스킹 다운로드와 관리자 원본을 명확히 구분)
  void wantsMask; // 호환을 위해 받기만 하고 실제 정책에는 영향 없음

  const recording = applyMask
    ? maskRecording(detail.recording)
    : detail.recording;
  const segments = applyMask
    ? maskSegments(detail.transcript)
    : detail.transcript;
  const summary = applyMask ? maskSummary(detail.summary) : detail.summary;

  // 6) 포맷 변환
  const body: string = (() => {
    switch (format) {
      case "txt":
        return toTxt(recording, segments, summary);
      case "csv":
        return toCsv(segments);
      case "json":
        return toJson(recording, segments, summary, { masked: applyMask });
      case "srt":
        return toSrt(segments);
      case "vtt":
        return toVtt(segments);
    }
  })();

  // 7) 파일명 — 원본 다운로드는 _original 접미사 추가 (식별 용이)
  const baseName = buildFilename(recording, format);
  const filename = applyMask
    ? baseName
    : baseName.replace(/(\.[^.]+)$/, "_original$1");

  // 8) audit log — 마스킹/원본을 명시적 action 으로 분리
  const { ip, userAgent } = extractClientMeta(req);
  const sizeBytes = new TextEncoder().encode(body).length;
  await logDownloadAudit({
    userId: access.userId,
    recordingId: id,
    action: applyMask ? "masked_export" : "original_export",
    metadata: {
      format,
      filename,
      size_bytes: sizeBytes,
      masked: applyMask,
      mode: applyMask ? "masked_export" : "original_export",
    },
    ip,
    userAgent,
  });

  // 9) 응답
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": FORMAT_MIME[format],
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": "private, no-store",
      // 어떤 모드로 응답했는지 클라이언트가 확인 가능
      "X-Export-Mode": applyMask ? "masked" : "original",
    },
  });
}

// ─────────────────────────────────────────────────────────
// 보조
// ─────────────────────────────────────────────────────────

function maskSummary(
  summary: RecordingSummaryView | null
): RecordingSummaryView | null {
  if (!summary) return null;
  return {
    ...summary,
    bullets: summary.bullets.map(maskText),
    actions: summary.actions.map((a) => ({ ...a, text: maskText(a.text) })),
  };
}

function isExportFormat(s: string): s is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(s);
}

function parseBool(v: string | null): boolean {
  if (!v) return false;
  const lower = v.toLowerCase();
  return lower === "1" || lower === "true" || lower === "yes" || lower === "on";
}
