"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Smile,
  Meh,
  Frown,
  Clock,
  ChevronRight,
  FileText,
  MessageSquare,
  Tag,
  User,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  formatDuration,
  formatRelativeKR,
  maskPhone,
} from "@/lib/mock-data";
import StatusBadge from "@/components/StatusBadge";
import RiskBadge from "@/components/RiskBadge";
import type { SearchHit, MatchedIn } from "@/lib/recordings-search";
import type { Sentiment } from "@/lib/types";

// ─────────────────────────────────────────────────────────
// 매칭 출처 칩
// ─────────────────────────────────────────────────────────

const MATCH_LABEL: Record<MatchedIn, { label: string; icon: typeof FileText }> = {
  title:      { label: "제목 일치",       icon: Tag },
  meta:       { label: "정보 일치",       icon: User },
  summary:    { label: "요약 일치",       icon: MessageSquare },
  transcript: { label: "전사 일치",       icon: FileText },
};

// ─────────────────────────────────────────────────────────
// 감정 아이콘
// ─────────────────────────────────────────────────────────

const SENT_ICON = { pos: Smile, neu: Meh, neg: Frown };
const SENT_COLOR: Record<Sentiment, string> = {
  pos: "text-olive",
  neu: "text-gold",
  neg: "text-accent",
};
const LOCAL_RECORDINGS_KEY = "jamsa-local-backup-recordings-v1";
const BACKUP_STATE_KEY = "jamsa-auto-backup-state-v4";

interface Props {
  hits: SearchHit[];
  query: string;
  hasFilters: boolean;
}

