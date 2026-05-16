import { NextResponse } from "next/server";
import {
  authorizeRecordingAccess,
  extractClientMeta,
  logDownloadAudit,
} from "@/lib/api/auth";
import { buildFilename, contentDisposition } from "@/lib/api/exporters";
import { fetchRecordingDetail } from "@/lib/recordings";
import { STORAGE_BUCKET } from "@/lib/upload";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

// ─────────────────────────────────────────────────────────
// GET /api/recordings/[id]/download-audio
//
// 오디오 파일을 사용자가 다운로드할 수 있도록 스트림으로 응답합니다.
// service_role 로 Storage 에서 다운로드 후 Content-Disposition: attachment
// 헤더를 붙여 그대로 전송 — 클라이언트에서 별도 추가 요청 없이 저장됩니다.
// ─────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1) 권한
  const access = await authorizeRecordingAccess(id);
  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  // 2) recording 정보
  const detail = await fetchRecordingDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "통화를 찾을 수 없습니다." }, { status: 404 });
  }
  const { recording } = detail;

  // 3) audio_path 존재 검사
  // mock 모드에서는 audio 파일이 없으므로 친절한 에러 반환
  if (access.source === "mock" || !recording.audio_url) {
    // mock 모드: audio 파일이 실제로 없으니 안내
    if (access.source === "mock") {
      return NextResponse.json(
        {
          error:
            "mock 모드에서는 오디오 다운로드를 지원하지 않습니다. Supabase 모드에서 사용하세요.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "이 통화에는 첨부된 오디오 파일이 없습니다." },
      { status: 404 }
    );
  }

  // 4) Supabase Storage 에서 직접 다운로드 (admin: 임의 경로 처리 가능)
  const admin = createSupabaseAdminClient();

  // recording row 의 audio_path 를 다시 조회 — fetchRecordingDetail 은 signed URL 만 보유
  const { data: pathRow, error: pathErr } = await admin
    .from("recordings")
    .select("audio_path, audio_mime")
    .eq("id", id)
    .maybeSingle();

  if (pathErr || !pathRow?.audio_path) {
    return NextResponse.json(
      { error: "오디오 경로를 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  const { data: blob, error: dlErr } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(pathRow.audio_path);

  if (dlErr || !blob) {
    return NextResponse.json(
      { error: `Storage 다운로드 실패: ${dlErr?.message ?? "unknown"}` },
      { status: 502 }
    );
  }

  // 5) 파일명 — 원본 확장자 보존
  const ext = guessExtension(pathRow.audio_mime, pathRow.audio_path);
  const filename = buildFilename(recording, ext);

  // 6) audit log
  const { ip, userAgent } = extractClientMeta(req);
  await logDownloadAudit({
    userId: access.userId,
    recordingId: id,
    metadata: {
      format: "audio",
      filename,
      size_bytes: blob.size,
      masked: false,
    },
    ip,
    userAgent,
  });

  // 7) 응답
  // Blob → ArrayBuffer 로 변환해 Response body 로 전달
  const buf = await blob.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": pathRow.audio_mime || "application/octet-stream",
      "Content-Disposition": contentDisposition(filename),
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

// ─────────────────────────────────────────────────────────
// 확장자 추정
// ─────────────────────────────────────────────────────────

function guessExtension(mime: string | null, path: string): string {
  // 1) 경로에서 확장자
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(path);
  if (m) return m[1].toLowerCase();

  // 2) MIME 매핑
  switch ((mime || "").toLowerCase()) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
      return "wav";
    case "audio/m4a":
    case "audio/x-m4a":
    case "audio/mp4":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/webm":
      return "webm";
    default:
      return "audio";
  }
}
