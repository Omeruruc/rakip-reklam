import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ads,
  brands,
  competitors,
  dealers,
  notifications,
  scrapeRuns,
} from "@/db/schema";
import { checkScanSanity, diffAds, type ScrapedAd } from "@/lib/diff";
import { fieldCoverage, normalizeDataset } from "@/lib/normalize";

/**
 * Tarama akışının veritabanı tarafı. Inngest fonksiyonları yalnızca bu
 * fonksiyonları sırayla çağırır — iş kuralları tek yerde toplanır.
 */

export type ScanTarget = {
  competitorId: number;
  competitorName: string;
  instagramHandle: string | null;
  fbPageId: string;
  dealerName: string;
  dealerCity: string | null;
};

export type ScanTargets = {
  brandId: number;
  brandName: string;
  targets: ScanTarget[];
  /** Eşleştirme bekleyen rakip sayısı — taranmaz, panoda uyarı olarak görünür. */
  pendingMatch: number;
};

/** Yalnızca matched + Page ID'si olan rakipler taranır (AC-04). */
export async function loadScanTargets(brandId: number): Promise<ScanTargets> {
  const [brand] = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!brand) throw new Error(`Marka bulunamadı: ${brandId}`);

  const rows = await db
    .select({
      competitorId: competitors.id,
      competitorName: competitors.name,
      instagramHandle: competitors.instagramHandle,
      fbPageId: competitors.fbPageId,
      dealerName: dealers.name,
      dealerCity: dealers.city,
    })
    .from(competitors)
    .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
    .where(
      and(
        eq(dealers.brandId, brandId),
        eq(competitors.matchStatus, "matched"),
        eq(competitors.isActive, true),
        eq(dealers.isActive, true),
        isNotNull(competitors.fbPageId),
      ),
    );

  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(competitors)
    .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
    .where(
      and(eq(dealers.brandId, brandId), eq(competitors.matchStatus, "unverified")),
    );

  return {
    brandId: brand.id,
    brandName: brand.name,
    targets: rows
      .filter((row): row is ScanTarget & { fbPageId: string } =>
        Boolean(row.fbPageId),
      )
      .map((row) => ({ ...row, fbPageId: row.fbPageId })),
    pendingMatch: pending?.count ?? 0,
  };
}

export async function createRun(
  brandId: number,
  actorId: string | null,
): Promise<number> {
  const [run] = await db
    .insert(scrapeRuns)
    .values({ brandId, status: "running", actorId })
    .returning({ id: scrapeRuns.id });
  return run.id;
}

export async function attachApifyRun(
  runId: number,
  apifyRunId: string,
): Promise<void> {
  await db
    .update(scrapeRuns)
    .set({ apifyRunId })
    .where(eq(scrapeRuns.id, runId));
}

export async function failRun(
  runId: number,
  error: string,
  extra: { adsFound?: number; costUsd?: number | null } = {},
): Promise<void> {
  await db
    .update(scrapeRuns)
    .set({
      status: "failed",
      error: error.slice(0, 2000),
      finishedAt: new Date(),
      ...(extra.adsFound !== undefined ? { adsFound: extra.adsFound } : {}),
      ...(extra.costUsd !== undefined && extra.costUsd !== null
        ? { costUsd: String(extra.costUsd) }
        : {}),
    })
    .where(eq(scrapeRuns.id, runId));
}

export type ApplyResult = {
  ok: boolean;
  reason?: string;
  adsFound: number;
  newAdIds: string[];
  reactivatedAdIds: string[];
  stoppedAdIds: string[];
  stoppedCount: number;
  unchangedCount: number;
  /** pageId'si hiçbir rakibe denk gelmeyen kayıt sayısı. */
  unattributed: number;
  competitorsScanned: number;
  coverage: Record<string, number>;
};

/**
 * Apify çıktısını normalize eder, fark analizini yapar ve TEK transaction
 * içinde uygular.
 *
 * Sıfır sonuç (ya da hiç başarılı rakip) durumunda hiçbir yazma yapılmaz;
 * çağıran taraf taramayı failed işaretler ve teknik alarm gönderir (AC-07).
 */
