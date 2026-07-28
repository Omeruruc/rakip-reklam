import type { NormalizedAd } from "./normalize";

/**
 * Fark analizi — sistemin kalbi (MVP özeti §7).
 *
 *  - DB'de olmayan ad_archive_id      -> yeni reklam  -> anlık bildirim
 *  - DB'de aktif, taramada yok        -> duran reklam -> haftalık özet
 *  - İkisinde de var                  -> yalnızca last_seen_at -> bildirim YOK
 *
 * İki değişmez kural:
 *  1. "Hâlâ aktif" bildirimi asla üretilmez.
 *  2. Sıfır sonuç arıza sayılır: hiçbir reklam pasife alınmaz.
 *
 * Ek koruma: yalnızca BAŞARIYLA taranan rakiplerin reklamları durdurulabilir.
 * Bir rakip için Apify hata verdiyse o rakibin reklamlarına dokunulmaz —
 * aksi halde geçici bir hata "tüm reklamlar durdu" bildirimine dönüşürdü.
 */

export type ExistingAd = {
  adArchiveId: string;
  competitorId: number;
  isActive: boolean;
};

export type ScrapedAd = NormalizedAd & { competitorId: number };

export type DiffResult = {
  /** DB'de hiç olmayan reklamlar — bildirim gider. */
  newAds: ScrapedAd[];
  /** DB'de aktif olarak duran ve yine görülen reklamlar — sadece last_seen_at. */
  unchangedAds: ScrapedAd[];
  /** Daha önce durdurulmuş ama yeniden görünen reklamlar. */
  reactivatedAds: ScrapedAd[];
  /** Aktifken taramada görünmeyen reklamlar — pasife alınır, haftalık özete girer. */
  stoppedAdIds: string[];
  /** Rakip başına tarama sonrası aktif reklam sayısı (Slack mesajı için). */
  activeCountByCompetitor: Record<number, number>;
};

export function diffAds(input: {
  existingAds: ExistingAd[];
  scraped: ScrapedAd[];
  /** Apify çalıştırması başarılı olan rakip kimlikleri. */
  scannedCompetitorIds: number[];
}): DiffResult {
  const { existingAds, scraped } = input;
  const scannedSet = new Set(input.scannedCompetitorIds);

  const existingById = new Map(existingAds.map((ad) => [ad.adArchiveId, ad]));
  const scrapedIds = new Set(scraped.map((ad) => ad.adArchiveId));

  const newAds: ScrapedAd[] = [];
  const unchangedAds: ScrapedAd[] = [];
  const reactivatedAds: ScrapedAd[] = [];

  for (const ad of scraped) {
    const existing = existingById.get(ad.adArchiveId);
    if (!existing) {
      newAds.push(ad);
    } else if (existing.isActive) {
      unchangedAds.push(ad);
    } else {
      reactivatedAds.push(ad);
    }
  }

  const stoppedAdIds = existingAds
    .filter(
      (ad) =>
        ad.isActive &&
        scannedSet.has(ad.competitorId) &&
        !scrapedIds.has(ad.adArchiveId),
    )
    .map((ad) => ad.adArchiveId);

  // Tarama sonrası aktif sayı: görülenler + taranmayan/başarısız rakiplerin
  // dokunulmamış aktif reklamları.
  const activeCountByCompetitor: Record<number, number> = {};
  const stoppedSet = new Set(stoppedAdIds);
  for (const ad of scraped) {
    activeCountByCompetitor[ad.competitorId] =
      (activeCountByCompetitor[ad.competitorId] ?? 0) + 1;
  }
  for (const ad of existingAds) {
    if (!ad.isActive) continue;
    if (stoppedSet.has(ad.adArchiveId)) continue;
    if (scrapedIds.has(ad.adArchiveId)) continue; // yukarıda sayıldı
    activeCountByCompetitor[ad.competitorId] =
      (activeCountByCompetitor[ad.competitorId] ?? 0) + 1;
  }

  return {
    newAds,
    unchangedAds,
    reactivatedAds,
    stoppedAdIds,
    activeCountByCompetitor,
  };
}

export type ScanSanity =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * KURAL 2 — Sıfır sonuç = arıza varsayımı (AC-07).
 *
 * Taranacak rakip vardı ama hiç reklam gelmediyse bu "hiçbir rakip reklam
 * vermiyor" değil, "scraper bozuldu" demektir. Çağıran taraf bu durumda
 * hiçbir reklamı pasife almaz, bildirim göndermez, taramayı failed işaretler
 * ve teknik alarm kanalına yazar.
 */
export function checkScanSanity(input: {
  competitorsRequested: number;
  competitorsScannedOk: number;
  adsFound: number;
}): ScanSanity {
  const { competitorsRequested, competitorsScannedOk, adsFound } = input;

  if (competitorsRequested === 0) {
    return {
      ok: false,
      reason:
        "Taranacak eşleştirilmiş (matched) rakip yok. Page eşleştirme ekranını kontrol edin.",
    };
  }
  if (competitorsScannedOk === 0) {
    return {
      ok: false,
      reason:
        "Hiçbir rakip için Apify çalıştırması başarılı olmadı. Actor veya token hatası olabilir.",
    };
  }
  if (adsFound === 0) {
    return {
      ok: false,
      reason:
        `${competitorsRequested} rakip tarandı, hiç reklam kaydı dönmedi. ` +
        "Sıfır sonuç arıza varsayılır: veri değiştirilmedi, bildirim gönderilmedi.",
    };
  }
  return { ok: true };
}
