"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Search, Server, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

type Status = "connected" | "missing-config" | "error";

type ServiceStatus = {
  configured: boolean;
  connected: boolean;
  status: Status;
  message: string;
  checkedAt: string;
};

type IntegrationStatus = {
  naver: {
    connected: boolean;
    search: ServiceStatus;
    speech: ServiceStatus;
  };
  okpos: ServiceStatus & {
    endpoint?: string;
    storeId?: string;
  };
};

export default function IntegrationStatusPanel() {
  const [data, setData] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`상태 확인 실패 ${res.status}`);
      setData((await res.json()) as IntegrationStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "상태 확인 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="rounded-2xl bg-paper border border-line overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Server size={15} className="text-accent" />
          <div className="font-display text-[15px] font-bold">외부 연동</div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-line bg-cream text-ink-soft hover:text-ink"
          aria-label="연동 상태 새로고침"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {error ? (
        <div className="px-5 py-4 text-[13px] text-accent">{error}</div>
      ) : (
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <IntegrationCard
            icon="NV"
            title="NAVER"
            connected={Boolean(data?.naver.connected)}
            loading={loading && !data}
            lines={[
              data?.naver.search.message ?? "검색 API 확인 중",
              data?.naver.speech.message ?? "CLOVA STT 확인 중",
            ]}
          />
          <IntegrationCard
            icon="POS"
            title="OKPOS"
            connected={Boolean(data?.okpos.connected)}
            loading={loading && !data}
            lines={[
              data?.okpos.message ?? "OKPOS API 확인 중",
              data?.okpos.storeId ? `매장 ${data.okpos.storeId}` : "매장 코드 대기",
            ]}
          />
        </div>
      )}
    </div>
  );
}

function IntegrationCard({
  icon,
  title,
  connected,
  loading,
  lines,
}: {
  icon: string;
  title: string;
  connected: boolean;
  loading: boolean;
  lines: string[];
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        connected ? "border-olive/30 bg-olive/5" : "border-accent/25 bg-accent/5"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-[11px] font-bold",
                connected ? "bg-olive text-cream" : "bg-accent text-cream"
              )}
            >
              {icon}
            </span>
            <div className="font-display text-[17px] font-bold">{title}</div>
          </div>
          <div
            className={cn(
              "mt-2 inline-flex items-center gap-1 text-[12px] font-bold",
              connected ? "text-olive" : "text-accent"
            )}
          >
            {loading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : connected ? (
              <CheckCircle2 size={13} />
            ) : (
              <XCircle size={13} />
            )}
            {loading ? "확인 중" : connected ? "연결됨" : "미연결"}
          </div>
        </div>
        <Search size={15} className="text-ink-mute" />
      </div>
      <div className="mt-3 space-y-1">
        {lines.map((line) => (
          <div key={line} className="text-[11px] leading-relaxed text-ink-soft">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