export async function applyScanResults(input: {
  brandId: number;
  runId: number;
  items: unknown[];
  targets: ScanTarget[];
  /** Apify çalıştırması başarılı olan Page ID'ler. */
  scannedPageIds: string[];
  costUsd: number | null;
}): Promise<ApplyResult> {
  const { runId, items, targets, scannedPageIds } = input;

  const { ads: normalized } = normalizeDataset(items);
  const coverage = fieldCoverage(normalized);

  const byPageId = new Map(targets.map((t) => [t.fbPageId, t]));
  const scannedSet = new Set(scannedPageIds);
  const scannedTargets = targets.filter((t) => scannedSet.has(t.fbPageId));

  const scraped: ScrapedAd[] = [];
  let unattributed = 0;

  for (const ad of normalized) {
    let target = ad.pageId ? byPageId.get(ad.pageId) : undefined;
    // Actor page_id döndürmüyorsa ve tek sayfa tarandıysa atama tektir.
    if (!target && !ad.pageId && scannedTargets.length === 1) {
      target = scannedTargets[0];
    }
    if (!target) {
      unattributed++;
      continue;
    }
    scraped.push({ ...ad, competitorId: target.competitorId });
  }

  const sanity = checkScanSanity({
    competitorsRequested: targets.length,
    competitorsScannedOk: scannedTargets.length,
    adsFound: scraped.length,
  });

  if (!sanity.ok) {
    return {
      ok: false,
      reason:
        unattributed > 0
          ? `${sanity.reason} (${unattributed} kayıt hiçbir Page ID'ye atanamadı — actor page_id döndürmüyor olabilir.)`
          : sanity.reason,
      adsFound: 0,
      newAdIds: [],
      reactivatedAdIds: [],
      stoppedAdIds: [],
      stoppedCount: 0,
      unchangedCount: 0,
      unattributed,
      competitorsScanned: scannedTargets.length,
      coverage,
    };
  }

  const competitorIds = targets.map((t) => t.competitorId);
  const existingAds =
    competitorIds.length > 0
      ? await db
          .select({
            adArchiveId: ads.adArchiveId,
            competitorId: ads.competitorId,
            isActive: ads.isActive,
          })
          .from(ads)
          .where(inArray(ads.competitorId, competitorIds))
      : [];

  const diff = diffAds({
    existingAds,
    scraped,
    scannedCompetitorIds: scannedTargets.map((t) => t.competitorId),
  });

  const now = new Date();

  await db.transaction(async (tx) => {
    const seen = [...diff.newAds, ...diff.unchangedAds, ...diff.reactivatedAds];

    for (const ad of seen) {
      await tx
        .insert(ads)
        .values({
          adArchiveId: ad.adArchiveId,
          competitorId: ad.competitorId,
          creativeText: ad.creativeText,
          creativeTitle: ad.creativeTitle,
          imageUrl: ad.imageUrl,
          videoUrl: ad.videoUrl,
          landingUrl: ad.landingUrl,
          platforms: ad.platforms,
          startedAt: ad.startedAt,
          firstSeenAt: now,
          lastSeenAt: now,
          isActive: true,
          stoppedAt: null,
          raw: JSON.stringify(ad.raw).slice(0, 20_000),
        })
        .onConflictDoUpdate({
          target: ads.adArchiveId,
          set: {
            lastSeenAt: now,
            isActive: true,
            stoppedAt: null,
            // Kreatif güncellenir ama actor boş döndürdüyse mevcut değer ezilmez.
            creativeText: sql`coalesce(excluded.creative_text, ${ads.creativeText})`,
            creativeTitle: sql`coalesce(excluded.creative_title, ${ads.creativeTitle})`,
            imageUrl: sql`coalesce(excluded.image_url, ${ads.imageUrl})`,
            videoUrl: sql`coalesce(excluded.video_url, ${ads.videoUrl})`,
            landingUrl: sql`coalesce(excluded.landing_url, ${ads.landingUrl})`,
            startedAt: sql`coalesce(excluded.started_at, ${ads.startedAt})`,
            // first_seen_at ilk görülme anıdır; asla güncellenmez.
          },
        });
    }

    if (diff.stoppedAdIds.length > 0) {
      await tx
        .update(ads)
        .set({ isActive: false, stoppedAt: now })
        .where(inArray(ads.adArchiveId, diff.stoppedAdIds));
    }

    await tx
      .update(scrapeRuns)
      .set({
        status: "completed",
        adsFound: scraped.length,
        newAds: diff.newAds.length,
        stoppedAds: diff.stoppedAdIds.length,
        competitorsScanned: scannedTargets.length,
        costUsd: input.costUsd !== null ? String(input.costUsd) : null,
        finishedAt: new Date(),
      })
      .where(eq(scrapeRuns.id, runId));
  });

  return {
    ok: true,
    adsFound: scraped.length,
    newAdIds: diff.newAds.map((ad) => ad.adArchiveId),
    reactivatedAdIds: diff.reactivatedAds.map((ad) => ad.adArchiveId),
    stoppedAdIds: diff.stoppedAdIds,
    stoppedCount: diff.stoppedAdIds.length,
    unchangedCount: diff.unchangedAds.length,
    unattributed,
    competitorsScanned: scannedTargets.length,
    coverage,
  };
}

/* -------------------------------------------------------------------------- */
/* Bildirim tarafı                                                             */
/* -------------------------------------------------------------------------- */

export type NotificationContext = {
  adArchiveId: string;
  brandName: string;
  dealerName: string;
  dealerCity: string | null;
  competitorName: string;
  instagramHandle: string | null;
  fbPageId: string | null;
  startedAt: Date | null;
  platforms: string[];
  creativeText: string | null;
  creativeTitle: string | null;
  imageUrl: string | null;
  activeAdCount: number;
};

