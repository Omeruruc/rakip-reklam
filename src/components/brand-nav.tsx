import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";

const TABS = [
  { slug: "dealers", label: "Bayiler" },
  { slug: "competitors", label: "Rakipler" },
  { slug: "matching", label: "Page Eşleştirme" },
  { slug: "import", label: "Excel İçe Aktarma" },
] as const;

export function BrandNav({
  brandId,
  active,
  pendingMatch,
}: {
  brandId: number;
  active: (typeof TABS)[number]["slug"];
  pendingMatch?: number;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-[var(--border)] pb-2">
      {TABS.map((tab) => (
        <Link
          key={tab.slug}
          href={`/brands/${brandId}/${tab.slug}`}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm",
            active === tab.slug
              ? "bg-ink-100 font-medium dark:bg-ink-700"
              : "muted hover:bg-ink-50 dark:hover:bg-ink-700",
          )}
        >
          {tab.label}
          {tab.slug === "matching" && pendingMatch ? (
            <Badge tone="warn">{pendingMatch}</Badge>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
