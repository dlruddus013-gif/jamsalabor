import AppSidebar from "@/components/AppSidebar";
import Link from "next/link";
import {
  Bot,
  DatabaseBackup,
  FileAudio,
  LayoutDashboard,
  Settings,
} from "lucide-react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <AppSidebar />
      <main className="md:ml-60 min-h-screen pb-24 md:pb-12">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">
          {children}
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}

function MobileBottomNav() {
  const nav = [
    { href: "/dashboard", icon: LayoutDashboard, label: "홈" },
    { href: "/recordings", icon: FileAudio, label: "녹음" },
    { href: "/backup", icon: DatabaseBackup, label: "백업" },
    { href: "/assistant", icon: Bot, label: "답변" },
    { href: "/settings", icon: Settings, label: "설정" },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-cream/95 backdrop-blur-md border-t border-line z-30">
      <div className="grid grid-cols-5 max-w-md mx-auto">
        {nav.map((n) => {
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              className="py-3 flex flex-col items-center gap-0.5 text-ink-mute hover:text-accent transition-colors"
            >
              <Icon size={17} />
              <span className="text-[10px] font-medium">{n.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