export async function loadNotificationContext(
  adArchiveId: string,
): Promise<NotificationContext | null> {
  const [row] = await db
    .select({
      adArchiveId: ads.adArchiveId,
      competitorId: ads.competitorId,
      startedAt: ads.startedAt,
      platforms: ads.platforms,
      creativeText: ads.creativeText,
      creativeTitle: ads.creativeTitle,
      imageUrl: ads.imageUrl,
      competitorName: competitors.name,
      instagramHandle: competitors.instagramHandle,
      fbPageId: competitors.fbPageId,
      dealerName: dealers.name,
      dealerCity: dealers.city,
      brandName: brands.name,
    })
    .from(ads)
    .innerJoin(competitors, eq(ads.competitorId, competitors.id))
    .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
    .innerJoin(brands, eq(dealers.brandId, brands.id))
    .where(eq(ads.adArchiveId, adArchiveId))
    .limit(1);

  if (!row) return null;

  const [active] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ads)
    .where(and(eq(ads.competitorId, row.competitorId), eq(ads.isActive, true)));

  return { ...row, activeAdCount: active?.count ?? 0 };
}

/**
 * Bildirimi "sahiplenir": satırı Slack'e yazmadan ÖNCE ekler.
 * UNIQUE (ad_archive_id, type) sayesinde ikinci deneme çakışır ve false döner
 * — mükerrer bildirim imkânsız (AC-06, AC-08).
 */
export async function claimNotification(
  adArchiveId: string,
  type: "new_ad" | "stopped_ad",
): Promise<boolean> {
  const inserted = await db
    .insert(notifications)
    .values({ adArchiveId, type })
    .onConflictDoNothing({
      target: [notifications.adArchiveId, notifications.type],
    })
    .returning({ id: notifications.id });
  return inserted.length > 0;
}

/**
 * Toplu sahiplenme — ilk taramada yüzlerce yeni reklam bulunduğunda kanalı
 * tek mesajla bilgilendirmek için (bildirim gürültüsü önlemi, §10).
 * Sahiplenilen (yani daha önce bildirilmemiş) kimlikleri döndürür.
 */
export async function claimNotifications(
  adArchiveIds: string[],
  type: "new_ad" | "stopped_ad",
): Promise<string[]> {
  if (adArchiveIds.length === 0) return [];
  const inserted = await db
    .insert(notifications)
    .values(adArchiveIds.map((adArchiveId) => ({ adArchiveId, type })))
    .onConflictDoNothing({
      target: [notifications.adArchiveId, notifications.type],
    })
    .returning({ adArchiveId: notifications.adArchiveId });
  return inserted.map((row) => row.adArchiveId);
}

export async function markNotificationsSent(
  adArchiveIds: string[],
  type: "new_ad" | "stopped_ad",
): Promise<void> {
  if (adArchiveIds.length === 0) return;
  await db
    .update(notifications)
    .set({ sentAt: new Date() })
    .where(
      and(
        inArray(notifications.adArchiveId, adArchiveIds),
        eq(notifications.type, type),
      ),
    );
}

/** Toplu mesaj için rakip bazında kırılım. */
export async function loadBurstSummary(adArchiveIds: string[]): Promise<{
  competitorName: string;
  dealerName: string;
  dealerCity: string | null;
  count: number;
}[]> {
  if (adArchiveIds.length === 0) return [];
  const rows = await db
    .select({
      competitorName: competitors.name,
      dealerName: dealers.name,
      dealerCity: dealers.city,
      count: sql<number>`count(*)::int`,
    })
    .from(ads)
    .innerJoin(competitors, eq(ads.competitorId, competitors.id))
    .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
    .where(inArray(ads.adArchiveId, adArchiveIds))
    .groupBy(competitors.name, dealers.name, dealers.city)
    .orderBy(sql`count(*) desc`);
  return rows;
}

export async function markNotificationSent(
  adArchiveId: string,
  type: "new_ad" | "stopped_ad",
): Promise<void> {
  await db
    .update(notifications)
    .set({ sentAt: new Date(), error: null })
    .where(
      and(
        eq(notifications.adArchiveId, adArchiveId),
        eq(notifications.type, type),
      ),
    );
}

/**
 * Slack kalıcı olarak reddederse sahiplenmeyi geri alır ki bildirim
 * sonsuza dek kayıp olmasın (sonraki taramada yeniden denenir).
 */
export async function releaseNotification(
  adArchiveId: string,
  type: "new_ad" | "stopped_ad",
  error: string,
): Promise<void> {
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.adArchiveId, adArchiveId),
        eq(notifications.type, type),
      ),
    );
  console.error(
    `[notify] ${type} bildirimi gönderilemedi, sahiplenme geri alındı: ${adArchiveId} — ${error}`,
  );
}
