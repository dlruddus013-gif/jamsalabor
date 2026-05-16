"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  ChevronRight,
  ArrowUpRight,
  TrendingUp,
  Phone,
  Clock,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Database,
  ShieldAlert,
  Hourglass,
  XCircle,
  Inbox,
  Users,
  Tag,
  CalendarDays,
  TimerReset,
  FileBarChart,
} from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import RiskBadge from "@/components/RiskBadge";
import { cn } from "@/lib/cn";
import { formatDuration, maskPhone } from "@/lib/mock-data";
import { retryFailedJob } from "./actions";
import type { DashboardData, DashboardStatRecord, FailedJob } from "@/lib/dashboard";

// ─────────────────────────────────────────────────────────
// 색상 토큰 (recharts 가 string 으로 받음)
// ─────────────────────────────────────────────────────────

const C = {
  accent: "#B8442C",
  gold: "#C28C2C",
  olive: "#6B7A3B",
  sky: "#3F6E8A",
  ink: "#1F1812",
  line: "#EFE7D2",
  inkMute: "#8B7A66",
  surface: "#F4ECD8",
} as const;

// ─────────────────────────────────────────────────────────
// 메인 뷰
// ─────────────────────────────────────────────────────────

export default function DashboardView({ data }: { data: DashboardData }) {
  const { kpis, categories, agents, daily, recent, failedJobs, source, statRecords } = data;
  const todayIso = new Date().toISOString().slice(0, 10);
  const monthStartIso = `${todayIso.slice(0, 7)}-01`;
  const [statMode, setStatMode] = useState<"month" | "year" | "range">("month");
  const [rangeFrom, setRangeFrom] = useState(monthStartIso);
  const [rangeTo, setRangeTo] = useState(todayIso);
  const periodStats = useMemo(
    () => buildPeriodStats(statRecords, statMode, rangeFrom, rangeTo),
    [statRecords, statMode, rangeFrom, rangeTo]
  );

  const dailyTrend = (() => {
    if (daily.length < 2) return 0;
    const last = daily[daily.length - 1]?.count ?? 0;
    const prev = daily[daily.length - 2]?.count ?? 0;
    if (prev === 0) return last > 0 ? 100 : 0;
    return Math.round(((last - prev) / prev) * 100);
  })();

  return (
    <div className="space-y-6 animate-slide-up">
      {/* 헤더 */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-[11px] tracking-[0.3em] uppercase text-gold mb-1 flex items-center gap-2">
            <span>Admin Dashboard · {todayKR()}</span>
            {source === "mock" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gold/15 text-gold normal-case tracking-normal">
                mock
              </span>
            )}
          </div>
          <h1 className="font-display text-[28px] md:text-[32px] leading-tight font-bold">
            운영 현황 <span className="text-accent">한눈에</span>
          </h1>
        </div>
      </div>

      {/* KPI 카드 5개 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard
          icon={Database}
          label="전체 녹음"
          value={kpis.total_recordings}
          tone="ink"
        />
        <KpiCard
          icon={Inbox}
          label="오늘 업로드"
          value={kpis.uploaded_today}
          tone="sky"
          accent
        />
        <KpiCard
          icon={Hourglass}
          label="STT 처리 대기"
          value={kpis.queued_jobs}
          tone="gold"
          urgent={kpis.queued_jobs > 5}
        />
        <KpiCard
          icon={XCircle}
          label="실패 작업"
          value={kpis.failed_jobs}
          tone="accent"
          urgent={kpis.failed_jobs > 0}
        />
        <KpiCard
          icon={ShieldAlert}
          label="고위험 상담"
          value={kpis.high_risk_count}
          tone="accent"
          urgent={kpis.high_risk_count > 0}
        />
      </div>

      <PeriodStatsPanel
        mode={statMode}
        onModeChange={setStatMode}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeFrom={setRangeFrom}
        onRangeTo={setRangeTo}
        stats={periodStats}
      />

      {/* 7일 라인 차트 + 상담유형 막대 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {/* 7일 트렌드 */}
        <div className="xl:col-span-2 rounded-2xl bg-paper border border-line p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <div className="text-[11px] tracking-[0.2em] uppercase text-gold">
                Last 7 Days
              </div>
              <div className="font-display text-[18px] font-bold mt-0.5">
                최근 7일 상담량
              </div>
            </div>
            <div
              className={cn(
                "text-[11px] flex items-center gap-1",
                dailyTrend > 0
                  ? "text-olive"
                  : dailyTrend < 0
                  ? "text-accent"
                  : "text-ink-mute"
              )}
            >
              <TrendingUp size={11} />
              어제 대비 {dailyTrend > 0 ? "+" : ""}
              {dailyTrend}%
            </div>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer>
              <LineChart
                data={daily}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: C.inkMute }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: C.inkMute }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: C.ink,
                    border: "none",
                    borderRadius: 8,
                    color: "#FAF6EC",
                    fontSize: 12,
                  }}
                  cursor={{ fill: "#B8442C11" }}
                  labelFormatter={(l) => `${l}`}
                  formatter={(v) => [`${v}건`, "통화"]}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke={C.accent}
                  strokeWidth={2.5}
                  dot={{ fill: C.accent, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 상담유형별 — 카테고리 막대 */}
        <div className="rounded-2xl bg-paper border border-line p-5">
          <div className="flex items-center gap-1.5 mb-3">
            <Tag size={12} className="text-gold" />
            <div className="text-[11px] tracking-[0.2em] uppercase text-gold">
              By Category
            </div>
          </div>
          <div className="font-display text-[18px] font-bold mb-3">
            상담 유형별
          </div>

          {categories.length === 0 ? (
            <EmptyHint message="아직 분류된 통화가 없습니다." />
          ) : (
            <div className="space-y-2">
              {categories.slice(0, 8).map((c) => (
                <CategoryRow
                  key={c.category}
                  label={c.category}
                  count={c.count}
                  total={categories[0]?.count ?? 1}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 직원별 + 실패 작업 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* 직원별 업로드 */}
        <div className="rounded-2xl bg-paper border border-line p-5">
          <div className="flex items-center gap-1.5 mb-3">
            <Users size={12} className="text-gold" />
            <div className="text-[11px] tracking-[0.2em] uppercase text-gold">
              Uploads by Agent
            </div>
          </div>
          <div className="font-display text-[18px] font-bold mb-3">
            직원별 업로드
          </div>

          {agents.length === 0 ? (
            <EmptyHint message="업로드 이력이 없습니다." />
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer>
                <BarChart
                  data={agents.slice(0, 6)}
                  layout="vertical"
                  margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={C.line}
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: C.inkMute }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="display_name"
                    tick={{ fontSize: 11, fill: C.ink }}
                    width={80}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: C.ink,
                      border: "none",
                      borderRadius: 8,
                      color: "#FAF6EC",
                      fontSize: 12,
                    }}
                    cursor={{ fill: "#B8442C11" }}
                    formatter={(v) => [`${v}건`, "업로드"]}
                  />
                  <Bar dataKey="count" fill={C.sky} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 실패 작업 */}
        <FailedJobsCard jobs={failedJobs} />
      </div>

      {/* 최근 상담 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-[20px] font-bold">최근 상담</h2>
          <Link
            href="/recordings"
            className="text-[12px] text-ink-soft hover:text-accent flex items-center gap-1"
          >
            전체 보기 <ArrowUpRight size={12} />
          </Link>
        </div>
        <div className="rounded-2xl bg-paper border border-line divide-y divide-line-soft overflow-hidden">
          {recent.length === 0 ? (
            <div className="p-8 text-center text-[12px] text-ink-mute">
              최근 상담이 없습니다.
            </div>
          ) : (
            recent.map((r) => (
              <Link
                key={r.id}
                href={`/recordings/${r.id}`}
                className="block px-4 py-3 hover:bg-surface/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <div className="text-[13px] font-semibold truncate">
                        {r.title || r.customer_name || "익명 통화"}
                      </div>
                      <span className="text-[10px] num text-ink-mute shrink-0">
                        {r.recorded_at_label}
                      </span>
                      <StatusBadge status={r.status} />
                      <RiskBadge risk={r.risk_level} />
                      {r.category && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gold/10 text-gold font-medium">
                          {r.category}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-mute truncate flex items-center gap-2 num">
                      <span className="flex items-center gap-1">
                        <Phone size={10} /> {maskPhone(r.customer_phone)}
                      </span>
                      {r.duration_sec > 0 && (
                        <span className="flex items-center gap-1">
                          <Clock size={10} /> {formatDuration(r.duration_sec)}
                        </span>
                      )}
                      {r.excerpt && (
                        <span className="truncate flex-1 min-w-0">
                          · {r.excerpt}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-ink-mute shrink-0" />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 월별/연도별/기간별 통계
// ─────────────────────────────────────────────────────────

interface PeriodStats {
  title: string;
  total: number;
  completed: number;
  processing: number;
  failed: number;
  highRisk: number;
  uniquePhones: number;
  totalDurationSec: number;
  avgPerDay: number;
  topCategory: string;
  points: { label: string; count: number; failed: number; highRisk: number }[];
  categories: { label: string; count: number }[];
  statuses: { label: string; count: number }[];
}

function PeriodStatsPanel({
  mode,
  onModeChange,
  rangeFrom,
  rangeTo,
  onRangeFrom,
  onRangeTo,
  stats,
}: {
  mode: "month" | "year" | "range";
  onModeChange: (mode: "month" | "year" | "range") => void;
  rangeFrom: string;
  rangeTo: string;
  onRangeFrom: (value: string) => void;
  onRangeTo: (value: string) => void;
  stats: PeriodStats;
}) {
  return (
    <section className="rounded-2xl bg-paper border border-line p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] tracking-[0.2em] uppercase text-gold flex items-center gap-1.5">
            <FileBarChart size={12} /> Statistics
          </div>
          <h2 className="font-display text-[20px] font-bold mt-0.5">
            월별 · 연도별 · 기간별 통계
          </h2>
          <p className="text-[12px] text-ink-mute mt-1">
            {stats.title} 기준으로 상담량, 실패, 위험도, 카테고리, 평균 처리량을 요약합니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            ["month", "월별"],
            ["year", "연도별"],
            ["range", "기간별"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onModeChange(key as "month" | "year" | "range")}
              className={cn(
                "h-9 px-3 rounded-xl text-[12px] font-semibold border",
                mode === key
                  ? "bg-ink text-cream border-ink"
                  : "bg-cream text-ink-soft border-line hover:text-ink"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "range" && (
        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <label className="text-[11px] text-ink-mute">시작일</label>
          <input
            type="date"
            value={rangeFrom}
            onChange={(e) => onRangeFrom(e.target.value)}
            className="h-9 rounded-xl border border-line bg-cream px-3 text-[12px] outline-none focus:border-accent"
          />
          <label className="text-[11px] text-ink-mute">종료일</label>
          <input
            type="date"
            value={rangeTo}
            onChange={(e) => onRangeTo(e.target.value)}
            className="h-9 rounded-xl border border-line bg-cream px-3 text-[12px] outline-none focus:border-accent"
          />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2 mt-4">
        <MiniStat icon={CalendarDays} label="총 상담" value={stats.total} />
        <MiniStat icon={CheckCircle2} label="완료" value={stats.completed} tone="olive" />
        <MiniStat icon={Hourglass} label="처리중" value={stats.processing} tone="gold" />
        <MiniStat icon={XCircle} label="실패" value={stats.failed} tone="accent" />
        <MiniStat icon={ShieldAlert} label="고위험" value={stats.highRisk} tone="accent" />
        <MiniStat icon={Phone} label="고유 번호" value={stats.uniquePhones} tone="sky" />
        <MiniStat icon={TimerReset} label="일평균" value={stats.avgPerDay} suffix="건" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-4">
        <div className="xl:col-span-2 rounded-xl bg-cream/45 border border-line-soft p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-bold">기간 흐름</div>
            <div className="text-[11px] text-ink-mute">
              총 통화시간 {formatDuration(stats.totalDurationSec)}
            </div>
          </div>
          <div className="h-[210px]">
            <ResponsiveContainer>
              <BarChart data={stats.points} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.inkMute }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: C.inkMute }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: C.ink,
                    border: "none",
                    borderRadius: 8,
                    color: "#FAF6EC",
                    fontSize: 12,
                  }}
                  formatter={(v, name) => [`${v}건`, name === "failed" ? "실패" : name === "highRisk" ? "고위험" : "상담"]}
                />
                <Bar dataKey="count" fill={C.sky} radius={[5, 5, 0, 0]} />
                <Bar dataKey="failed" fill={C.accent} radius={[5, 5, 0, 0]} />
                <Bar dataKey="highRisk" fill={C.gold} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl bg-cream/45 border border-line-soft p-4">
          <div className="text-[13px] font-bold mb-3">세부 요약</div>
          <div className="space-y-3">
            <SummaryLine label="최다 유형" value={stats.topCategory} />
            <SummaryLine label="완료율" value={`${percent(stats.completed, stats.total)}%`} />
            <SummaryLine label="실패율" value={`${percent(stats.failed, stats.total)}%`} danger={stats.failed > 0} />
            <SummaryLine label="고위험 비중" value={`${percent(stats.highRisk, stats.total)}%`} danger={stats.highRisk > 0} />
          </div>

          <div className="mt-4">
            <div className="text-[11px] font-bold text-ink-soft mb-2">카테고리 Top 5</div>
            {stats.categories.length === 0 ? (
              <div className="text-[11px] text-ink-mute">분류된 통화가 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {stats.categories.slice(0, 5).map((c) => (
                  <CategoryRow key={c.label} label={c.label} count={c.count} total={stats.categories[0]?.count ?? 1} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  tone = "ink",
  suffix = "",
}: {
  icon: typeof Database;
  label: string;
  value: number;
  tone?: "ink" | "sky" | "gold" | "accent" | "olive";
  suffix?: string;
}) {
  const toneClass = {
    ink: "bg-line-soft text-ink-soft",
    sky: "bg-sky/15 text-sky",
    gold: "bg-gold/15 text-gold",
    accent: "bg-accent/15 text-accent",
    olive: "bg-olive/15 text-olive",
  }[tone];
  return (
    <div className="rounded-xl bg-cream border border-line-soft px-3 py-2.5">
      <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center mb-2", toneClass)}>
        <Icon size={13} />
      </div>
      <div className="text-[10px] text-ink-mute">{label}</div>
      <div className="font-display num text-[21px] font-bold">
        {value.toLocaleString()}
        {suffix && <span className="ml-0.5 text-[11px] text-ink-mute font-sans">{suffix}</span>}
      </div>
    </div>
  );
}

function SummaryLine({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="text-ink-mute">{label}</span>
      <span className={cn("font-bold text-right", danger ? "text-accent" : "text-ink")}>{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// KPI 카드
// ─────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
  accent,
  urgent,
}: {
  icon: typeof Database;
  label: string;
  value: number;
  tone: "ink" | "sky" | "gold" | "accent";
  accent?: boolean;
  urgent?: boolean;
}) {
  const iconBg = {
    ink: "bg-line-soft text-ink-soft",
    sky: "bg-sky/15 text-sky",
    gold: "bg-gold/15 text-gold",
    accent: "bg-accent/15 text-accent",
  }[tone];

  return (
    <div
      className={cn(
        "p-4 rounded-2xl border transition-colors",
        urgent
          ? "bg-accent/5 border-accent/30"
          : accent
          ? "bg-paper border-line"
          : "bg-paper border-line"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center",
            iconBg
          )}
        >
          <Icon size={14} />
        </div>
        {urgent && (
          <span className="text-[9px] tracking-[0.2em] uppercase text-accent font-semibold animate-pulse-soft">
            확인 필요
          </span>
        )}
      </div>
      <div className="text-[11px] text-ink-mute">{label}</div>
      <div className="font-display num text-[26px] font-bold leading-tight mt-0.5">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 카테고리 행 (인라인 막대)
// ─────────────────────────────────────────────────────────

function CategoryRow({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  const ratio = total > 0 ? Math.min(1, count / total) : 0;
  return (
    <Link
      href={`/recordings?category=${encodeURIComponent(label)}`}
      className="block group"
    >
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="text-ink-soft group-hover:text-ink truncate">
          {label}
        </span>
        <span className="num font-semibold tabular-nums">{count}</span>
      </div>
      <div className="h-1.5 rounded-full bg-line-soft overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────
// 실패 작업 카드 + 재시도
// ─────────────────────────────────────────────────────────

type RetryState = "idle" | "pending" | "success" | "error";

function FailedJobsCard({ jobs }: { jobs: FailedJob[] }) {
  const [states, setStates] = useState<Record<string, RetryState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const setState = (id: string, s: RetryState) =>
    setStates((prev) => ({ ...prev, [id]: s }));

  const onRetry = (jobId: string) => {
    setState(jobId, "pending");
    setErrors((prev) => ({ ...prev, [jobId]: "" }));

    startTransition(async () => {
      try {
        const res = await retryFailedJob(jobId);
        if (res.ok) {
          setState(jobId, "success");
        } else {
          setState(jobId, "error");
          setErrors((prev) => ({ ...prev, [jobId]: res.error }));
        }
      } catch (e) {
        setState(jobId, "error");
        setErrors((prev) => ({
          ...prev,
          [jobId]: e instanceof Error ? e.message : "네트워크 오류",
        }));
      }
    });
  };

  return (
    <div className="rounded-2xl bg-paper border border-line p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] tracking-[0.2em] uppercase text-gold flex items-center gap-1.5">
            <AlertTriangle size={11} /> Failed Jobs
          </div>
          <div className="font-display text-[18px] font-bold mt-0.5">
            실패 작업
          </div>
        </div>
        {jobs.length > 0 && (
          <span className="text-[10px] num font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-accent">
            {jobs.length}건
          </span>
        )}
      </div>

      {jobs.length === 0 ? (
        <EmptyHint
          icon={CheckCircle2}
          message="현재 실패한 작업이 없습니다."
          tone="olive"
        />
      ) : (
        <div className="space-y-2">
          {jobs.map((j) => {
            const st = states[j.job_id] ?? "idle";
            return (
              <div
                key={j.job_id}
                className="rounded-xl border border-line bg-cream/30 p-3"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <Link
                    href={`/recordings/${j.recording_id}`}
                    className="flex-1 min-w-0 group"
                  >
                    <div className="text-[12px] font-semibold truncate group-hover:text-accent">
                      {j.recording_title || j.customer_name || "통화"}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-ink-mute flex-wrap">
                      {j.error_code && (
                        <code className="px-1.5 py-px rounded bg-paper border border-line text-accent">
                          {j.error_code}
                        </code>
                      )}
                      <span>재시도 {j.retry_count}회</span>
                    </div>
                  </Link>
                  <RetryButton
                    state={st}
                    onClick={() => onRetry(j.job_id)}
                    disabled={isPending && st === "pending"}
                  />
                </div>

                {j.error_message && st !== "success" && (
                  <div className="text-[10px] text-ink-mute line-clamp-2 mt-1">
                    {j.error_message}
                  </div>
                )}

                {st === "success" && (
                  <div className="text-[10px] text-olive flex items-center gap-1 mt-1">
                    <CheckCircle2 size={10} /> 큐에 다시 등록되었습니다.
                  </div>
                )}
                {st === "error" && errors[j.job_id] && (
                  <div className="text-[10px] text-accent mt-1">
                    {errors[j.job_id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RetryButton({
  state,
  onClick,
  disabled,
}: {
  state: RetryState;
  onClick: () => void;
  disabled?: boolean;
}) {
  if (state === "success") {
    return (
      <span className="text-[11px] px-2.5 py-1.5 rounded-lg bg-olive/15 text-olive font-medium flex items-center gap-1 shrink-0">
        <CheckCircle2 size={11} /> 완료
      </span>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled || state === "pending"}
      className={cn(
        "text-[11px] px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1 shrink-0 transition-colors",
        "bg-ink text-cream hover:bg-ink-soft disabled:opacity-50 disabled:cursor-not-allowed"
      )}
    >
      {state === "pending" ? (
        <>
          <Loader2 size={11} className="animate-spin" /> 재시도 중
        </>
      ) : (
        <>
          <RefreshCw size={11} /> 재시도
        </>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────
// 작은 컴포넌트들
// ─────────────────────────────────────────────────────────

function EmptyHint({
  message,
  icon: Icon,
  tone = "ink-mute",
}: {
  message: string;
  icon?: typeof CheckCircle2;
  tone?: "ink-mute" | "olive";
}) {
  const cls = tone === "olive" ? "text-olive bg-olive/5" : "text-ink-mute bg-line-soft/30";
  return (
    <div
      className={cn(
        "rounded-xl px-3 py-6 flex flex-col items-center justify-center gap-1.5 text-center",
        cls
      )}
    >
      {Icon && <Icon size={18} />}
      <div className="text-[12px]">{message}</div>
    </div>
  );
}

function todayKR() {
  const d = new Date();
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

function buildPeriodStats(
  records: DashboardStatRecord[],
  mode: "month" | "year" | "range",
  rangeFrom: string,
  rangeTo: string
): PeriodStats {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const start = mode === "year" ? `${currentYear}-01-01` : mode === "month" ? `${currentMonth}-01` : rangeFrom;
  const end = mode === "year" ? `${currentYear}-12-31` : mode === "month" ? lastDayOfMonth(currentMonth) : rangeTo;
  const startTime = Date.parse(`${start}T00:00:00`);
  const endTime = Date.parse(`${end}T23:59:59`);
  const filtered = records.filter((record) => {
    const time = Date.parse(record.recorded_at);
    return Number.isFinite(time) && time >= startTime && time <= endTime;
  });

  const categoryMap = new Map<string, number>();
  const statusMap = new Map<string, number>();
  const phoneSet = new Set<string>();
  let completed = 0;
  let processing = 0;
  let failed = 0;
  let highRisk = 0;
  let totalDurationSec = 0;

  for (const record of filtered) {
    const category = record.category || "미분류";
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + 1);
    statusMap.set(record.status, (statusMap.get(record.status) ?? 0) + 1);
    if (record.customer_phone) phoneSet.add(record.customer_phone.replace(/\D/g, ""));
    if (record.status === "completed") completed += 1;
    if (record.status === "processing" || record.status === "uploading") processing += 1;
    if (record.status === "failed") failed += 1;
    if (record.risk_level === "high" || record.risk_level === "critical") highRisk += 1;
    totalDurationSec += record.duration_sec || 0;
  }

  const points = buildPeriodPoints(filtered, mode, start, end);
  const dayCount = Math.max(1, Math.round((endTime - startTime) / 86400000) + 1);
  const categories = Array.from(categoryMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  const statuses = Array.from(statusMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  return {
    title:
      mode === "year"
        ? `${currentYear}년`
        : mode === "month"
          ? `${currentYear}년 ${now.getMonth() + 1}월`
          : `${start} ~ ${end}`,
    total: filtered.length,
    completed,
    processing,
    failed,
    highRisk,
    uniquePhones: Array.from(phoneSet).filter(Boolean).length,
    totalDurationSec,
    avgPerDay: Math.round((filtered.length / dayCount) * 10) / 10,
    topCategory: categories[0]?.label ?? "없음",
    points,
    categories,
    statuses,
  };
}

function buildPeriodPoints(
  records: DashboardStatRecord[],
  mode: "month" | "year" | "range",
  start: string,
  end: string
) {
  const map = new Map<string, { label: string; count: number; failed: number; highRisk: number }>();

  if (mode === "year") {
    for (let m = 1; m <= 12; m++) {
      const key = `${start.slice(0, 4)}-${String(m).padStart(2, "0")}`;
      map.set(key, { label: `${m}월`, count: 0, failed: 0, highRisk: 0 });
    }
  } else {
    const startDate = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);
    const cursor = new Date(startDate);
    while (cursor <= endDate && map.size < 62) {
      const key = cursor.toISOString().slice(0, 10);
      map.set(key, { label: `${cursor.getMonth() + 1}/${cursor.getDate()}`, count: 0, failed: 0, highRisk: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  for (const record of records) {
    const date = new Date(record.recorded_at);
    const key = mode === "year" ? record.recorded_at.slice(0, 7) : record.recorded_at.slice(0, 10);
    const existing = map.get(key) ?? {
      label: mode === "year" ? `${date.getMonth() + 1}월` : `${date.getMonth() + 1}/${date.getDate()}`,
      count: 0,
      failed: 0,
      highRisk: 0,
    };
    existing.count += 1;
    if (record.status === "failed") existing.failed += 1;
    if (record.risk_level === "high" || record.risk_level === "critical") existing.highRisk += 1;
    map.set(key, existing);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value);
}

function lastDayOfMonth(month: string) {
  const [year, rawMonth] = month.split("-").map(Number);
  const date = new Date(year, rawMonth, 0);
  return date.toISOString().slice(0, 10);
}

function percent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}