export default function SearchResults({ hits, query, hasFilters }: Props) {
  const router = useRouter();
  const [localHits, setLocalHits] = useState<SearchHit[]>([]);
  const displayHits = useMemo(() => mergeLocalHits(hits, localHits, query), [hits, localHits, query]);
  const hasLiveJobs = displayHits.some((hit) => hit.status === "uploading" || hit.status === "processing");

  useEffect(() => {
    if (!hasLiveJobs) return;
    const timer = window.setInterval(() => {
      router.refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasLiveJobs, router]);

  useEffect(() => {
    const load = () => setLocalHits(loadLocalBackupRecordings());
    load();
    const timer = window.setInterval(load, 3000);
    window.addEventListener("storage", load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", load);
    };
  }, []);

  if (displayHits.length === 0) {
    return (
      <div className="rounded-2xl bg-paper border border-line p-12 text-center">
        <div className="font-display text-[16px] font-bold mb-1">
          {hasFilters ? "조건에 맞는 통화가 없습니다" : "통화가 아직 없습니다"}
        </div>
        <div className="text-[12px] text-ink-mute">
          {hasFilters
            ? "검색어를 줄이거나 필터를 다시 설정해보세요."
            : "오디오 파일을 업로드하거나 모바일에서 녹음해보세요."}
        </div>
      </div>
    );
  }

  const groups = groupHitsByPhoneAndDate(displayHits);

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key} className="rounded-2xl bg-paper border border-line overflow-hidden">
          <div className="px-4 py-3 bg-cream/60 border-b border-line-soft flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-bold num">{group.label}</div>
              <div className="text-[11px] text-ink-mute">같은 번호 통화 {group.count}건</div>
            </div>
            <div className="text-[10px] text-ink-mute num">{group.dateCount}일</div>
          </div>
          {group.dates.map((date) => (
            <div key={date.key}>
              <div className="px-4 py-2 bg-surface/40 text-[11px] font-semibold text-ink-soft border-b border-line-soft">
                {date.label}
              </div>
              <div className="divide-y divide-line-soft">
                {date.hits.map((h) => (
                  <SearchHitRow key={h.id} hit={h} query={query} />
                ))}
              </div>
            </div>
        ))}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 결과 행
// ─────────────────────────────────────────────────────────

function SearchHitRow({ hit, query }: { hit: SearchHit; query: string }) {
  const sent = hit.sentiment as Sentiment | null;
  const SentIcon = sent ? SENT_ICON[sent] : Meh;
  const sentClass = sent ? SENT_COLOR[sent] : "text-ink-mute";

  const titleText = hit.title || hit.customer_name || "제목 없음";
  const matchInfo = MATCH_LABEL[hit.matched_in];
  const MatchIcon = matchInfo.icon;
  const isLocalBackup = hit.id.startsWith("local_backup:");

  const content = (
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-surface",
            sentClass
          )}
        >
          <SentIcon size={15} />
        </div>

        <div className="flex-1 min-w-0">
          {/* 1줄: 제목 + 시각 */}
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <div className="text-[13px] font-semibold truncate">
              <Highlight text={titleText} query={query} />
            </div>
            <div className="text-[10px] num shrink-0 text-ink-mute">
              {formatRelativeKR(hit.recorded_at)}
            </div>
          </div>

          {/* 2줄: 고객 / 번호 */}
          {(hit.customer_name || hit.customer_phone) && (
            <div className="text-[11px] num text-ink-soft truncate">
              {hit.customer_name && (
                <Highlight text={hit.customer_name} query={query} />
              )}
              {hit.customer_name && hit.customer_phone && (
                <span className="text-ink-mute"> · </span>
              )}
              {maskPhone(hit.customer_phone)}
            </div>
          )}

          {/* 3줄: 매칭 스니펫 */}
          {hit.snippet && (
            <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-surface/70 text-[11px] text-ink-soft border-l-2 border-accent/40">
              <div className="flex items-center gap-1 text-[9px] tracking-wider uppercase text-gold mb-0.5">
                <MatchIcon size={9} />
                {matchInfo.label}
              </div>
              <div className="line-clamp-2">
                <Highlight text={hit.snippet} query={query} />
              </div>
            </div>
          )}

          {/* 4줄: 메타 배지들 */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <StatusBadge status={hit.status as never} />
            <RiskBadge risk={hit.risk_level} />
            {hit.category && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gold/10 text-gold font-medium">
                {hit.category}
              </span>
            )}
            {hit.duration_sec > 0 && (
              <span className="text-[9px] num flex items-center gap-0.5 text-ink-mute">
                <Clock size={9} /> {formatDuration(hit.duration_sec)}
              </span>
            )}
            {hit.escalated && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
                핸드오프
              </span>
            )}
            {hit.resolved && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-olive/10 text-olive">
                해결
              </span>
            )}
          </div>
        </div>

        {!isLocalBackup && <ChevronRight size={14} className="text-ink-mute shrink-0 mt-2" />}
      </div>
  );

  if (isLocalBackup) {
    return <div className="block px-4 py-3.5 bg-surface/20">{content}</div>;
  }

  return (
    <Link
      href={`/recordings/${hit.id}`}
      className="block px-4 py-3.5 hover:bg-surface/50 transition-colors"
    >
      {content}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────
// 키워드 하이라이트
// ─────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const q = query.trim();
  // 대소문자 무시 + 메타문자 이스케이프
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) ? (
          <mark
            key={i}
            className="bg-gold/30 text-ink rounded px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function groupHitsByPhoneAndDate(hits: SearchHit[]) {
  const phoneGroups = new Map<string, { label: string; hits: SearchHit[] }>();

  for (const hit of hits) {
    const phone = extractPhone(hit);
    const key = phone ? normalizePhone(phone) : `unknown:${hit.id}`;
    const label = phone ? formatPhone(normalizePhone(phone)) : "번호 없음";
    const group = phoneGroups.get(key) ?? { label, hits: [] };
    group.hits.push(hit);
    phoneGroups.set(key, group);
  }

  return Array.from(phoneGroups.entries()).map(([key, group]) => {
    const dates = new Map<string, SearchHit[]>();
    for (const hit of group.hits) {
      const dateKey = toDateKey(hit.recorded_at);
      dates.set(dateKey, [...(dates.get(dateKey) ?? []), hit]);
    }
    return {
      key,
      label: group.label,
      count: group.hits.length,
      dateCount: dates.size,
      dates: Array.from(dates.entries()).map(([dateKey, dateHits]) => ({
        key: dateKey,
        label: formatDateGroup(dateKey),
        hits: dateHits,
      })),
    };
  });
}

