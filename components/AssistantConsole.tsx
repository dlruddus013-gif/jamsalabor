"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Bot,
  Building2,
  CalendarDays,
  FileText,
  HelpCircle,
  Loader2,
  MessageSquareText,
  Search,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";

interface SearchResult {
  title: string;
  link: string;
  description: string;
  source: string;
}

interface PurchaseResult {
  purchasedAt: string | null;
  itemName: string;
  amount?: number | null;
  place?: string | null;
  channel?: string | null;
}

interface AnswerResult {
  provider: string;
  answer: string;
  suggestedFollowUps: string[];
  searchResults: SearchResult[];
  customerProfile?: string;
  dailySummary?: string[];
  requestedActions?: string[];
  resolutionPlan?: string[];
  informationToSend?: string[];
  smsDraft?: string;
  confidence?: number;
  selectedReason?: string;
  purchases?: PurchaseResult[];
  error?: string;
}

interface AssistantLog {
  id: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  question: string;
  transcript: string;
  answer: string;
  provider: string;
  facility: string;
  questionType: string;
  answerType: string;
  evidenceCount: number;
  followUpCount: number;
}

type PeriodKey = "7d" | "30d" | "90d" | "all";

const LOG_KEY = "jamsa-assistant-answer-logs-v2";
const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: "7d", label: "7일", days: 7 },
  { key: "30d", label: "30일", days: 30 },
  { key: "90d", label: "90일", days: 90 },
  { key: "all", label: "전체", days: null },
];

const FACILITY_KEYWORDS = [
  { name: "전시관", words: ["전시", "전시관", "박물관", "관람", "해설"] },
  { name: "잠사플레이팜", words: ["플레이팜", "놀이", "체험장", "키즈", "어린이"] },
  { name: "체험/교육", words: ["체험", "교육", "프로그램", "단체", "수업"] },
  { name: "카페/매점", words: ["카페", "매점", "식사", "음식", "커피"] },
  { name: "예약/매표", words: ["예약", "예매", "티켓", "입장권", "결제", "환불"] },
  { name: "주차/교통", words: ["주차", "버스", "교통", "위치", "주소"] },
];

const QUESTION_TYPES = [
  { name: "요금", words: ["요금", "가격", "입장료", "비용", "할인", "무료"] },
  { name: "운영시간", words: ["시간", "운영", "오픈", "마감", "휴무", "언제"] },
  { name: "예약", words: ["예약", "예매", "취소", "변경", "환불"] },
  { name: "시설", words: ["시설", "전시", "체험", "카페", "주차", "위치"] },
  { name: "단체", words: ["단체", "학교", "어린이집", "유치원", "인원"] },
  { name: "상담", words: ["문의", "가능", "되나요", "알려", "확인"] },
];

const ANSWER_TYPES = [
  { name: "즉시 안내", words: ["가능", "운영", "이용", "방문", "안내"] },
  { name: "직원 확인", words: ["확인", "문의", "직원", "담당자", "변동"] },
  { name: "예약 유도", words: ["예약", "예매", "사전", "접수"] },
  { name: "요금 안내", words: ["요금", "가격", "할인", "무료", "결제"] },
  { name: "근거 부족", words: ["설정", "검색", "근거", "키", "확정"] },
];

