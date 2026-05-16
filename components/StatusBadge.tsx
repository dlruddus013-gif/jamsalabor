import { CheckCircle2, Loader2, Upload, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { RecordingStatus } from "@/lib/types";

const STATUS_MAP: Record<
  RecordingStatus,
  { label: string; icon: typeof CheckCircle2; bg: string; fg: string; spin?: boolean }
> = {
  uploading:  { label: "업로드 중", icon: Upload,        bg: "bg-sky/10",     fg: "text-sky",     spin: false },
  processing: { label: "분석 중",   icon: Loader2,       bg: "bg-gold/10",    fg: "text-gold",    spin: true  },
  completed:  { label: "완료",      icon: CheckCircle2,  bg: "bg-olive/10",   fg: "text-olive",   spin: false },
  failed:     { label: "실패",      icon: AlertTriangle, bg: "bg-accent/10",  fg: "text-accent",  spin: false },
};

interface Props {
  status: RecordingStatus;
  size?: "sm" | "md";
  className?: string;
}

export default function StatusBadge({ status, size = "sm", className }: Props) {
  const c = STATUS_MAP[status];
  const Icon = c.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        c.bg,
        c.fg,
        className
      )}
    >
      <Icon size={size === "sm" ? 10 : 12} className={c.spin ? "animate-spin" : ""} />
      {c.label}
    </span>
  );
}
