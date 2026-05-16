import "server-only";

import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isUsingSupabaseServer,
} from "@/lib/supabase/server";
import { STORAGE_BUCKET } from "@/lib/upload";
import {
  getRecordingById,
  getTranscriptByRecordingId,
} from "@/lib/mock-data";
import type { Recording, TranscriptSegment, ActionItem } from "@/lib/types";

// ─────────────────────────────────────────────────────────
// 상세 페이지에서 사용할 view-model
// ─────────────────────────────────────────────────────────

export interface RecordingSummaryView {
  bullets: string[];
  actions: ActionItem[];
  keyTopics: string[];
  model: string | null;
  createdAt: string | null;
}

export interface JobError {
  code: string | null;
  message: string | null;
  retryCount: number;
}

export interface RecordingDetail {
  recording: Recording;
  transcript: TranscriptSegment[];
  summary: RecordingSummaryView | null;
  audioUrl: string | null;     // 재생용 signed URL
  jobError: JobError | null;   // status='failed' 일 때만 채워짐
  source: "supabase" | "mock";
}

const SIGNED_URL_TTL_SEC = 60 * 60; // 1시간

// ─────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────

export interface FetchOptions {
  /**
   * true 이면 transcript_segments.text_raw / recording_summaries.summary_raw 등
   * 마스킹 전 원본 컬럼을 우선 사용합니다. service_role 클라이언트가 필요하므로
   * 호출자는 사전에 관리자 권한을 검증해야 합니다.
   */
  admin?: boolean;
}

export async function fetchRecordingDetail(
  id: string,
  options: FetchOptions = {}
): Promise<RecordingDetail | null> {
  if (!isUsingSupabaseServer()) {
    return loadFromMock(id, options);
  }
  return loadFromSupabase(id, options);
}

// ─────────────────────────────────────────────────────────
// Mock 모드
// ─────────────────────────────────────────────────────────

function loadFromMock(
  id: string,
  _options: FetchOptions = {}
): RecordingDetail | null {
  const recording = getRecordingById(id);
  if (!recording) return null;

  const transcript = getTranscriptByRecordingId(id);

  // Recording 자체에 들어 있는 summary[], actions[] 를 view-model 로 변환
  const summary: RecordingSummaryView | null =
    recording.summary.length > 0 || recording.actions.length > 0
      ? {
          bullets: recording.summary,
          actions: recording.actions,
          keyTopics: recording.tags.slice(0, 5),
          model: "mock-summarizer",
          createdAt: recording.created_at,
        }
      : null;

  // mock 에서 status='failed' 인 데이터를 만나면 가짜 에러 정보 노출
  const jobError: JobError | null =
    recording.status === "failed"
      ? {
          code: "MockFailure",
          message: "mock 데이터에서 임의로 설정된 실패 상태입니다.",
          retryCount: 1,
        }
      : null;

  return {
    recording,
    transcript,
    summary,
    audioUrl: null,
    jobError,
    source: "mock",
  };
}

// ─────────────────────────────────────────────────────────
// Supabase 모드
// ─────────────────────────────────────────────────────────

