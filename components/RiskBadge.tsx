import { ShieldAlert, Shield, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import type { RiskLevel } from "@/lib/types";

const RISK_TOKENS: Record<
  RiskLevel,
  { label: string; bg: string; fg: string; icon: typeof Shield }
> = {
  none:     { label: "위험 없음",  bg: "bg-line-soft",   fg: "text-ink-mute", icon: ShieldCheck },
  low:      { label: "낮음",       bg: "bg-olive/15",    fg: "text-olive",    icon: Shield },
  medium:   { label: "보통",       bg: "bg-gold/15",     fg: "text-gold",     icon: Shield },
  high:     { label: "높음",       bg: "bg-accent/15",   fg: "text-accent",   icon: ShieldAlert },
  critical: { label: "심각",       bg: "bg-accent",      fg: "text-cream",    icon: ShieldAlert },
};

interface Props {
  risk: RiskLevel | null | undefined;
  size?: "sm" | "md";
  className?: string;
}

export default function RiskBadge({ risk, size = "sm", className }: Props) {
  if (!risk || risk === "none") return null; // none 은 굳이 표시하지 않음
  const token = RISK_TOKENS[risk];
  const Icon = token.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        token.bg,
        token.fg,
        className
      )}
      title={`위험도: ${token.label}`}
    >
      <Icon size={size === "sm" ? 10 : 12} />
      {token.label}
    </span>
  );
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  none: RISK_TOKENS.none.label,
  low: RISK_TOKENS.low.label,
  medium: RISK_TOKENS.medium.label,
  high: RISK_TOKENS.high.label,
  critical: RISK_TOKENS.critical.label,
};
