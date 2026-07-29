import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Sayfalama — sunucu bileşeni. İstemci tarafı state gerekmiyor, yalnızca
 * sayfa numarasını değiştiren `Link`ler üretiyor.
 */
export function Pagination({
  page,
  totalPages,
  hrefForPage,
}: {
  page: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  // Ortadaki birkaç sayfayı göster: mevcut sayfanın ±2'si, baş ve son sabit.
  const pages = new Set<number>([1, totalPages]);
  for (let p = page - 2; p <= page + 2; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);

  return (
    <nav className="mt-6 flex items-center justify-center gap-1">
      <PageLink
        href={hrefForPage(page - 1)}
        disabled={page <= 1}
        label="‹ Önceki"
      />
      {sorted.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && sorted[i - 1] !== p - 1 ? (
            <span className="px-1 text-xs muted">…</span>
          ) : null}
          <Link
            href={hrefForPage(p)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              p === page
                ? "bg-ink-800 font-medium text-white dark:bg-ink-600"
                : "muted hover:bg-ink-100 dark:hover:bg-ink-700",
            )}
          >
            {p}
          </Link>
        </span>
      ))}
      <PageLink
        href={hrefForPage(page + 1)}
        disabled={page >= totalPages}
        label="Sonraki ›"
      />
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="cursor-not-allowed rounded-md px-3 py-1.5 text-sm text-ink-300 dark:text-ink-600">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-sm muted hover:bg-ink-100 dark:hover:bg-ink-700"
    >
      {label}
    </Link>
  );
}
