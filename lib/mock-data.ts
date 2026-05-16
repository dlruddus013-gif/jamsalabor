import type { Recording, TranscriptSegment, DashboardStats } from "./types";

// ─────────────────────────────────────────────────────────
// 통화 녹음 mock
// ─────────────────────────────────────────────────────────
export const MOCK_RECORDINGS: Recording[] = [
  {
    id: "rec_001",
    created_at: "2026-04-27T05:21:00Z",
    recorded_at: "2026-04-27T05:21:00Z",
    title: "60명 단체 견학 견적 문의",
    risk_level: "low",
    customer_name: "김미영",
    customer_phone: "010-2845-****",
    duration_sec: 272,
    audio_url: null,
    status: "completed",
    sentiment: "pos",
    resolved: false,
    escalated: true,
    tags: ["단체", "견학", "식사", "B2B"],
    summary: [
      "60명 단체 견학 예약 문의",
      "5월 셋째 주 평일 희망",
      "식사 동시 수용 가능 여부 확인 필요",
      "담당자 콜백 약속됨",
    ],
    actions: [
      { id: "a1", text: "단체 식당 5월 가용 일자 확인", done: false },
      { id: "a2", text: "견적서 발송 (단체할인 적용)", done: false },
      { id: "a3", text: "고객 전화번호 회신용 저장", done: true },
    ],
    excerpt: "60명 견학인데 식사 가능한가요…",
    category: "단체 견적",
  },
  {
    id: "rec_002",
    created_at: "2026-04-27T05:08:00Z",
    recorded_at: "2026-04-27T05:08:00Z",
    title: "입장권 환불 요청 — 비 예보",
    risk_level: "medium",
    customer_name: "박지훈",
    customer_phone: "010-7723-****",
    duration_sec: 374,
    audio_url: null,
    status: "completed",
    sentiment: "neg",
    resolved: false,
    escalated: true,
    tags: ["환불", "날씨", "결제"],
    summary: [
      "4/26 입장권 2매 결제 (32,000원)",
      "당일 비 예보로 방문 취소 희망",
      "환불 규정상 미사용권 100% 환불 안내",
      "카드 취소 진행 합의",
    ],
    actions: [
      { id: "a1", text: "결제 내역 조회 및 본인 확인", done: true },
      { id: "a2", text: "카드사 취소 처리 (영업일 1일)", done: false },
      { id: "a3", text: "환불 완료 SMS 발송", done: false },
    ],
    excerpt: "어제 결제했는데 환불 가능한가요…",
    category: "환불",
  },
  {
    id: "rec_003",
    created_at: "2026-04-27T04:55:00Z",
    recorded_at: "2026-04-27T04:55:00Z",
    title: "장애인 동반 무료입장 안내",
    risk_level: "none",
    customer_name: "이수진",
    customer_phone: "010-5512-****",
    duration_sec: 137,
    audio_url: null,
    status: "completed",
    sentiment: "neu",
    resolved: true,
    escalated: false,
    tags: ["장애인", "할인", "예매"],
    summary: [
      "장애인복지카드 + 보호자 1인 무료",
      "현장에서 카드 제시로 처리",
      "예매 시스템에서는 적용 불가 안내",
    ],
    actions: [{ id: "a1", text: "안내 자료 카톡 전송", done: true }],
    excerpt: "장애인 동반 무료입장 증빙은…",
    category: "정책",
  },
  {
    id: "rec_004",
    created_at: "2026-04-27T04:42:00Z",
    recorded_at: "2026-04-27T04:42:00Z",
    title: "VR 체험관 운영 문의",
    risk_level: null,
    customer_name: "정민호",
    customer_phone: "010-3344-****",
    duration_sec: 108,
    audio_url: null,
    status: "processing",
    sentiment: null,
    resolved: false,
    escalated: false,
    tags: [],
    summary: [],
    actions: [],
    excerpt: null,
    category: null,
  },
  {
    id: "rec_005",
    created_at: "2026-04-27T02:15:00Z",
    recorded_at: "2026-04-27T02:15:00Z",
    title: "연간회원권 가족 양도 문의",
    risk_level: "none",
    customer_name: "최영희",
    customer_phone: "010-9988-****",
    duration_sec: 182,
    audio_url: null,
    status: "completed",
    sentiment: "pos",
    resolved: true,
    escalated: false,
    tags: ["회원권", "양도", "가족"],
    summary: [
      "연간회원권 가족 간 양도 문의",
      "동거 직계가족 1회 양도 가능",
      "본인 신분증 + 가족관계증명서 필요",
    ],
    actions: [{ id: "a1", text: "양도 신청서 메일 발송", done: true }],
    excerpt: "연간회원권 양도 가능한가요…",
    category: "예약",
  },
  {
    id: "rec_006",
    created_at: "2026-04-26T08:32:00Z",
    recorded_at: "2026-04-26T08:32:00Z",
    title: "유치원 25명 견학 예약",
    risk_level: "none",
    customer_name: "한도윤",
    customer_phone: "010-2211-****",
    duration_sec: 341,
    audio_url: null,
    status: "completed",
    sentiment: "pos",
    resolved: true,
    escalated: false,
    tags: ["유치원", "견학", "체험"],
    summary: [
      "관내 유치원 25명 + 교사 4명 견학",
      "실잣기 체험 + 누에 관찰 패키지",
      "5/14(수) 10시 확정",
      "입금 후 견적서 발송 완료",
    ],
    actions: [
      { id: "a1", text: "견적서 발송", done: true },
      { id: "a2", text: "예약 확정 SMS", done: true },
    ],
    excerpt: "유치원 25명 견학 가능 시간…",
    category: "단체",
  },
  {
    id: "rec_007",
    created_at: "2026-04-26T06:08:00Z",
    recorded_at: "2026-04-26T06:08:00Z",
    title: "길찾기 안내 (익명)",
    risk_level: "none",
    customer_name: null,
    customer_phone: "발신번호 표시제한",
    duration_sec: 52,
    audio_url: null,
    status: "completed",
    sentiment: "neu",
    resolved: true,
    escalated: false,
    tags: ["교통", "길찾기"],
    summary: ["청주역 기준 차량 7분 / 대중교통 안내"],
    actions: [],
    excerpt: "오시는 길 알려주세요",
    category: "문의",
  },
  {
    id: "rec_008",
    created_at: "2026-04-27T05:35:00Z",
    recorded_at: "2026-04-27T05:35:00Z",
    title: "신규 업로드",
    risk_level: null,
    customer_name: "신규 업로드",
    customer_phone: null,
    duration_sec: 0,
    audio_url: null,
    status: "uploading",
    sentiment: null,
    resolved: false,
    escalated: false,
    tags: [],
    summary: [],
    actions: [],
    excerpt: null,
    category: null,
  },
  {
    id: "rec_009",
    created_at: "2026-04-27T03:11:00Z",
    recorded_at: "2026-04-27T03:11:00Z",
    title: "환불 강력 요구 — 클레임",
    risk_level: "high",
    customer_name: "윤재호",
    customer_phone: "010-4455-****",
    duration_sec: 218,
    audio_url: null,
    status: "failed",
    sentiment: null,
    resolved: false,
    escalated: false,
    tags: [],
    summary: [],
    actions: [],
    excerpt: null,
    category: null,
  },
];

