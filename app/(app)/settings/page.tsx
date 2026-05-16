"use client";

import { Mic, FileAudio, Sparkles, Shield, Database, Bell, User } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import IntegrationStatusPanel from "@/components/IntegrationStatusPanel";

export default function SettingsPage() {
  return (
    <div className="space-y-5 animate-slide-up max-w-3xl">
      <div>
        <div className="text-[11px] tracking-[0.3em] uppercase text-gold mb-1">
          Settings
        </div>
        <h1 className="font-display text-[28px] font-bold">설정</h1>
        <p className="text-[13px] text-ink-soft mt-1">
          녹음·STT·AI 분석·보관 관련 정책을 한 곳에서 관리합니다.
        </p>
      </div>

      {/* 계정 */}
      <Section title="계정" icon={User}>
        <Field label="이메일" value="admin@jamsamuseum.co.kr" />
        <Field label="이름" value="이경연" />
        <Field label="역할" value="대표 / Admin" />
      </Section>

      {/* 녹음 */}
      <Section title="녹음" icon={Mic}>
        <Toggle label="자동 녹음" desc="전화 수신 시 자동으로 녹음 시작" defaultOn />
        <Toggle label="듀얼 채널 녹음" desc="상담원·고객 음성을 별도 트랙으로 저장" defaultOn />
        <Field label="최대 통화 시간" value="60분" />
      </Section>

      {/* STT */}
      <Section title="STT (음성 → 텍스트)" icon={FileAudio}>
        <Field label="엔진" value="Whisper · Korean" />
        <Toggle label="화자 분리" desc="상담원·고객 자동 구분" defaultOn />
        <Toggle label="실시간 변환" desc="통화 중 실시간 STT (베타)" />
      </Section>

      {/* AI 요약 */}
      <Section title="AI 요약" icon={Sparkles}>
        <Field label="모델" value="Claude Opus 4.7" />
        <Toggle label="자동 요약" desc="STT 완료 시 자동으로 요약 생성" defaultOn />
        <Toggle label="액션 아이템 추출" desc="후속 조치 항목 자동 추출" defaultOn />
        <Toggle label="감정 분석" desc="긍정·중립·부정 자동 분류" defaultOn />
      </Section>

      {/* 보안 */}
      <Section title="보안 · 개인정보" icon={Shield}>
        <Toggle label="번호 마스킹" desc="휴대폰·주민번호 자동 가림" defaultOn />
        <Toggle label="민감정보 자동 삭제" desc="카드번호·계좌번호 STT 결과에서 제거" defaultOn />
        <Field label="접근 권한" value="2FA 필수 · 화이트리스트 IP" />
      </Section>

      {/* 보관 */}
      <Section title="데이터 보관" icon={Database}>
        <Field label="오디오 보관 기간" value="90일 (자동 삭제)" />
        <Field label="텍스트 보관 기간" value="365일" />
        <Field label="요약 보관 기간" value="무제한" />
        <Field label="저장소" value="Supabase Storage · jamsa-vito-audio" />
      </Section>

      {/* 알림 */}
      <Section title="알림" icon={Bell}>
        <Toggle label="핸드오프 알림" desc="상담원 연결 필요 시 카카오톡" defaultOn />
        <Toggle label="일일 리포트" desc="매일 오후 6시 운영 요약" defaultOn />
        <Toggle label="실패 알림" desc="STT/요약 실패 시 즉시 알림" defaultOn />
      </Section>

      <IntegrationStatusPanel />

      <div className="flex gap-2 pt-2">
        <button className="flex-1 py-3 rounded-xl bg-ink text-cream font-bold text-[13px]">
          저장
        </button>
        <button className="px-5 py-3 rounded-xl bg-paper border border-line text-ink-soft text-[13px]">
          취소
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Mic;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-paper border border-line overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line flex items-center gap-2">
        <Icon size={15} className="text-accent" />
        <div className="font-display text-[15px] font-bold">{title}</div>
      </div>
      <div className="divide-y divide-line-soft">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3 flex items-center justify-between">
      <div className="text-[12px] text-ink-soft">{label}</div>
      <div className="text-[13px] font-medium">{value}</div>
    </div>
  );
}

function Toggle({ label, desc, defaultOn }: { label: string; desc?: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(!!defaultOn);
  return (
    <div className="px-5 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {desc && <div className="text-[11px] text-ink-mute mt-0.5">{desc}</div>}
      </div>
      <button
        onClick={() => setOn(!on)}
        className={cn(
          "relative w-11 h-6 rounded-full transition-colors shrink-0",
          on ? "bg-olive" : "bg-line"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 w-5 h-5 rounded-full bg-paper shadow-sm transition-all",
            on ? "left-[22px]" : "left-0.5"
          )}
        />
      </button>
    </div>
  );
}