async function loadFromSupabase(
  id: string,
  options: FetchOptions = {}
): Promise<RecordingDetail | null> {
  const supabase = createSupabaseAdminClient();
  const useAdmin = !!options.admin;

  // ── 1) recording ──────────────────────────────────────
  const { data: rec, error: recErr } = await supabase
    .from("recordings")
    .select(
      "id, created_at, recorded_at, title, customer_name, customer_phone, duration_sec, audio_path, audio_mime, status, sentiment, risk_level, resolved, escalated, tags, excerpt, category"
    )
    .eq("id", id)
    .maybeSingle();

  if (recErr) {
    console.error("[recordings] fetch failed:", recErr);
    return null;
  }
  if (!rec) return null;

  // ── 2) transcript_segments ────────────────────────────
  // 관리자 모드: text_raw 함께 가져와 우선 사용
  // 일반 모드: text 만 (RLS GRANT 가 text_raw 차단)
  const segCols = useAdmin
    ? "id, recording_id, start_sec, end_sec, speaker, text, text_raw"
    : "id, recording_id, start_sec, end_sec, speaker, text";

  const { data: segs, error: segErr } = await supabase
    .from("transcript_segments")
    .select(segCols)
    .eq("recording_id", id)
    .order("start_sec", { ascending: true });

  if (segErr) {
    console.error("[recordings] transcript fetch failed:", segErr);
  }

  // ── 3) recording_summaries (현재 활성 1건) ────────────
  const sumCols = useAdmin
    ? "summary, summary_raw, action_items, action_items_raw, key_topics, model, created_at, sentiment"
    : "summary, action_items, key_topics, model, created_at, sentiment";

  const { data: sumRow, error: sumErr } = await supabase
    .from("recording_summaries")
    .select(sumCols)
    .eq("recording_id", id)
    .eq("is_current", true)
    .maybeSingle();

  if (sumErr) {
    console.error("[recordings] summary fetch failed:", sumErr);
  }

  // ── 4) status='failed' 시 마지막 stt_jobs 에러 정보 ───
  let jobError: JobError | null = null;
  if (rec.status === "failed") {
    const { data: jobRow } = await supabase
      .from("stt_jobs")
      .select("error_code, error_message, retry_count")
      .eq("recording_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (jobRow) {
      jobError = {
        code: jobRow.error_code,
        message: jobRow.error_message,
        retryCount: jobRow.retry_count ?? 0,
      };
    }
  }

  // ── 5) Storage signed URL (재생용) ────────────────────
  let audioUrl: string | null = null;
  if (rec.audio_path) {
    const { data: signed, error: urlErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(rec.audio_path, SIGNED_URL_TTL_SEC);
    if (urlErr) {
      console.error("[recordings] signed url failed:", urlErr);
    } else {
      audioUrl = signed?.signedUrl ?? null;
    }
  }

  // ── 6) view-model 변환 ────────────────────────────────
  const recording: Recording = {
    id: rec.id,
    created_at: rec.created_at,
    recorded_at: rec.recorded_at,
    title: rec.title,
    customer_name: rec.customer_name,
    customer_phone: rec.customer_phone,
    duration_sec: rec.duration_sec ?? 0,
    audio_url: audioUrl,
    status: rec.status,
    sentiment: rec.sentiment,
    risk_level: rec.risk_level,
    resolved: rec.resolved ?? false,
    escalated: rec.escalated ?? false,
    tags: rec.tags ?? [],
    summary: sumRow?.summary ?? [],
    actions: normalizeActions(sumRow?.action_items),
    excerpt: rec.excerpt,
    category: rec.category,
  };

  const transcript: TranscriptSegment[] = (segs ?? []).map((s: any) => {
    // admin 모드면 text_raw 가 있을 때 우선 사용 — 없으면 마스킹된 text 폴백
    const row = s as {
      id: string;
      recording_id: string;
      start_sec: number;
      end_sec: number;
      speaker: TranscriptSegment["speaker"];
      text: string;
      text_raw?: string | null;
    };
    return {
      id: row.id,
      recording_id: row.recording_id,
      start_sec: row.start_sec,
      end_sec: row.end_sec,
      speaker: row.speaker,
      text: useAdmin && row.text_raw ? row.text_raw : row.text,
    };
  });

  const summary: RecordingSummaryView | null = sumRow
    ? (() => {
        const row = sumRow as {
          summary: string[] | null;
          summary_raw?: string[] | null;
          action_items: unknown;
          action_items_raw?: unknown;
          key_topics: string[] | null;
          model: string | null;
          created_at: string;
        };
        const bullets =
          useAdmin && row.summary_raw && row.summary_raw.length > 0
            ? row.summary_raw
            : row.summary ?? [];
        const actionsSrc =
          useAdmin && row.action_items_raw ? row.action_items_raw : row.action_items;
        return {
          bullets,
          actions: normalizeActions(actionsSrc),
          keyTopics: row.key_topics ?? [],
          model: row.model,
          createdAt: row.created_at,
        };
      })()
    : null;

  return {
    recording,
    transcript,
    summary,
    audioUrl,
    jobError,
    source: "supabase",
  };
}

// ─────────────────────────────────────────────────────────
// 보조: action_items jsonb → ActionItem[]
// ─────────────────────────────────────────────────────────

function normalizeActions(raw: unknown): ActionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a, i) => {
      if (typeof a !== "object" || a === null) return null;
      const obj = a as Record<string, unknown>;
      const text = typeof obj.text === "string" ? obj.text : null;
      if (!text) return null;
      return {
        id:
          typeof obj.id === "string" && obj.id.length > 0
            ? obj.id
            : `act_${i}`,
        text,
        done: !!obj.done,
      } as ActionItem;
    })
    .filter((a): a is ActionItem => a !== null);
}