// ─────────────────────────────────────────────────────────
// 전사 mock — rec_001 김미영 통화
// ─────────────────────────────────────────────────────────
export const MOCK_TRANSCRIPTS: Record<string, TranscriptSegment[]> = {
  rec_001: [
    { id: "s1",  recording_id: "rec_001", start_sec: 0,  end_sec: 4,  speaker: "agent",    text: "안녕하세요. 한국잠사박물관입니다. 무엇을 도와드릴까요." },
    { id: "s2",  recording_id: "rec_001", start_sec: 4,  end_sec: 9,  speaker: "customer", text: "안녕하세요. 저희 회사에서 단체 견학을 가려고 하는데요." },
    { id: "s3",  recording_id: "rec_001", start_sec: 9,  end_sec: 13, speaker: "customer", text: "인원이 한 60명 정도 되거든요." },
    { id: "s4",  recording_id: "rec_001", start_sec: 13, end_sec: 18, speaker: "agent",    text: "네, 60명 단체 가능합니다. 혹시 희망하시는 날짜가 있으실까요?" },
    { id: "s5",  recording_id: "rec_001", start_sec: 18, end_sec: 24, speaker: "customer", text: "5월 셋째 주 정도로 평일 중에 보고 있어요." },
    { id: "s6",  recording_id: "rec_001", start_sec: 24, end_sec: 29, speaker: "agent",    text: "확인해드리겠습니다. 그리고 식사도 같이 하시는 건가요?" },
    { id: "s7",  recording_id: "rec_001", start_sec: 29, end_sec: 35, speaker: "customer", text: "네, 가능하면 단체식당에서 점심까지 하고 싶은데요." },
    { id: "s8",  recording_id: "rec_001", start_sec: 35, end_sec: 42, speaker: "agent",    text: "단체식당이 최대 80명까지 동시 수용 가능해서 60명이면 충분하실 거예요." },
    { id: "s9",  recording_id: "rec_001", start_sec: 42, end_sec: 49, speaker: "agent",    text: "5월 셋째 주 가용 일자 확인해서 견적서랑 같이 보내드릴게요." },
    { id: "s10", recording_id: "rec_001", start_sec: 49, end_sec: 53, speaker: "customer", text: "아 좋네요. 그럼 메일로 받을게요." },
    { id: "s11", recording_id: "rec_001", start_sec: 53, end_sec: 57, speaker: "agent",    text: "네, 메일 주소만 한번 알려주시겠어요?" },
    { id: "s12", recording_id: "rec_001", start_sec: 57, end_sec: 64, speaker: "customer", text: "kim.miyoung@example.co.kr 입니다." },
    { id: "s13", recording_id: "rec_001", start_sec: 64, end_sec: 71, speaker: "agent",    text: "확인했습니다. 오늘 안에 견적서 보내드리겠습니다." },
    { id: "s14", recording_id: "rec_001", start_sec: 71, end_sec: 76, speaker: "customer", text: "네 감사합니다. 수고하세요." },
  ],
};

