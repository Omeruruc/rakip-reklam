import { and, asc, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ads,
  brands,
  competitors,
  dealers,
  notifications,
  scrapeRuns,
  type MatchStatus,
} from "@/db/schema";

/** Arayüz okumaları. Yazma yok — mutasyonlar server actions içinde. */

export async function listBrands() {
  const rows = await db
    .select({
      id: brands.id,
      name: brands.name,
      isActive: brands.isActive,
      createdAt: brands.createdAt,
      dealerCount: sql<number>`(
        select count(*)::int from dealers d where d.brand_id = brands.id
      )`,
      competitorCount: sql<number>`(
        select count(*)::int from competitors c
        join dealers d on d.id = c.dealer_id
        where d.brand_id = brands.id
      )`,
      pendingMatch: sql<number>`(
        select count(*)::int from competitors c
        join dealers d on d.id = c.dealer_id
        where d.brand_id = brands.id and c.match_status = 'unverified'
      )`,
      matchedCount: sql<number>`(
        select count(*)::int from competitors c
        join dealers d on d.id = c.dealer_id
        where d.brand_id = brands.id and c.match_status = 'matched'
      )`,
      activeAds: sql<number>`(
        select count(*)::int from ads a
        join competitors c on c.id = a.competitor_id
        join dealers d on d.id = c.dealer_id
        where d.brand_id = brands.id and a.is_active = true
      )`,
    })
    .from(brands)
    .orderBy(asc(brands.name));
  return rows;
}

export async function getBrand(brandId: number) {
  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  return brand ?? null;
}

export async function lastRunByBrand() {
  const rows = await db
    .select({
      brandId: scrapeRuns.brandId,
      id: scrapeRuns.id,
      status: scrapeRuns.status,
      startedAt: scrapeRuns.startedAt,
      finishedAt: scrapeRuns.finishedAt,
      adsFound: scrapeRuns.adsFound,
      newAds: scrapeRuns.newAds,
      error: scrapeRuns.error,
    })
    .from(scrapeRuns)
    // id de sıralamaya girer: aynı anda başlayan iki tarama arasında
    // hangisinin sonuncu olduğu belirsiz kalmasın.
    .orderBy(desc(scrapeRuns.startedAt), desc(scrapeRuns.id));

  const latest = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.brandId)) latest.set(row.brandId, row);
  }
  return latest;
}

export async function dashboardStats() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Tarih parametresi ham SQL parçasına Date olarak verilemez: sürücü tip
  // ipucu bulamaz. ISO metin + açık cast ile geçirilir.
  const weekAgoIso = weekAgo.toISOString();

  const [totals] = await db
    .select({
      activeAds: sql<number>`count(*) filter (where ads.is_active)::int`,
      newThisWeek: sql<number>`count(*) filter (where ads.first_seen_at >= ${weekAgoIso}::timestamptz)::int`,
      totalAds: sql<number>`count(*)::int`,
    })
    .from(ads);

  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(competitors)
    .where(eq(competitors.matchStatus, "unverified"));

  const [failed] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scrapeRuns)
    .where(and(eq(scrapeRuns.status, "failed"), gte(scrapeRuns.startedAt, weekAgo)));

  const [cost] = await db
    .select({
      total: sql<string | null>`sum(${scrapeRuns.costUsd})`,
    })
    .from(scrapeRuns)
    .where(gte(scrapeRuns.startedAt, weekAgo));

  return {
    activeAds: totals?.activeAds ?? 0,
    newThisWeek: totals?.newThisWeek ?? 0,
    totalAds: totals?.totalAds ?? 0,
    pendingMatch: pending?.count ?? 0,
    failedRunsThisWeek: failed?.count ?? 0,
    costThisWeek: cost?.total ?? null,
  };
}

export async function listDealers(brandId: number) {
  return db
    .select({
      id: dealers.id,
      name: dealers.name,
      city: dealers.city,
      address: dealers.address,
      isActive: dealers.isActive,
      competitorCount: sql<number>`(
        select count(*)::int from competitors c where c.dealer_id = dealers.id
      )`,
      matchedCount: sql<number>`(
        select count(*)::int from competitors c
        where c.dealer_id = dealers.id and c.match_status = 'matched'
      )`,
    })
    .from(dealers)
    .where(eq(dealers.brandId, brandId))
    .orderBy(asc(dealers.name));
}

export type CompetitorFilters = {
  city?: string;
  matchStatus?: MatchStatus;
  onlyWithActiveAds?: boolean;
  search?: string;
};

