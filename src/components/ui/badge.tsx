import * as React from "react";
import { cn } from "@/lib/utils";
import type { MatchStatus } from "@/db/schema";

const TONES = {
  neutral: "bg-ink-100 text-ink-700 dark:bg-ink-700 dark:text-ink-100",
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  danger: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  unverified: "Eşleştirme bekliyor",
  matched: "Eşleşti",
  no_page: "Sayfası yok",
  ignored: "Yok sayıldı",
};

const MATCH_STATUS_TONES: Record<MatchStatus, BadgeTone> = {
  unverified: "warn",
  matched: "ok",
  no_page: "neutral",
  ignored: "neutral",
};

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  return (
    <Badge tone={MATCH_STATUS_TONES[status]}>
      {MATCH_STATUS_LABELS[status]}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: BadgeTone; label: string }> = {
    running: { tone: "info", label: "Çalışıyor" },
    completed: { tone: "ok", label: "Tamamlandı" },
    failed: { tone: "danger", label: "Başarısız" },
  };
  const item = map[status] ?? { tone: "neutral" as BadgeTone, label: status };
  return <Badge tone={item.tone}>{item.label}</Badge>;
}
