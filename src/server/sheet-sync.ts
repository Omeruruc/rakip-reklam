import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ads, competitors, dealers, sheetSyncs } from "@/db/schema";

/**
 * Google Sheets senkronunun veritabanı tarafı.
 *
 * `notifications` ile AYNI "claim önce, yaz sonra" deseni kullanılır ama
 * ayrı bir tabloda tutulur: Slack bildirimi ile Sheets satırı farklı
 * hedeflere gider, biri başarısız olsa diğerini etkilememelidir.
 */

export type SheetSyncContext = {
  adArchiveId: string;
  competitorName: string;
  dealerName: string;
  dealerCity: string | null;
  instagramHandle: string | null;
  fbPageId: string | null;
  startedAt: Date | null;
  firstSeenAt: Date;
};

export async function loadSheetSyncContext(
  adArchiveId: string,
): Promise<SheetSyncContext | null> {
  const [row] = await db
    .select({
      adArchiveId: ads.adArchiveId,
      startedAt: ads.startedAt,
      firstSeenAt: ads.firstSeenAt,
      competitorName: competitors.name,
      instagramHandle: competitors.instagramHandle,
      fbPageId: competitors.fbPageId,
      dealerName: dealers.name,
      dealerCity: dealers.city,
    })
    .from(ads)
    .innerJoin(competitors, eq(ads.competitorId, competitors.id))
    .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
    .where(eq(ads.adArchiveId, adArchiveId))
    .limit(1);

  return row ?? null;
}

/**
 * Bildirimi "sahiplenir": satırı Sheets'e YAZMADAN ÖNCE ekler.
 * UNIQUE (ad_archive_id) sayesinde ikinci deneme çakışır ve false döner —
 * aynı reklam için mükerrer satır imkânsız.
 */
export async function claimSheetSync(adArchiveId: string): Promise<boolean> {
  const inserted = await db
    .insert(sheetSyncs)
    .values({ adArchiveId })
    .onConflictDoNothing({ target: sheetSyncs.adArchiveId })
    .returning({ id: sheetSyncs.id });
  return inserted.length > 0;
}

export async function markSheetSyncDone(adArchiveId: string): Promise<void> {
  await db
    .update(sheetSyncs)
    .set({ syncedAt: new Date(), error: null })
    .where(eq(sheetSyncs.adArchiveId, adArchiveId));
}

/**
 * Sheets kalıcı olarak reddederse sahiplenmeyi geri alır ki satır sonsuza
 * dek eklenmemiş kalmasın (sonraki taramada yeniden denenir).
 */
export async function releaseSheetSync(
  adArchiveId: string,
  error: string,
): Promise<void> {
  await db.delete(sheetSyncs).where(eq(sheetSyncs.adArchiveId, adArchiveId));
  console.error(
    `[sheet-sync] Sheets satırı eklenemedi, sahiplenme geri alındı: ${adArchiveId} — ${error}`,
  );
}