export default function AssistantConsole() {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [question, setQuestion] = useState("");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [logs, setLogs] = useState<AssistantLog[]>([]);
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setLogs(loadLogs());
  }, []);

  const filteredLogs = useMemo(
    () => filterLogs(logs, period, facilityFilter),
    [logs, period, facilityFilter]
  );
  const stats = useMemo(() => buildStats(filteredLogs), [filteredLogs]);
  const facilityOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.facility))).sort(),
    [logs]
  );

  const ask = () => {
    startTransition(async () => {
      setResult(null);
      const res = await fetch("/api/assistant/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, transcript, customerName, customerPhone }),
      });
      const next = (await res.json()) as AnswerResult;
      setResult(next);

      if (!next.error) {
        const log = createLog({ question, transcript, customerName, customerPhone, result: next });
        const saved = saveLog(log);
        setLogs(saved);
      }
    });
  };

  const clearLogs = () => {
    localStorage.removeItem(LOG_KEY);
    setLogs([]);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(380px,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-2xl bg-paper border border-line p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center">
              <Bot size={17} />
            </div>
            <div>
              <h2 className="font-display text-[17px] font-bold">고객별 자동 답변</h2>
              <p className="text-[12px] text-ink-mute">Google · NAVER · ChatGPT · Claude · POS 내역을 함께 봅니다.</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 mb-3">
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="h-10 rounded-xl border border-line bg-cream/40 px-3 text-[13px] outline-none focus:border-accent"
              placeholder="고객명"
            />
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className="h-10 rounded-xl border border-line bg-cream/40 px-3 text-[13px] outline-none focus:border-accent"
              placeholder="전화번호"
            />
          </div>

          <label className="block text-[12px] font-semibold mb-1">고객 질문</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="w-full min-h-28 rounded-xl border border-line bg-cream/40 p-3 text-[13px] outline-none focus:border-accent"
            placeholder="예: 지난번 구매한 체험권으로 오늘도 이용 가능한가요?"
          />

          <label className="block text-[12px] font-semibold mt-4 mb-1">통화 맥락 또는 STT 일부</label>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            className="w-full min-h-36 rounded-xl border border-line bg-cream/40 p-3 text-[13px] outline-none focus:border-accent"
            placeholder="고객 요청, 이전 안내, 통화 내용 일부를 붙여넣으세요."
          />

          <button
            onClick={ask}
            disabled={!question.trim() || isPending}
            className="mt-4 w-full rounded-xl bg-ink text-cream py-3 text-[13px] font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            고객 분석 후 최적 답변 생성
          </button>
        </section>

        <section className="rounded-2xl bg-paper border border-line p-5 min-h-[420px]">
          {!result && (
            <div className="h-full flex items-center justify-center text-center text-ink-mute text-[13px]">
              질문을 입력하면 고객 성향, 구매 조회, 해결방안, 문자안이 표시됩니다.
            </div>
          )}

          {result?.error && (
            <div className="rounded-xl border border-accent/30 bg-accent/10 p-4 text-[13px] text-accent">
              {result.error}
            </div>
          )}

          {result && !result.error && (
            <div className="space-y-4">
              <div>
                <div className="text-[11px] tracking-[0.25em] uppercase text-gold mb-2">
                  AI Answer · {result.provider}
                  {typeof result.confidence === "number" && (
                    <span className="ml-2 text-ink-mute tracking-normal">
                      신뢰도 {Math.round(result.confidence * 100)}%
                    </span>
                  )}
                </div>
                <div className="whitespace-pre-wrap rounded-xl bg-cream/50 border border-line p-4 text-[14px] leading-7">
                  {result.answer}
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <InfoBox title="고객 성향" items={[result.customerProfile ?? "분석 대기"]} />
                <InfoBox title="일별 요약" items={result.dailySummary ?? []} />
                <InfoBox title="요청사항" items={result.requestedActions ?? []} />
                <InfoBox title="해결방안" items={result.resolutionPlan ?? []} />
                <InfoBox title="정보전달" items={result.informationToSend ?? []} />
                <InfoBox title="문자안" items={[result.smsDraft ?? ""]} />
              </div>

              {result.purchases && result.purchases.length > 0 && (
                <div>
                  <h3 className="text-[12px] font-semibold mb-2">POS 구매/방문 조회</h3>
                  <div className="space-y-1.5">
                    {result.purchases.map((item, index) => (
                      <div key={index} className="text-[12px] rounded-lg bg-surface px-3 py-2">
                        {item.purchasedAt ?? "일시 미상"} · {item.itemName}
                        {item.amount ? ` · ${item.amount.toLocaleString()}원` : ""}
                        {item.place ? ` · ${item.place}` : ""}
                        {item.channel ? ` · ${item.channel}` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => copySummary(result)} className="px-3 py-2 rounded-lg border border-line bg-cream text-[12px] font-semibold">
                  요약 복사
                </button>
                <button type="button" onClick={() => shareSummary(result)} className="px-3 py-2 rounded-lg border border-line bg-cream text-[12px] font-semibold flex items-center gap-1">
                  <Share2 size={13} />
                  공유
                </button>
                {customerPhone && (
                  <a href={`sms:${customerPhone.replace(/\D/g, "")}?body=${encodeURIComponent(result.smsDraft ?? result.answer)}`} className="px-3 py-2 rounded-lg border border-line bg-cream text-[12px] font-semibold">
                    문자 보내기
                  </a>
                )}
              </div>

              {result.suggestedFollowUps?.length > 0 && (
                <InfoBox title="후속 확인" items={result.suggestedFollowUps} />
              )}

              <div>
                <h3 className="text-[12px] font-semibold mb-2 flex items-center gap-1">
                  <Search size={13} /> 웹 검색 근거
                </h3>
                <div className="space-y-2 max-h-72 overflow-auto scroll-thin">
                  {result.searchResults?.map((item, index) => (
                    <a key={`${item.link}_${index}`} href={item.link} target="_blank" rel="noreferrer" className="block rounded-xl border border-line p-3 hover:bg-surface/60">
                      <div className="text-[12px] font-semibold">{item.title}</div>
                      <div className="text-[11px] text-ink-mute mt-1 line-clamp-2">{item.description}</div>
                      <div className="text-[10px] text-sky mt-1">{item.source}</div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl bg-paper border border-line overflow-hidden">
        <div className="p-5 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] tracking-[0.25em] uppercase text-gold mb-1">Answer Analytics</div>
            <h2 className="font-display text-[19px] font-bold">고객 질문 분석 대시보드</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={facilityFilter} onChange={(e) => setFacilityFilter(e.target.value)} className="h-9 rounded-lg border border-line bg-cream px-3 text-[12px] outline-none">
              <option value="all">전체 시설</option>
              {facilityOptions.map((facility) => (
                <option key={facility} value={facility}>{facility}</option>
              ))}
            </select>
            <div className="flex rounded-lg border border-line bg-cream p-0.5">
              {PERIODS.map((item) => (
                <button key={item.key} onClick={() => setPeriod(item.key)} className={`h-8 px-3 rounded-md text-[12px] font-semibold ${period === item.key ? "bg-ink text-cream" : "text-ink-soft hover:bg-surface"}`}>
                  {item.label}
                </button>
              ))}
            </div>
            <button onClick={clearLogs} disabled={logs.length === 0} className="h-9 w-9 rounded-lg border border-line bg-cream flex items-center justify-center disabled:opacity-40" title="통계 초기화">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Metric icon={HelpCircle} label="질문" value={stats.total} />
            <Metric icon={Building2} label="시설" value={stats.facilityCount} />
            <Metric icon={MessageSquareText} label="답변 유형" value={stats.answerTypeCount} />
            <Metric icon={Search} label="검색 근거" value={stats.evidenceCount} />
            <Metric icon={FileText} label="후속 확인" value={stats.followUpCount} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartPanel title="시설별 질문" icon={Building2}><BarViz data={stats.facilitySeries} color="#b98938" /></ChartPanel>
            <ChartPanel title="질문별 분포" icon={HelpCircle}><BarViz data={stats.questionSeries} color="#4f6f52" /></ChartPanel>
            <ChartPanel title="답변별 분포" icon={MessageSquareText}><BarViz data={stats.answerSeries} color="#b94d32" /></ChartPanel>
            <ChartPanel title="기간별 추이" icon={CalendarDays}><LineViz data={stats.periodSeries} /></ChartPanel>
          </div>

          <div className="rounded-xl border border-line overflow-hidden">
            <div className="px-4 py-3 bg-cream/60 text-[12px] font-semibold">최근 고객 질문/답변 이력</div>
            {filteredLogs.length === 0 ? (
              <div className="p-6 text-center text-[13px] text-ink-mute">아직 집계할 답변 이력이 없습니다.</div>
            ) : (
              <div className="divide-y divide-line-soft max-h-80 overflow-auto scroll-thin">
                {filteredLogs.slice(0, 12).map((log) => (
                  <div key={log.id} className="px-4 py-3 grid gap-2 md:grid-cols-[1fr_120px_120px_90px]">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold truncate">{log.customerPhone || log.customerName || log.question}</div>
                      <div className="text-[11px] text-ink-mute truncate">{log.answer}</div>
                    </div>
                    <Badge>{log.facility}</Badge>
                    <Badge>{log.questionType}</Badge>
                    <div className="text-[11px] num text-ink-mute md:text-right">{formatShortDate(log.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof HelpCircle; label: string; value: number }) {
  return (
    <div className="rounded-xl bg-cream/60 border border-line-soft px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] text-ink-mute"><Icon size={13} />{label}</div>
      <div className="mt-1 text-[24px] font-bold num">{value}</div>
    </div>
  );
}

function ChartPanel({ title, icon: Icon, children }: { title: string; icon: typeof HelpCircle; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-cream/30 p-4">
      <h3 className="text-[12px] font-bold flex items-center gap-1.5 mb-3"><Icon size={13} />{title}</h3>
      <div className="h-60">{children}</div>
    </div>
  );
}

interface ChartPoint { name: string; count: number }

function BarViz({ data, color }: { data: ChartPoint[]; color: string }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8dcc4" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#7a6b59" }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#7a6b59" }} />
        <Tooltip />
        <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineViz({ data }: { data: ChartPoint[] }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8dcc4" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#7a6b59" }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#7a6b59" }} />
        <Tooltip />
        <Line type="monotone" dataKey="count" stroke="#3f6f83" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return <div className="h-full flex items-center justify-center text-[12px] text-ink-mute">집계 데이터 없음</div>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="w-fit h-6 px-2 rounded-full bg-gold/10 text-gold text-[11px] font-semibold flex items-center">{children}</span>;
}

function InfoBox({ title, items }: { title: string; items: string[] }) {
  const clean = items.filter(Boolean);
  return (
    <div className="rounded-xl border border-line bg-cream/40 p-3">
      <div className="text-[11px] font-bold text-gold mb-1">{title}</div>
      {clean.length === 0 ? <div className="text-[12px] text-ink-mute">내용 없음</div> : (
        <div className="space-y-1">{clean.map((item, index) => <div key={index} className="text-[12px] leading-5 text-ink-soft">{item}</div>)}</div>
      )}
    </div>
  );
}

function loadLogs(): AssistantLog[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]") as AssistantLog[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === "string").slice(0, 1000) : [];
  } catch {
    return [];
  }
}

function saveLog(log: AssistantLog) {
  const next = [log, ...loadLogs()].slice(0, 1000);
  localStorage.setItem(LOG_KEY, JSON.stringify(next));
  return next;
}

function createLog({ question, transcript, customerName, customerPhone, result }: { question: string; transcript: string; customerName: string; customerPhone: string; result: AnswerResult }): AssistantLog {
  const text = `${question} ${transcript}`;
  const answer = result.answer || "";
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    customerName,
    customerPhone,
    question,
    transcript,
    answer,
    provider: result.provider,
    facility: classify(text, FACILITY_KEYWORDS, "기타"),
    questionType: classify(text, QUESTION_TYPES, "기타"),
    answerType: classify(answer, ANSWER_TYPES, "일반 안내"),
    evidenceCount: result.searchResults?.length ?? 0,
    followUpCount: result.suggestedFollowUps?.length ?? 0,
  };
}

function filterLogs(logs: AssistantLog[], period: PeriodKey, facility: string) {
  const selected = PERIODS.find((item) => item.key === period);
  const since = selected?.days ? Date.now() - selected.days * 24 * 60 * 60 * 1000 : null;
  return logs.filter((log) => {
    if (facility !== "all" && log.facility !== facility) return false;
    if (since && Date.parse(log.createdAt) < since) return false;
    return true;
  });
}

function buildStats(logs: AssistantLog[]) {
  const facilitySeries = groupBy(logs, (log) => log.facility);
  const questionSeries = groupBy(logs, (log) => log.questionType);
  const answerSeries = groupBy(logs, (log) => log.answerType);
  return {
    total: logs.length,
    facilityCount: facilitySeries.length,
    answerTypeCount: answerSeries.length,
    evidenceCount: logs.reduce((sum, log) => sum + log.evidenceCount, 0),
    followUpCount: logs.reduce((sum, log) => sum + log.followUpCount, 0),
    facilitySeries,
    questionSeries,
    answerSeries,
    periodSeries: groupByDate(logs),
  };
}

function groupBy(logs: AssistantLog[], pick: (log: AssistantLog) => string): ChartPoint[] {
  const map = new Map<string, number>();
  for (const log of logs) {
    const key = pick(log);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);
}

function groupByDate(logs: AssistantLog[]): ChartPoint[] {
  const map = new Map<string, number>();
  for (const log of logs) {
    const key = formatShortDate(log.createdAt);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)).slice(-14);
}

function classify(text: string, rules: { name: string; words: string[] }[], fallback: string) {
  const lower = text.toLowerCase();
  let best = { name: fallback, score: 0 };
  for (const rule of rules) {
    const score = rule.words.reduce((sum, word) => sum + (lower.includes(word.toLowerCase()) ? 1 : 0), 0);
    if (score > best.score) best = { name: rule.name, score };
  }
  return best.name;
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function summaryText(result: AnswerResult) {
  return [
    "[고객 성향]",
    result.customerProfile ?? "",
    "",
    "[답변]",
    result.answer,
    "",
    "[해결방안]",
    ...(result.resolutionPlan ?? []),
    "",
    "[전달 정보]",
    ...(result.informationToSend ?? []),
    "",
    "[문자안]",
    result.smsDraft ?? "",
  ].join("\n");
}

async function copySummary(result: AnswerResult) {
  await navigator.clipboard?.writeText(summaryText(result));
}

async function shareSummary(result: AnswerResult) {
  const text = summaryText(result);
  if (navigator.share) {
    await navigator.share({ title: "고객 응대 요약", text });
    return;
  }
  await navigator.clipboard?.writeText(text);
}
