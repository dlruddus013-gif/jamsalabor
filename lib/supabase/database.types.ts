// ─────────────────────────────────────────────────────────
// Supabase Database Types
//
// public 스키마의 5개 테이블 타입 정의입니다.
// 마이그레이션(supabase/migrations) 과 1:1 매칭됩니다.
//
// 추후 실제 DB 마이그레이션 후에는 다음 명령으로 자동생성하여
// 이 파일을 덮어쓸 수 있습니다:
//   npx supabase gen types typescript --project-id <ref> --schema public \
//     > lib/supabase/database.types.ts
// ─────────────────────────────────────────────────────────

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ─────────────────────────────────────────────────────────
// Enums (DB CHECK constraints 와 매칭)
// ─────────────────────────────────────────────────────────

export type RecordingStatus =
  | "uploading"
  | "processing"
  | "completed"
  | "failed";

export type Sentiment = "pos" | "neu" | "neg";
export type SpeakerRole = "agent" | "customer";

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

export type SttJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AuditAction =
  | "view"
  | "download"
  | "create"
  | "update"
  | "delete"
  | "login"
  | "logout"
  | "export"
  | "masked_export"
  | "original_export";

// ─────────────────────────────────────────────────────────
// Database<'public'> 타입
// ─────────────────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      // ───────────────────────────────────────────────────
      // recordings — 통화 녹음 메타데이터 + 오디오 참조
      // ───────────────────────────────────────────────────
      recordings: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          recorded_at: string;
          // 업로더 / 소유자
          owner_id: string | null;
          // 고객 정보 (마스킹된 값 권장)
          customer_name: string | null;
          customer_phone: string | null;
          // 오디오
          duration_sec: number;
          audio_path: string | null;        // Storage 내 경로
          audio_mime: string | null;
          audio_size_bytes: number | null;
          audio_sha256: string | null;
          // 상태
          status: RecordingStatus;
          // 분석 결과
          sentiment: Sentiment | null;
          resolved: boolean;
          escalated: boolean;
          tags: string[];
          excerpt: string | null;
          category: string | null;
          title: string | null;
          risk_level: RiskLevel | null;
          // 메타
          source: string | null;            // 'phone' | 'upload' | 'mobile_recorder'
          metadata: Json;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          recorded_at: string;
          owner_id?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          duration_sec?: number;
          audio_path?: string | null;
          audio_mime?: string | null;
          audio_size_bytes?: number | null;
          audio_sha256?: string | null;
          status?: RecordingStatus;
          sentiment?: Sentiment | null;
          resolved?: boolean;
          escalated?: boolean;
          tags?: string[];
          excerpt?: string | null;
          category?: string | null;
          title?: string | null;
          risk_level?: RiskLevel | null;
          source?: string | null;
          metadata?: Json;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          recorded_at?: string;
          owner_id?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          duration_sec?: number;
          audio_path?: string | null;
          audio_mime?: string | null;
          audio_size_bytes?: number | null;
          audio_sha256?: string | null;
          status?: RecordingStatus;
          sentiment?: Sentiment | null;
          resolved?: boolean;
          escalated?: boolean;
          tags?: string[];
          excerpt?: string | null;
          category?: string | null;
          title?: string | null;
          risk_level?: RiskLevel | null;
          source?: string | null;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "recordings_owner_id_fkey";
            columns: ["owner_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };

      // ───────────────────────────────────────────────────
      // transcript_segments — STT 결과 (화자분리)
      // ───────────────────────────────────────────────────
      transcript_segments: {
        Row: {
          id: string;
          recording_id: string;
          start_sec: number;
          end_sec: number;
          speaker: SpeakerRole;
          text: string;
          /** 마스킹 전 원본 — 관리자(service_role) 전용. 일반 사용자는 GRANT 로 차단됨 */
          text_raw: string | null;
          confidence: number | null;        // 0–1
          created_at: string;
        };
        Insert: {
          id?: string;
          recording_id: string;
          start_sec: number;
          end_sec: number;
          speaker: SpeakerRole;
          text: string;
          text_raw?: string | null;
          confidence?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          recording_id?: string;
          start_sec?: number;
          end_sec?: number;
          speaker?: SpeakerRole;
          text?: string;
          text_raw?: string | null;
          confidence?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transcript_segments_recording_id_fkey";
            columns: ["recording_id"];
            referencedRelation: "recordings";
            referencedColumns: ["id"];
          }
        ];
      };

      // ───────────────────────────────────────────────────
      // recording_summaries — AI 요약 + 액션 아이템
      // 동일 통화에 대해 재생성 시 새 row 추가 (이력 보존)
      // ───────────────────────────────────────────────────
      recording_summaries: {
        Row: {
          id: string;
          recording_id: string;
          // 핵심 요약 bullets
          summary: string[];
          // 액션 아이템 (JSON: [{id, text, done}])
          action_items: Json;
          // 키워드/카테고리 자동 추출
          key_topics: string[];
          // 감정 (recordings.sentiment 와 동기화 가능)
          sentiment: Sentiment | null;
          // 모델 정보
          model: string | null;             // 'claude-opus-4-7' 등
          prompt_version: string | null;
          tokens_input: number | null;
          tokens_output: number | null;
          // 상태
          is_current: boolean;              // 현재 활성 요약 여부
          created_at: string;
          created_by: string | null;        // 트리거한 사용자(or 'system')
        };
        Insert: {
          id?: string;
          recording_id: string;
          summary?: string[];
          action_items?: Json;
          key_topics?: string[];
          sentiment?: Sentiment | null;
          model?: string | null;
          prompt_version?: string | null;
          tokens_input?: number | null;
          tokens_output?: number | null;
          is_current?: boolean;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          recording_id?: string;
          summary?: string[];
          action_items?: Json;
          key_topics?: string[];
          sentiment?: Sentiment | null;
          model?: string | null;
          prompt_version?: string | null;
          tokens_input?: number | null;
          tokens_output?: number | null;
          is_current?: boolean;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "recording_summaries_recording_id_fkey";
            columns: ["recording_id"];
            referencedRelation: "recordings";
            referencedColumns: ["id"];
          }
        ];
      };

      // ───────────────────────────────────────────────────
      // stt_jobs — STT 백그라운드 처리 큐/이력
      // ───────────────────────────────────────────────────
      stt_jobs: {
        Row: {
          id: string;
          recording_id: string;
          status: SttJobStatus;
          engine: string;                   // 'whisper-large-v3' 등
          language: string | null;          // 'ko'
          // 진행
          started_at: string | null;
          completed_at: string | null;
          duration_ms: number | null;
          // 실패 처리
          error_code: string | null;
          error_message: string | null;
          retry_count: number;
          // 우선순위 (낮을수록 먼저)
          priority: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          recording_id: string;
          status?: SttJobStatus;
          engine?: string;
          language?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          retry_count?: number;
          priority?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          recording_id?: string;
          status?: SttJobStatus;
          engine?: string;
          language?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          duration_ms?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          retry_count?: number;
          priority?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stt_jobs_recording_id_fkey";
            columns: ["recording_id"];
            referencedRelation: "recordings";
            referencedColumns: ["id"];
          }
        ];
      };

      // ───────────────────────────────────────────────────
      // audit_logs — 접근/변경 이력 (개인정보 추적용)
      // ───────────────────────────────────────────────────
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          action: AuditAction;
          resource_type: string;            // 'recording' | 'transcript' | 'summary'
          resource_id: string | null;
          ip_address: string | null;
          user_agent: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action: AuditAction;
          resource_type: string;
          resource_id?: string | null;
          ip_address?: string | null;
          user_agent?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          action?: AuditAction;
          resource_type?: string;
          resource_id?: string | null;
          ip_address?: string | null;
          user_agent?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

// ─────────────────────────────────────────────────────────
// 헬퍼 타입 — 페이지/컴포넌트에서 짧게 import
// ─────────────────────────────────────────────────────────

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];

export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];

// 자주 쓰는 alias
export type RecordingRow = Tables<"recordings">;
export type TranscriptSegmentRow = Tables<"transcript_segments">;
export type RecordingSummaryRow = Tables<"recording_summaries">;
export type SttJobRow = Tables<"stt_jobs">;
export type AuditLogRow = Tables<"audit_logs">;

// ─────────────────────────────────────────────────────────
// 조인된 view-model — UI용
// ─────────────────────────────────────────────────────────
export interface RecordingWithDetails extends RecordingRow {
  current_summary: RecordingSummaryRow | null;
  transcript: TranscriptSegmentRow[];
  latest_job: SttJobRow | null;
}