// ─────────────────────────────────────────────────────────
// 대시보드 통계 mock
// ─────────────────────────────────────────────────────────
export const MOCK_STATS: DashboardStats = {
  total_calls: 220,
  avg_duration_min: 3.3,
  resolved_rate: 0.71,
  positive_rate: 0.58,
  daily: [
    { d: "월", n: 24, m: 3.2 },
    { d: "화", n: 31, m: 2.8 },
    { d: "수", n: 28, m: 3.5 },
    { d: "목", n: 35, m: 3.1 },
    { d: "금", n: 42, m: 2.9 },
    { d: "토", n: 38, m: 4.1 },
    { d: "일", n: 22, m: 3.6 },
  ],
  sentiment: [
    { name: "긍정", value: 58, color: "#6B7A3B" },
    { name: "중립", value: 32, color: "#C28C2C" },
    { name: "부정", value: 10, color: "#B8442C" },
  ],
  topics: [
    { name: "운영/요금", n: 42 },
    { name: "단체예약", n: 31 },
    { name: "환불",     n: 18 },
    { name: "시설",     n: 24 },
    { name: "교통",     n: 15 },
    { name: "기타",     n: 8 },
  ],
};

// ─────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────
export function getRecordingById(id: string): Recording | undefined {
  return MOCK_RECORDINGS.find((r) => r.id === id);
}

export function getTranscriptByRecordingId(id: string): TranscriptSegment[] {
  return MOCK_TRANSCRIPTS[id] ?? [];
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatRelativeKR(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `오늘 ${hh}:${mm}`;
  if (isYesterday) return `어제 ${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export function maskPhone(p: string | null): string {
  if (!p) return "—";
  return p.replace(/(\d{3})-?(\d{3,4})-?(\d{4})/, "$1-$2-****");
}
