import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { adLibraryAdUrl, adLibraryUrl, instagramProfileUrl } from "@/lib/adlibrary";
import { PLATFORM_LABELS } from "@/lib/normalize";
import { formatDate, formatDateTime } from "@/lib/utils";
import { listAds, listAllCities, listBrands } from "@/server/queries";
import { AdFilterBar } from "./ad-filter-bar";

export const dynamic = "force-dynamic";

const RANGES: Record<string, number> = { "7": 7, "30": 30, "90": 90 };

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<{
    brand?: string;
    city?: string;
    range?: string;
    state?: string;
    ad?: string;
    search?: string;
  }>;
}) {
  await requireSession();
  const query = await searchParams;

  const brandId = query.brand ? Number.parseInt(query.brand, 10) : undefined;
  const days = query.range ? RANGES[query.range] : undefined;
  const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;

  const [rows, brandRows, cities] = await Promise.all([
    listAds({
      brandId: Number.isFinite(brandId) ? brandId : undefined,
      city: query.city || undefined,
      since,
      onlyActive: query.state !== "all",
      adArchiveId: query.ad || undefined,
      search: query.search || undefined,
    }),
    listBrands(),
    listAllCities(),
  ]);

  return (
    <AppShell active="/ads">
      <PageHeader
        title="Reklam akışı"
        description="Taramalarda görülen rakip reklamları. Kreatif görselleri Meta CDN üzerinden yüklenir; bu bağlantılar zamanla geçersizleşebilir."
      />

      <AdFilterBar
        brands={brandRows.map((b) => ({ id: b.id, name: b.name }))}
        cities={cities}
        current={{
          brand: query.brand ?? "",
          city: query.city ?? "",
          range: query.range ?? "",
          state: query.state ?? "active",
          search: query.search ?? "",
        }}
      />

      {query.ad ? (
        <div className="mb-4 rounded-md bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
          Tek reklam gösteriliyor ({query.ad}).{" "}
          <Link href="/ads" className="font-medium underline">
            Tüm reklamlar
          </Link>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="card px-5 py-16 text-center">
          <p className="text-sm font-medium">Gösterilecek reklam yok.</p>
          <p className="mt-1 text-sm muted">
            Eşleştirilmiş rakipler taranınca reklamlar burada listelenir.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs muted">{rows.length} reklam</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((ad) => (
              <article key={ad.adArchiveId} className="card flex flex-col overflow-hidden">
                {ad.imageUrl ? (
                  // Meta CDN görselleri: next/image yerine düz img — link
                  // süresi bittiğinde optimizasyon katmanı hata üretmesin.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ad.imageUrl}
                    alt={ad.competitorName}
                    className="h-44 w-full bg-ink-100 object-cover dark:bg-ink-700"
                    loading="lazy"
                  />
                ) : (
                  <div className="grid h-44 w-full place-items-center bg-ink-100 text-xs muted dark:bg-ink-700">
                    Görsel yok
                  </div>
                )}

                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">
                        {ad.competitorName}
                      </h3>
                      <p className="truncate text-xs muted">
                        {ad.brandName} · {ad.dealerName}
                        {ad.dealerCity ? ` · ${ad.dealerCity}` : ""}
                      </p>
                    </div>
                    {ad.isActive ? (
                      <Badge tone="ok">Aktif</Badge>
                    ) : (
                      <Badge tone="neutral">Durdu</Badge>
                    )}
                  </div>

                  {ad.creativeTitle ? (
                    <p className="text-xs font-medium">{ad.creativeTitle}</p>
                  ) : null}
                  {ad.creativeText ? (
                    <p className="line-clamp-4 text-xs muted">{ad.creativeText}</p>
                  ) : null}

                  <div className="mt-auto space-y-1.5 pt-2">
                    <div className="flex flex-wrap gap-1">
                      {ad.platforms.length > 0 ? (
                        ad.platforms.map((platform) => (
                          <Badge key={platform} tone="info">
                            {PLATFORM_LABELS[platform] ?? platform}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs muted">Platform bilgisi yok</span>
                      )}
                    </div>
                    <p className="text-xs muted">
                      Başlangıç: {formatDate(ad.startedAt)} · İlk görülme:{" "}
                      {formatDate(ad.firstSeenAt)}
                    </p>
                    <p className="text-xs muted">
                      Son görülme: {formatDateTime(ad.lastSeenAt)}
                      {ad.stoppedAt ? ` · Durdu: ${formatDate(ad.stoppedAt)}` : ""}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                      <a
                        href={
                          ad.fbPageId
                            ? adLibraryUrl(ad.fbPageId)
                            : adLibraryAdUrl(ad.adArchiveId)
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-500 hover:underline"
                      >
                        Ad Library
                      </a>
                      {ad.instagramHandle ? (
                        <a
                          href={instagramProfileUrl(ad.instagramHandle)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-500 hover:underline"
                        >
                          Instagram
                        </a>
                      ) : null}
                      {ad.landingUrl ? (
                        <a
                          href={ad.landingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-500 hover:underline"
                        >
                          Hedef sayfa
                        </a>
                      ) : null}
                      {!ad.notified ? (
                        <Badge tone="warn">Bildirilmedi</Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
