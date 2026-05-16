"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileAudio,
  Upload,
  Smartphone,
  Settings,
  LogOut,
  Mic,
} from "lucide-react";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/dashboard",       label: "대시보드",     icon: LayoutDashboard },
  { href: "/recordings",      label: "통화 녹음",    icon: FileAudio },
  { href: "/upload",          label: "업로드",       icon: Upload },
  { href: "/mobile-recorder", label: "모바일 녹음",  icon: Smartphone },
  { href: "/settings",        label: "설정",         icon: Settings },
];

export default function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-60 bg-paper border-r border-line z-30">
      {/* 로고 */}
      <div className="px-5 py-5 border-b border-line">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-accent text-cream flex items-center justify-center">
            <span className="font-display text-lg font-bold">잠</span>
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-bold">jamsa-vito</div>
            <div className="text-[10px] text-ink-mute">한국잠사박물관</div>
          </div>
        </Link>
      </div>

      {/* 라이브 인디케이터 */}
      <div className="mx-3 mt-3 px-3 py-2.5 rounded-xl bg-surface">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent animate-rec-pulse" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-accent" />
          </span>
          <span className="font-semibold text-olive">녹음 중 · 1건</span>
        </div>
        <div className="text-[10px] text-ink-mute mt-0.5">실시간 STT 활성</div>
      </div>

      {/* 네비 */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <div className="px-2 mb-2 text-[10px] tracking-[0.25em] uppercase text-gold">
          Navigation
        </div>
        {NAV.map((n) => {
          const active = pathname === n.href || pathname.startsWith(n.href + "/");
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] transition-colors",
                active
                  ? "bg-ink text-cream font-semibold"
                  : "text-ink-soft hover:bg-surface"
              )}
            >
              <Icon size={15} />
              {n.label}
            </Link>
          );
        })}
      </nav>

      {/* 푸터 */}
      <div className="px-3 pb-4">
        <div className="silk-line h-px mb-3" />
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-ink-soft hover:bg-surface">
          <Mic size={13} />
          빠른 녹음 시작
        </button>
        <Link
          href="/login"
          className="w-full mt-1 flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-ink-mute hover:bg-surface"
        >
          <LogOut size={13} />
          로그아웃
        </Link>
      </div>
    </aside>
  );
}
