import { describe, expect, it } from "vitest";
import { checkScanSanity, diffAds, type ExistingAd, type ScrapedAd } from "@/lib/diff";
import type { NormalizedAd } from "@/lib/normalize";

function scraped(
  adArchiveId: string,
  competitorId: number,
  overrides: Partial<NormalizedAd> = {},
): ScrapedAd {
  return {
    adArchiveId,
    competitorId,
    pageId: `page-${competitorId}`,
    pageName: null,
    creativeText: "Yaz indirimi başladı!",
    creativeTitle: null,
    imageUrl: "https://scontent.xx.fbcdn.net/x.jpg",
    videoUrl: null,
    landingUrl: null,
    platforms: ["instagram", "facebook"],
    startedAt: new Date("2026-07-26T00:00:00Z"),
    isActiveOnMeta: true,
    raw: {},
    ...overrides,
  };
}

function existing(
  adArchiveId: string,
  competitorId: number,
  isActive = true,
): ExistingAd {
  return { adArchiveId, competitorId, isActive };
}

describe("fark analizi", () => {
  it("DB'de olmayan reklamı yeni sayar", () => {
    const result = diffAds({
      existingAds: [],
      scraped: [scraped("A1", 1)],
      scannedCompetitorIds: [1],
    });
    expect(result.newAds.map((a) => a.adArchiveId)).toEqual(["A1"]);
    expect(result.unchangedAds).toHaveLength(0);
    expect(result.stoppedAdIds).toHaveLength(0);
  });

  it("ikisinde de olan reklam için bildirim üretmez (AC-06)", () => {
    const result = diffAds({
      existingAds: [existing("A1", 1)],
      scraped: [scraped("A1", 1)],
      scannedCompetitorIds: [1],
    });
    expect(result.newAds).toHaveLength(0);
    expect(result.unchangedAds.map((a) => a.adArchiveId)).toEqual(["A1"]);
    expect(result.stoppedAdIds).toHaveLength(0);
  });

  it("aktifken görünmeyen reklamı duran sayar", () => {
    const result = diffAds({
      existingAds: [existing("A1", 1), existing("A2", 1)],
      scraped: [scraped("A1", 1)],
      scannedCompetitorIds: [1],
    });
    expect(result.stoppedAdIds).toEqual(["A2"]);
  });

  it("pasif reklam yeniden görünürse reactivated olur, yeni sayılmaz", () => {
    const result = diffAds({
      existingAds: [existing("A1", 1, false)],
      scraped: [scraped("A1", 1)],
      scannedCompetitorIds: [1],
    });
    expect(result.newAds).toHaveLength(0);
    expect(result.reactivatedAds.map((a) => a.adArchiveId)).toEqual(["A1"]);
  });

  it("BAŞARISIZ taranan rakibin reklamlarını durdurmaz", () => {
    // Rakip 2 için Apify hata verdi: scannedCompetitorIds'e girmedi.
    const result = diffAds({
      existingAds: [existing("A1", 1), existing("B1", 2)],
      scraped: [scraped("A1", 1)],
      scannedCompetitorIds: [1],
    });
    expect(result.stoppedAdIds).toEqual([]);
  });

  it("aktif reklam sayısını rakip bazında hesaplar", () => {
    const result = diffAds({
      existingAds: [
        existing("A1", 1),
        existing("A2", 1),
        existing("A3", 1),
        existing("B1", 2),
      ],
      scraped: [scraped("A1", 1), scraped("A2", 1), scraped("A4", 1)],
      scannedCompetitorIds: [1],
    });
    // Rakip 1: A1, A2 (görüldü) + A4 (yeni) = 3; A3 durdu.
    expect(result.activeCountByCompetitor[1]).toBe(3);
    expect(result.stoppedAdIds).toEqual(["A3"]);
    // Rakip 2 taranmadı: B1 hâlâ aktif sayılır.
    expect(result.activeCountByCompetitor[2]).toBe(1);
  });

  it("aynı reklam iki kez gelse bile tek kez sayılır", () => {
    const result = diffAds({
      existingAds: [],
      scraped: [scraped("A1", 1), scraped("A1", 1)],
      scannedCompetitorIds: [1],
    });
    // normalizeDataset teklemeyi yapar; diff yine de iki kayıt görürse
    // ikisi de "yeni" listesine girer — bu yüzden tekleme normalize'da olmalı.
    expect(result.newAds).toHaveLength(2);
    expect(new Set(result.newAds.map((a) => a.adArchiveId)).size).toBe(1);
  });
});

describe("sıfır sonuç = arıza varsayımı (AC-07)", () => {
  it("rakip tarandı ama hiç reklam gelmediyse başarısız sayar", () => {
    const sanity = checkScanSanity({
      competitorsRequested: 12,
      competitorsScannedOk: 12,
      adsFound: 0,
    });
    expect(sanity.ok).toBe(false);
    if (!sanity.ok) expect(sanity.reason).toContain("Sıfır sonuç");
  });

  it("hiç eşleştirilmiş rakip yoksa başarısız sayar", () => {
    const sanity = checkScanSanity({
      competitorsRequested: 0,
      competitorsScannedOk: 0,
      adsFound: 0,
    });
    expect(sanity.ok).toBe(false);
    if (!sanity.ok) expect(sanity.reason).toContain("matched");
  });

  it("tüm Apify çalıştırmaları başarısızsa başarısız sayar", () => {
    const sanity = checkScanSanity({
      competitorsRequested: 5,
      competitorsScannedOk: 0,
      adsFound: 0,
    });
    expect(sanity.ok).toBe(false);
    if (!sanity.ok) expect(sanity.reason).toContain("Apify");
  });

  it("en az bir reklam geldiyse sağlıklı sayar", () => {
    expect(
      checkScanSanity({
        competitorsRequested: 5,
        competitorsScannedOk: 5,
        adsFound: 1,
      }).ok,
    ).toBe(true);
  });
});