function extractPhone(hit: SearchHit) {
  const text = [hit.customer_phone, hit.customer_name, hit.title, hit.excerpt, hit.snippet, hit.tags.join(" ")]
    .filter(Boolean)
    .join(" ");
  const dashed = text.match(/(?:\+82[-\s]?)?0\d{1,2}[-_\s.]?\d{3,4}[-_\s.]?\d{4}/);
  if (dashed) return dashed[0];
  const compact = text.match(/\b0\d{8,10}\b/);
  return compact?.[0] ?? null;
}

function normalizePhone(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("82")) digits = `0${digits.slice(2)}`;
  return digits;
}

function formatPhone(digits: string) {
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith("02")) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

function toDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 없음";
  return date.toISOString().slice(0, 10);
}

function formatDateGroup(key: string) {
  if (key === "날짜 없음") return key;
  const date = new Date(`${key}T00:00:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function loadLocalBackupRecordings(): SearchHit[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_RECORDINGS_KEY) ?? "[]") as SearchHit[];
    const saved = Array.isArray(parsed)
      ? parsed.filter((hit) => typeof hit.id === "string" && hit.id.startsWith("local_backup:"))
      : [];
    return mergeLocalBackupState(saved, loadBackupStateHits());
  } catch {
    return loadBackupStateHits();
  }
}

function loadBackupStateHits(): SearchHit[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(BACKUP_STATE_KEY) ?? "{}") as {
      jobs?: Record<
        string,
        {
          fingerprint: string;
          name: string;
          size: number;
          modified: number;
          status: string;
          message: string;
        }
      >;
    };
    const jobs = Object.values(parsed.jobs ?? {});
    return jobs
      .filter((job) => job.status === "uploaded" || job.status === "converting")
      .slice(0, 5000)
      .map((job) => {
        const title = job.name.split("/").pop()?.replace(/\.[^.]+$/, "") || job.name;
        const recordedAt = Number.isFinite(job.modified) && job.modified > 0
          ? new Date(job.modified).toISOString()
          : new Date().toISOString();
        return {
          id: `local_backup:${job.fingerprint}`,
          recorded_at: recordedAt,
          title,
          customer_name: null,
          customer_phone: extractPhoneFromText(job.name),
          category: "통화녹음",
          status: job.status === "converting" ? "processing" : "completed",
          sentiment: null,
          risk_level: null,
          resolved: false,
          escalated: false,
          duration_sec: 0,
          excerpt: `${job.name} backup completed`,
          tags: ["통화녹음", "폰백업"],
          matched_in: "meta" as const,
          snippet: job.message || `${job.name} backup completed`,
        };
      });
  } catch {
    return [];
  }
}

function mergeLocalBackupState(saved: SearchHit[], stateHits: SearchHit[]) {
  const seen = new Set(saved.map((hit) => hit.id));
  return [...saved, ...stateHits.filter((hit) => !seen.has(hit.id))];
}

function extractPhoneFromText(text: string) {
  const dashed = text.match(/(?:\+82[-_\s]?)?0\d{1,2}[-_\s.]?\d{3,4}[-_\s.]?\d{4}/);
  if (dashed) return formatPhone(normalizePhone(dashed[0]));
  const compact = text.match(/\b0\d{8,10}\b/);
  return compact ? formatPhone(normalizePhone(compact[0])) : null;
}

function mergeLocalHits(serverHits: SearchHit[], localHits: SearchHit[], query: string) {
  const q = query.trim().toLowerCase();
  const seen = new Set(serverHits.map((hit) => hit.id));
  const filteredLocal = localHits.filter((hit) => {
    if (seen.has(hit.id)) return false;
    if (!q) return true;
    return [hit.title, hit.customer_name, hit.customer_phone, hit.excerpt, hit.snippet, hit.tags.join(" ")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
  return [...filteredLocal, ...serverHits].sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
}
