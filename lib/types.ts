// ─────────────────────────────────────────────────────────
// jamsa-vito 도메인/UI 타입
//
// DB 스키마 enum 은 lib/supabase/database.types.ts 에서 재내보내고,
// UI 화면용 view-model (mock data 와 매칭) 은 이 파일에서 정의합니다.
// ─────────────────────────────────────────────────────────

export type {
  RecordingStatus,
  Sentiment,
  SpeakerRole,
  SttJobStatus,
  AuditAction,
  RiskLevel,
  RecordingRow,
  TranscriptSegmentRow,
  RecordingSummaryRow,
  SttJobRow,
  AuditLogRow,
  RecordingWithDetails,
  Tables,
  TablesInsert,
  TablesUpdate,
  Database,
} from "./supabase/database.types";

import type {
  RecordingStatus,
  Sentiment,
  SpeakerRole,
  RiskLevel,
} from "./supabase/database.types";

// ─────────────────────────────────────────────────────────
// UI view-model
// recordings + recording_summaries 의 join 결과를 평탄화한 형태.
// 화면 컴포넌트(RecordingList, 상세) 가 이 형태를 기대합니다.
// mock-data.ts 가 이 형태로 데이터를 제공합니다.
// ─────────────────────────────────────────────────────────

export interface TranscriptSegment {
  id: string;
  recording_id: string;
  start_sec: number;
  end_sec: number;
  speaker: SpeakerRole;
  text: string;
}

export interface ActionItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Recording {
  id: string;
  created_at: string;
  recorded_at: string;
  title: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  duration_sec: number;
  audio_url: string | null;             // Storage 서명 URL (서버에서 발급)
  status: RecordingStatus;
  sentiment: Sentiment | null;
  risk_level: RiskLevel | null;
  resolved: boolean;
  escalated: boolean;
  tags: string[];
  summary: string[];
  actions: ActionItem[];
  excerpt: string | null;
  category: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "agent" | "viewer";
}

// ─────────────────────────────────────────────────────────
// 대시보드 통계 view-model
// ─────────────────────────────────────────────────────────
export interface DashboardStats {
  total_calls: number;
  avg_duration_min: number;
  resolved_rate: number;
  positive_rate: number;
  daily: { d: string; n: number; m: number }[];
  sentiment: { name: string; value: number; color: string }[];
  topics: { name: string; n: number }[];
}
