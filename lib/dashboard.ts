import "server-only";

import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isUsingSupabaseServer,
} from "@/lib/supabase/server";
import { MOCK_RECORDINGS, formatRelativeKR } from "@/lib/mock-data";
import type { RecordingStatus, RiskLevel } from "@/lib/types";

// ─────────────────────────────────────────────────────────
// 관리자 대시보드 view-model
// ─────────────────────────────────────────────────────────

export interface DashboardKpis {
  total_recordings: number;
  uploaded_today: number;
  queued_jobs: number;
  failed_jobs: number;
  high_risk_count: number;       // high+critical
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface AgentUploadCount {
  user_id: string | null;
  display_name: string;
  count: number;
}

export interface DailyVolumePoint {
  /** 'MM/DD' 표시용 */
  label: string;
  /** ISO date (YYYY-MM-DD) */
  date: string;
  count: number;
}

export interface RecentRecording {
  id: string;
  recorded_at: string;
  recorded_at_label: string;
  title: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: RecordingStatus;
  category: string | null;
  risk_level: RiskLevel | null;
  duration_sec: number;
  excerpt: string | null;
}

export interface FailedJob {
  job_id: string;
  recording_id: string;
  recording_title: string | null;
  customer_name: string | null;
  recorded_at: string;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
}

export interface DashboardData {
  kpis: DashboardKpis;
  categories: CategoryCount[];
  agents: AgentUploadCount[];
  daily: DailyVolumePoint[];
  recent: RecentRecording[];
  failedJobs: FailedJob[];
  source: "supabase" | "mock";
}

// ─────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────

export async function fetchDashboardData(): Promise<DashboardData> {
  if (!isUsingSupabaseServer()) {
    return loadFromMock();
  }
  return loadFromSupabase();
}

// ─────────────────────────────────────────────────────────
// Mock 모드
// ─────────────────────────────────────────────────────────

function loadFromMock(): DashboardData {
  const all = MOCK_RECORDINGS;
  const today = startOfDay(new Date());

  const total_recordings = all.length;
  const uploaded_today = all.filter(
    (r) => Date.parse(r.recorded_at) >= today.getTime()
  ).length;

  // Mock 에는 stt_jobs 가 없으므로 status 로 추정:
  //  processing → 큐 진행 중, failed → 실패
  const queued_jobs = all.filter(
    (r) => r.status === "processing" || r.status === "uploading"
  ).length;
  const failed_jobs = all.filter((r) => r.status === "failed").length;

  const high_risk_count = all.filter(
    (r) => r.risk_level === "high" || r.risk_level === "critical"
  ).length;

  // 카테고리별 집계
  const catMap = new Map<string, number>();
  for (const r of all) {
    if (!r.category) continue;
    catMap.set(r.category, (catMap.get(r.category) ?? 0) + 1);
  }
  const categories: CategoryCount[] = Array.from(catMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // 직원별 — mock 에는 owner_id 가 없으므로 결정적 가짜 매핑
  // (운영자 데모 화면 시뮬레이션용)
  const agentMap = new Map<string, number>();
  const FAKE_AGENTS = ["이경연", "박지원", "최성호", "김혜진"];
  all.forEach((r, i) => {
    const name = FAKE_AGENTS[i % FAKE_AGENTS.length] ?? "이경연";
    agentMap.set(name, (agentMap.get(name) ?? 0) + 1);
  });
  const agents: AgentUploadCount[] = Array.from(agentMap.entries())
    .map(([display_name, count]) => ({
      user_id: null,
      display_name,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // 7일 일별 — 오늘 포함 7일
  const daily = build7DaySeries(
    all.map((r) => r.recorded_at),
    new Date()
  );

  // 최근 통화
  const recent: RecentRecording[] = [...all]
    .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      recorded_at: r.recorded_at,
      recorded_at_label: formatRelativeKR(r.recorded_at),
      title: r.title,
      customer_name: r.customer_name,
      customer_phone: r.customer_phone,
      status: r.status,
      category: r.category,
      risk_level: r.risk_level,
      duration_sec: r.duration_sec,
      excerpt: r.excerpt,
    }));

  // 실패 잡 — mock failed 통화에 대해 가상의 에러 정보
  const failedJobs: FailedJob[] = all
    .filter((r) => r.status === "failed")
    .map((r) => ({
      job_id: `job_${r.id}`,
      recording_id: r.id,
      recording_title: r.title,
      customer_name: r.customer_name,
      recorded_at: r.recorded_at,
      error_code: "MockFailure",
      error_message: "mock 데이터에서 임의로 설정된 실패 상태입니다.",
      retry_count: 1,
    }));

  return {
    kpis: {
      total_recordings,
      uploaded_today,
      queued_jobs,
      failed_jobs,
      high_risk_count,
    },
    categories,
    agents,
    daily,
    recent,
    failedJobs,
    source: "mock",
  };
}

// ─────────────────────────────────────────────────────────
// Supabase 모드
//
// 8개 지표를 Promise.all 로 병렬 조회.
// admin 클라이언트(service_role) 사용 — 관리자 화면이므로 RLS 우회 필요.
// 운영 시에는 Postgres function 으로 묶어 단일 호출로 만드는 것을 권장.
// ─────────────────────────────────────────────────────────

async function loadFromSupabase(): Promise<DashboardData> {
  const admin = createSupabaseAdminClient();

  const today = startOfDay(new Date());
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  // 1) total
  const totalP = admin
    .from("recordings")
    .select("id", { count: "exact", head: true });

  // 2) uploaded today
  const todayP = admin
    .from("recordings")
    .select("id", { count: "exact", head: true })
    .gte("recorded_at", today.toISOString());

  // 3) queued jobs
  const queuedP = admin
    .from("stt_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued");

  // 4) failed jobs (count + 상세 5건)
  const failedCountP = admin
    .from("stt_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");

  const failedListP = admin
    .from("stt_jobs")
    .select(
      "id, recording_id, error_code, error_message, retry_count, created_at, recordings:recording_id(title, customer_name, recorded_at)"
    )
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(5);

  // 5) 카테고리별 — 클라이언트 측 집계 (운영 시 Postgres function 권장)
  const categoriesP = admin
    .from("recordings")
    .select("category")
    .not("category", "is", null)
    .limit(2000);

  // 6) 위험도 high+critical
  const highRiskP = admin
    .from("recordings")
    .select("id", { count: "exact", head: true })
    .in("risk_level", ["high", "critical"]);

  // 7) 직원별 — owner_id 별 count (auth.users 의 raw_user_meta_data.full_name 결합)
  const agentsP = admin
    .from("recordings")
    .select("owner_id")
    .not("owner_id", "is", null)
    .limit(2000);

  // 8) 최근 7일 일별 (recorded_at 만 가져와 클라이언트 집계)
  const dailyP = admin
    .from("recordings")
    .select("recorded_at")
    .gte("recorded_at", sevenDaysAgo.toISOString())
    .limit(2000);

  // 9) 최근 통화 6건 (요약 표시용)
  const recentP = admin
    .from("recordings")
    .select(
      "id, recorded_at, title, customer_name, customer_phone, status, category, risk_level, duration_sec, excerpt"
    )
    .order("recorded_at", { ascending: false })
    .limit(6);

  const [
    total,
    todayRes,
    queued,
    failedCount,
    failedList,
    catRows,
    highRisk,
    agentRows,
    dailyRows,
    recentRows,
  ] = await Promise.all([
    totalP,
    todayP,
    queuedP,
    failedCountP,
    failedListP,
    categoriesP,
    highRiskP,
    agentsP,
    dailyP,
    recentP,
  ]);

  // ── 카테고리 집계 ────────────────────────────────────
  const catMap = new Map<string, number>();
  for (const row of catRows.data ?? []) {
    const c = (row as { category: string | null }).category;
    if (!c) continue;
    catMap.set(c, (catMap.get(c) ?? 0) + 1);
  }
  const categories: CategoryCount[] = Array.from(catMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // ── 직원별 집계 — owner_id 카운트 후 이름 보강 ────────
  const ownerCount = new Map<string, number>();
  for (const row of agentRows.data ?? []) {
    const oid = (row as { owner_id: string | null }).owner_id;
    if (!oid) continue;
    ownerCount.set(oid, (ownerCount.get(oid) ?? 0) + 1);
  }
  const agents: AgentUploadCount[] = await resolveAgentNames(
    admin,
    Array.from(ownerCount.entries())
  );

  // ── 7일 시계열 ────────────────────────────────────────
  const daily = build7DaySeries(
    (dailyRows.data ?? []).map(
      (r: any) => (r as { recorded_at: string }).recorded_at
    ),
    new Date()
  );

  // ── 최근 통화 변환 ────────────────────────────────────
  const recent: RecentRecording[] = (recentRows.data ?? []).map((r: any) => ({
    ...(r as RecentRecording),
    recorded_at_label: formatRelativeKR(
      (r as { recorded_at: string }).recorded_at
    ),
  }));

  // ── 실패 잡 ──────────────────────────────────────────
  const failedJobs: FailedJob[] = (failedList.data ?? []).map((row: any) => {
    const r = row as {
      id: string;
      recording_id: string;
      error_code: string | null;
      error_message: string | null;
      retry_count: number | null;
      recordings: {
        title: string | null;
        customer_name: string | null;
        recorded_at: string;
      } | null;
    };
    return {
      job_id: r.id,
      recording_id: r.recording_id,
      recording_title: r.recordings?.title ?? null,
      customer_name: r.recordings?.customer_name ?? null,
      recorded_at: r.recordings?.recorded_at ?? "",
      error_code: r.error_code,
      error_message: r.error_message,
      retry_count: r.retry_count ?? 0,
    };
  });

  return {
    kpis: {
      total_recordings: total.count ?? 0,
      uploaded_today: todayRes.count ?? 0,
      queued_jobs: queued.count ?? 0,
      failed_jobs: failedCount.count ?? 0,
      high_risk_count: highRisk.count ?? 0,
    },
    categories,
    agents,
    daily,
    recent,
    failedJobs,
    source: "supabase",
  };
}

// ─────────────────────────────────────────────────────────
// 보조: auth.users 에서 표시 이름 가져오기
//
// auth.admin.getUserById 가 PostgREST 가 아닌 Auth API 호출이라
// 한 번에 여러 명을 가져오는 RPC 가 없습니다. 운영 시 별도 profiles 테이블을
// 만들고 join 하는 것을 권장. 현재는 N 명을 순회 호출 (보통 ≤ 10명).
// ─────────────────────────────────────────────────────────

async function resolveAgentNames(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  entries: [string, number][]
): Promise<AgentUploadCount[]> {
  const result: AgentUploadCount[] = [];
  for (const [user_id, count] of entries) {
    let display_name = user_id.slice(0, 8);
    try {
      const { data } = await admin.auth.admin.getUserById(user_id);
      const u = data?.user;
      if (u) {
        const meta = (u.user_metadata as Record<string, unknown>) ?? {};
        display_name =
          (typeof meta.full_name === "string" && meta.full_name) ||
          (typeof meta.name === "string" && meta.name) ||
          u.email ||
          user_id.slice(0, 8);
      }
    } catch {
      /* 무시 — 익명 표시 */
    }
    result.push({ user_id, display_name, count });
  }
  return result.sort((a, b) => b.count - a.count);
}

// ─────────────────────────────────────────────────────────
// 보조: 7일 일별 시계열 빌드
// 입력 timestamp 들을 일자별로 묶고, 빈 날짜는 0 으로 채움
// ─────────────────────────────────────────────────────────

function build7DaySeries(
  timestamps: string[],
  end: Date
): DailyVolumePoint[] {
  const dayMap = new Map<string, number>();
  for (const ts of timestamps) {
    const key = isoDate(new Date(ts));
    dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
  }
  const points: DailyVolumePoint[] = [];
  const cursor = startOfDay(end);
  cursor.setDate(cursor.getDate() - 6);
  for (let i = 0; i < 7; i++) {
    const key = isoDate(cursor);
    points.push({
      date: key,
      label: `${cursor.getMonth() + 1}/${cursor.getDate()}`,
      count: dayMap.get(key) ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
