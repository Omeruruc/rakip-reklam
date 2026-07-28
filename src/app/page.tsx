import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Badge, RunStatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, Stat } from "@/components/ui/card";
import { Table, Td, Th, EmptyRow } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { formatCost, formatDateTime } from "@/lib/utils";
import { recentNotifications } from "@/server/digest";
import { dashboardStats, lastRunByBrand, listBrands } from "@/server/queries";
import { ScanButton } from "@/components/scan-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireSession();

  const [brandRows, stats, lastRuns, notifications] = await Promise.all([
    listBrands(),
    dashboardStats(),
    lastRunByBrand(),
    recentNotifications(8),
  ]);

  const totalPending = brandRows.reduce((sum, b) => sum + b.pendingMatch, 0);

  return (
    <AppShell active="/">
      <PageHeader
        title="Pano"
        description="Rakiplerin Meta reklamları her gün 08:00'de taranır; yalnızca durum değişiklikleri Slack'e düşer."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Aktif rakip reklamı" value={stats.activeAds} />
        <Stat
          label="Bu hafta yeni"
          value={stats.newThisWeek}
          tone={stats.newThisWeek > 0 ? "ok" : "default"}
        />
        <Stat
          label="Eşleştirme bekleyen"
          value={totalPending}
          tone={totalPending > 0 ? "warn" : "default"}
          hint={totalPending > 0 ? "Bu rakipler taranmıyor" : "Tümü eşleşti"}
        />
        <Stat
          label="Başarısız tarama (7 gün)"
          value={stats.failedRunsThisWeek}
          tone={stats.failedRunsThisWeek > 0 ? "danger" : "default"}
        />
        <Stat
          label="Apify maliyeti (7 gün)"
          value={formatCost(stats.costThisWeek)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Markalar</CardTitle>
            <Link
              href="/brands"
              className="text-xs font-medium text-brand-500 hover:underline"
            >
              Tümünü yönet →
            </Link>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Marka</Th>
                  <Th>Rakip</Th>
                  <Th>Aktif reklam</Th>
                  <Th>Son tarama</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {brandRows.length === 0 ? (
                  <EmptyRow colSpan={5}>
                    Henüz marka yok.{" "}
                    <Link href="/brands" className="text-brand-500 hover:underline">
                      İlk markayı ekleyin
                    </Link>
                    .
                  </EmptyRow>
                ) : (
                  brandRows.map((brand) => {
                    const run = lastRuns.get(brand.id);
                    return (
                      <tr key={brand.id}>
                        <Td>
                          <Link
                            href={`/brands/${brand.id}/competitors`}
                            className="font-medium hover:underline"
                          >
                            {brand.name}
                          </Link>
                          {!brand.isActive ? (
                            <Badge tone="neutral" className="ml-2">
                              Pasif
                            </Badge>
                          ) : null}
                        </Td>
                        <Td className="tabular-nums">
                          {brand.matchedCount}/{brand.competitorCount}
                          {brand.pendingMatch > 0 ? (
                            <Link
                              href={`/brands/${brand.id}/matching`}
                              className="ml-2 inline-block"
                            >
                              <Badge tone="warn">
                                {brand.pendingMatch} bekliyor
                              </Badge>
                            </Link>
                          ) : null}
                        </Td>
                        <Td className="tabular-nums">{brand.activeAds}</Td>
                        <Td>
                          {run ? (
                            <div className="flex flex-col gap-1">
                              <RunStatusBadge status={run.status} />
                              <span className="text-xs muted">
                                {formatDateTime(run.startedAt)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs muted">Hiç taranmadı</span>
                          )}
                        </Td>
                        <Td>
                          <ScanButton brandId={brand.id} />
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </div>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Son bildirimler</CardTitle>
            <Link
              href="/ads"
              className="text-xs font-medium text-brand-500 hover:underline"
            >
              Reklam akışı →
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {notifications.length === 0 ? (
              <p className="py-6 text-center text-sm muted">
                Henüz bildirim gönderilmedi.
              </p>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0"
                >
                  <span className="mt-1">
                    {item.type === "new_ad" ? "🔴" : "⚪️"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {item.competitorName}
                      <span className="ml-2 text-xs muted">
                        {item.brandName} · {item.dealerName}
                      </span>
                    </div>
                    {item.creativeText ? (
                      <p className="mt-0.5 line-clamp-2 text-xs muted">
                        {item.creativeText}
                      </p>
                    ) : null}
                    <div className="mt-1 text-xs muted">
                      {formatDateTime(item.createdAt)}
                      {item.sentAt ? "" : " · gönderilemedi"}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
