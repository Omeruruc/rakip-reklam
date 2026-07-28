import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ads,
  brands,
  competitors,
  dealers,
  notifications,
  scrapeRuns,
} from "@/db/schema";
import type { DigestBrandSummary } from "@/lib/slack";

/**
 * Haftalık özet verisi.
 *
 * "Duran reklam" bildirimi anlık gitmez, buraya birikir (§7). Her duran
 * reklam yalnızca BİR haftalık özette görünür: özet gönderilirken
 * notifications tablosuna type='stopped_ad' satırı yazılır ve UNIQUE kısıtı
 * ikinci kez raporlanmasını engeller.
 */

export type WeeklyDigestData = {
  periodStart: Date;
  periodEnd: Date;
  brands: DigestBrandSummary[];
  /** Bu özette raporlanan duran reklam kimlikleri — sahiplenilecek. */
  stoppedAdIds: string[];
};

export async function collectWeeklyDigest(
  now: Date = new Date(),
): Promise<WeeklyDigestData> {
  const periodEnd = now;
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const activeBrands = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(eq(brands.isActive, true))
    .orderBy(brands.name);

  const summaries: DigestBrandSummary[] = [];
  const stoppedAdIds: string[] = [];

  for (const brand of activeBrands) {
    // Bu hafta ilk kez görülen reklamlar.
    const [newCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ads)
      .innerJoin(competitors, eq(ads.competitorId, competitors.id))
      .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
      .where(and(eq(dealers.brandId, brand.id), gte(ads.firstSeenAt, periodStart)));

    // Henüz hiçbir özette raporlanmamış duran reklamlar.
    const stoppedRows = await db
      .select({
        adArchiveId: ads.adArchiveId,
        competitorName: competitors.name,
        dealerName: dealers.name,
      })
      .from(ads)
      .innerJoin(competitors, eq(ads.competitorId, competitors.id))
      .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
      .leftJoin(
        notifications,
        and(
          eq(notifications.adArchiveId, ads.adArchiveId),
          eq(notifications.type, "stopped_ad"),
        ),
      )
      .where(
        and(
          eq(dealers.brandId, brand.id),
          eq(ads.isActive, false),
          isNull(notifications.id),
        ),
      );

    const stoppedByCompetitor = new Map<
      string,
      { competitorName: string; dealerName: string; count: number }
    >();
    for (const row of stoppedRows) {
      stoppedAdIds.push(row.adArchiveId);
      const key = `${row.dealerName}::${row.competitorName}`;
      const existing = stoppedByCompetitor.get(key);
      if (existing) existing.count++;
      else
        stoppedByCompetitor.set(key, {
          competitorName: row.competitorName,
          dealerName: row.dealerName,
          count: 1,
        });
    }

    const [activeCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ads)
      .innerJoin(competitors, eq(ads.competitorId, competitors.id))
      .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
      .where(and(eq(dealers.brandId, brand.id), eq(ads.isActive, true)));

    const matchCounts = await db
      .select({
        matchStatus: competitors.matchStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(competitors)
      .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
      .where(eq(dealers.brandId, brand.id))
      .groupBy(competitors.matchStatus);

    const [failedRuns] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(scrapeRuns)
      .where(
        and(
          eq(scrapeRuns.brandId, brand.id),
          eq(scrapeRuns.status, "failed"),
          gte(scrapeRuns.startedAt, periodStart),
        ),
      );

    summaries.push({
      brandName: brand.name,
      newAds: newCount?.count ?? 0,
      stoppedAds: [...stoppedByCompetitor.values()].sort(
        (a, b) => b.count - a.count,
      ),
      activeAds: activeCount?.count ?? 0,
      competitorsMatched:
        matchCounts.find((m) => m.matchStatus === "matched")?.count ?? 0,
      competitorsPending:
        matchCounts.find((m) => m.matchStatus === "unverified")?.count ?? 0,
      failedRuns: failedRuns?.count ?? 0,
    });
  }

  return { periodStart, periodEnd, brands: summaries, stoppedAdIds };
}

/** Duran reklamları raporlanmış işaretler — ikinci özette görünmesinler. */
export async function markStoppedAdsReported(
  adArchiveIds: string[],
): Promise<void> {
  if (adArchiveIds.length === 0) return;
  const now = new Date();
  await db
    .insert(notifications)
    .values(
      adArchiveIds.map((adArchiveId) => ({
        adArchiveId,
        type: "stopped_ad" as const,
        sentAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [notifications.adArchiveId, notifications.type],
    });
}

/** Panodaki "son bildirimler" listesi. */
export async function recentNotifications(limit = 10) {
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      createdAt: notifications.createdAt,
      sentAt: notifications.sentAt,
      adArchiveId: notifications.adArchiveId,
      competitorName: competitors.name,
      dealerName: dealers.name,
      brandName: brands.name,
      imageUrl: ads.imageUrl,
      creativeText: ads.creativeText,
    })
    .from(notifications)
    .innerJoin(ads, eq(notifications.adArchiveId, ads.adArchiveId))
    .innerJoin(competitors, eq(ads.competitorId, competitors.id))
    .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
    .innerJoin(brands, eq(dealers.brandId, brands.id))
    .orderBy(sql`${notifications.createdAt} desc`)
    .limit(limit);
}