export async function listCompetitors(
  brandId: number,
  filters: CompetitorFilters = {},
) {
  const conditions = [eq(dealers.brandId, brandId)];
  if (filters.city) conditions.push(eq(dealers.city, filters.city));
  if (filters.matchStatus)
    conditions.push(eq(competitors.matchStatus, filters.matchStatus));
  if (filters.search) {
    const term = `%${filters.search}%`;
    const searchCondition = or(
      ilike(competitors.name, term),
      ilike(competitors.instagramHandle, term),
      ilike(dealers.name, term),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const rows = await db
    .select({
      id: competitors.id,
      name: competitors.name,
      instagramHandle: competitors.instagramHandle,
      fbPageId: competitors.fbPageId,
      fbPageName: competitors.fbPageName,
      matchStatus: competitors.matchStatus,
      isActive: competitors.isActive,
      matchedAt: competitors.matchedAt,
      matchedBy: competitors.matchedBy,
      dealerId: dealers.id,
      dealerName: dealers.name,
      dealerCity: dealers.city,
      activeAds: sql<number>`(
        select count(*)::int from ads a
        where a.competitor_id = competitors.id and a.is_active = true
      )`,
      lastSeenAt: sql<Date | null>`(
        select max(a.last_seen_at) from ads a
        where a.competitor_id = competitors.id
      )`,
    })
    .from(competitors)
    .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
    .where(and(...conditions))
    .orderBy(asc(dealers.name), asc(competitors.name));

  return filters.onlyWithActiveAds
    ? rows.filter((row) => row.activeAds > 0)
    : rows;
}

export async function listCities(brandId: number) {
  const rows = await db
    .selectDistinct({ city: dealers.city })
    .from(dealers)
    .where(eq(dealers.brandId, brandId))
    .orderBy(asc(dealers.city));
  return rows.map((r) => r.city).filter((c): c is string => Boolean(c));
}

export type AdFilters = {
  brandId?: number;
  city?: string;
  since?: Date;
  onlyActive?: boolean;
  adArchiveId?: string;
  search?: string;
};

export async function listAds(filters: AdFilters = {}, limit = 120) {
  const conditions = [];
  if (filters.brandId) conditions.push(eq(dealers.brandId, filters.brandId));
  if (filters.city) conditions.push(eq(dealers.city, filters.city));
  if (filters.since) conditions.push(gte(ads.firstSeenAt, filters.since));
  if (filters.onlyActive) conditions.push(eq(ads.isActive, true));
  if (filters.adArchiveId)
    conditions.push(eq(ads.adArchiveId, filters.adArchiveId));
  if (filters.search) {
    const term = `%${filters.search}%`;
    const searchCondition = or(
      ilike(competitors.name, term),
      ilike(ads.creativeText, term),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  return db
    .select({
      adArchiveId: ads.adArchiveId,
      creativeText: ads.creativeText,
      creativeTitle: ads.creativeTitle,
      imageUrl: ads.imageUrl,
      landingUrl: ads.landingUrl,
      platforms: ads.platforms,
      startedAt: ads.startedAt,
      firstSeenAt: ads.firstSeenAt,
      lastSeenAt: ads.lastSeenAt,
      isActive: ads.isActive,
      stoppedAt: ads.stoppedAt,
      competitorId: competitors.id,
      competitorName: competitors.name,
      instagramHandle: competitors.instagramHandle,
      fbPageId: competitors.fbPageId,
      dealerName: dealers.name,
      dealerCity: dealers.city,
      brandId: brands.id,
      brandName: brands.name,
      notified: sql<boolean>`exists (
        select 1 from notifications n
        where n.ad_archive_id = ads.ad_archive_id and n.type = 'new_ad'
      )`,
    })
    .from(ads)
    .innerJoin(competitors, eq(ads.competitorId, competitors.id))
    .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
    .innerJoin(brands, eq(dealers.brandId, brands.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(ads.firstSeenAt))
    .limit(limit);
}

export async function listAllCities() {
  const rows = await db
    .selectDistinct({ city: dealers.city })
    .from(dealers)
    .orderBy(asc(dealers.city));
  return rows.map((r) => r.city).filter((c): c is string => Boolean(c));
}

export async function listRuns(limit = 60) {
  return db
    .select({
      id: scrapeRuns.id,
      brandId: scrapeRuns.brandId,
      brandName: brands.name,
      status: scrapeRuns.status,
      adsFound: scrapeRuns.adsFound,
      newAds: scrapeRuns.newAds,
      stoppedAds: scrapeRuns.stoppedAds,
      competitorsScanned: scrapeRuns.competitorsScanned,
      costUsd: scrapeRuns.costUsd,
      error: scrapeRuns.error,
      actorId: scrapeRuns.actorId,
      apifyRunId: scrapeRuns.apifyRunId,
      startedAt: scrapeRuns.startedAt,
      finishedAt: scrapeRuns.finishedAt,
    })
    .from(scrapeRuns)
    .innerJoin(brands, eq(scrapeRuns.brandId, brands.id))
    .orderBy(desc(scrapeRuns.startedAt), desc(scrapeRuns.id))
    .limit(limit);
}

/** Eşleştirme ekranı: onay bekleyen rakipler. */
export async function listMatchingQueue(brandId: number) {
  return db
    .select({
      id: competitors.id,
      name: competitors.name,
      instagramHandle: competitors.instagramHandle,
      fbPageId: competitors.fbPageId,
      fbPageName: competitors.fbPageName,
      matchStatus: competitors.matchStatus,
      dealerName: dealers.name,
      dealerCity: dealers.city,
    })
    .from(competitors)
    .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
    .where(
      and(
        eq(dealers.brandId, brandId),
        inArray(competitors.matchStatus, ["unverified", "no_page"]),
      ),
    )
    .orderBy(asc(dealers.name), asc(competitors.name));
}

export async function matchingCounts(brandId: number) {
  const rows = await db
    .select({
      matchStatus: competitors.matchStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(competitors)
    .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
    .where(eq(dealers.brandId, brandId))
    .groupBy(competitors.matchStatus);

  const counts: Record<MatchStatus, number> = {
    unverified: 0,
    matched: 0,
    no_page: 0,
    ignored: 0,
  };
  for (const row of rows) counts[row.matchStatus] = row.count;
  return counts;
}
