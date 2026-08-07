import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ads, competitors, dealers } from "@/db/schema";
import { appendCompetitorAdRows, buildSheetRow, sheetsConfigured, SheetRow } from "@/lib/sheets";
import { claimSheetSync, markSheetSyncDone, releaseSheetSync } from "@/server/sheet-sync";

const CHUNK_SIZE = 50;

/**
 * Tek seferlik: Sheets kurulumu tamamlandığında ondan ÖNCE bulunmuş olan
 * tüm reklamları (aktif + durdurulmuş) da tabloya ekler. Yeni reklamlar zaten `sync-sheet-row`
 * Inngest fonksiyonuyla otomatik eklenir — bu script yalnızca geçmişi
 * doldurur. Aynı claim deseni sayesinde tekrar çalıştırılırsa zaten
 * eklenmiş satırlar atlanır (idempotent).
 *
 * Satırlar KÜÇÜK PARÇALAR hâlinde tek API çağrısıyla eklenir (bkz.
 * `appendCompetitorAdRows`) — Sheets API'nin dakikalık kotasını aşmamak için.
 */
async function main() {
  if (!sheetsConfigured()) {
    console.error("Google Sheets ortam değişkenleri eksik, iptal edildi.");
    process.exit(1);
  }

  const rows = await db
    .select({
      adArchiveId: ads.adArchiveId,
      startedAt: ads.startedAt,
      firstSeenAt: ads.firstSeenAt,
      isActive: ads.isActive,
      competitorName: competitors.name,
      instagramHandle: competitors.instagramHandle,
      fbPageId: competitors.fbPageId,
      dealerName: dealers.name,
      dealerCity: dealers.city,
    })
    .from(ads)
    .innerJoin(competitors, eq(ads.competitorId, competitors.id))
    .innerJoin(dealers, eq(competitors.dealerId, dealers.id));

  console.log(`${rows.length} reklam bulundu (aktif + durdurulmuş).`);

  let added = 0;
  let skipped = 0;
  let failed = 0;

  const claimedRows: { adArchiveId: string; row: SheetRow }[] = [];

  for (const row of rows) {
    const claimed = await claimSheetSync(row.adArchiveId);
    if (!claimed) {
      skipped++;
      continue;
    }
    claimedRows.push({
      adArchiveId: row.adArchiveId,
      row: buildSheetRow({
        competitorName: row.competitorName,
        dealerName: row.dealerName,
        dealerCity: row.dealerCity,
        instagramHandle: row.instagramHandle,
        fbPageId: row.fbPageId,
        adArchiveId: row.adArchiveId,
        adDate: new Date(row.startedAt ?? row.firstSeenAt),
        isActive: row.isActive,
      }),
    });
  }

  console.log(
    `${claimedRows.length} yeni satır eklenecek (${skipped} zaten senkronize).`,
  );

  for (let i = 0; i < claimedRows.length; i += CHUNK_SIZE) {
    const chunk = claimedRows.slice(i, i + CHUNK_SIZE);
    try {
      await appendCompetitorAdRows(chunk.map((c) => c.row));
      for (const c of chunk) {
        await markSheetSyncDone(c.adArchiveId);
      }
      added += chunk.length;
      console.log(`+ ${chunk.length} satır eklendi (${added}/${claimedRows.length})`);
    } catch (error) {
      failed += chunk.length;
      const message = error instanceof Error ? error.message : String(error);
      for (const c of chunk) {
        await releaseSheetSync(c.adArchiveId, message);
      }
      console.error(`! Parça eklenemedi (${chunk.length} satır):`, message);
    }

    // Ardışık parçalar arasında kısa bekleme — dakikalık kotayı zorlamamak için.
    if (i + CHUNK_SIZE < claimedRows.length) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  console.log(
    `\nBitti — eklendi: ${added}, zaten vardı: ${skipped}, başarısız: ${failed}`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main();
