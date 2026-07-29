import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

vi.mock("@/db", async () => {
  const mod = await import("./helpers/test-db");
  return { db: mod.testDb, schema };
});

const { testDb, migrate, truncateAll } = await import("./helpers/test-db");
const queries = await import("@/server/queries");
const { recentNotifications } = await import("@/server/digest");

const { ads, brands, competitors, dealers, notifications, scrapeRuns } = schema;

/**
 * Arayüz sorgularının GERÇEK SQL ile denenmesi.
 *
 * Bu dosyanın varlık nedeni: ilişkili alt sorgularda kolon adları nitelenmezse
 * ("id" yerine "brands"."id") Postgres ya belirsizlik hatası verir ya da yanlış
 * sütunu okur. Tip denetimi bunu yakalamaz — yalnızca çalıştırmak yakalar.
 */

let brandA: number;
let brandB: number;
let dealerA1: number;
let matchedCompetitor: number;

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await truncateAll();

  const inserted = await testDb
    .insert(brands)
    .values([{ name: "İşbir Yatak" }, { name: "Diğer Marka", isActive: false }])
    .returning({ id: brands.id });
  brandA = inserted[0].id;
  brandB = inserted[1].id;

  const dealerRows = await testDb
    .insert(dealers)
    .values([
      { brandId: brandA, name: "İşbir Yatak Bandırma", city: "Balıkesir" },
      { brandId: brandA, name: "İşbir Yatak Bursa", city: "Bursa" },
      { brandId: brandB, name: "Diğer Bayi", city: "İzmir" },
    ])
    .returning({ id: dealers.id });
  dealerA1 = dealerRows[0].id;

  const competitorRows = await testDb
    .insert(competitors)
    .values([
      {
        dealerId: dealerA1,
        name: "Bandırma Lova Yatak",
        instagramHandle: "lovayatak.bandirma",
        fbPageId: "999",
        matchStatus: "matched",
      },
      {
        dealerId: dealerA1,
        name: "Puffy Bandırma",
        instagramHandle: "puffybandirma",
        matchStatus: "unverified",
      },
      {
        dealerId: dealerRows[1].id,
        name: "Yatsan Nilüfer",
        matchStatus: "no_page",
      },
      {
        dealerId: dealerRows[2].id,
        name: "Rakip B",
        fbPageId: "888",
        matchStatus: "matched",
      },
    ])
    .returning({ id: competitors.id });
  matchedCompetitor = competitorRows[0].id;

  const now = new Date();
  const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

  await testDb.insert(ads).values([
    {
      adArchiveId: "AD-ACTIVE-1",
      competitorId: matchedCompetitor,
      creativeText: "Yaz indirimi başladı",
      imageUrl: "https://x/1.jpg",
      platforms: ["instagram"],
      firstSeenAt: now,
      lastSeenAt: now,
      isActive: true,
    },
    {
      adArchiveId: "AD-ACTIVE-2",
      competitorId: matchedCompetitor,
      creativeText: "Kış kampanyası",
      platforms: ["facebook"],
      firstSeenAt: old,
      lastSeenAt: now,
      isActive: true,
    },
    {
      adArchiveId: "AD-STOPPED",
      competitorId: matchedCompetitor,
      creativeText: "Biten kampanya",
      firstSeenAt: old,
      lastSeenAt: old,
      isActive: false,
      stoppedAt: now,
    },
    {
      adArchiveId: "AD-BRAND-B",
      competitorId: competitorRows[3].id,
      creativeText: "Diğer marka reklamı",
      firstSeenAt: now,
      lastSeenAt: now,
      isActive: true,
    },
  ]);

  // AD-ACTIVE-1 bildirildi, AD-ACTIVE-2 bildirilmedi.
  await testDb
    .insert(notifications)
    .values({ adArchiveId: "AD-ACTIVE-1", type: "new_ad", sentAt: now });

  await testDb.insert(scrapeRuns).values([
    {
      brandId: brandA,
      status: "completed",
      adsFound: 3,
      newAds: 3,
      competitorsScanned: 1,
      costUsd: "0.0500",
      finishedAt: now,
      actorId: "test-actor",
    },
    {
      brandId: brandA,
      status: "failed",
      adsFound: 0,
      error: "Sıfır sonuç — scraper arızası varsayıldı",
      finishedAt: now,
      actorId: "test-actor",
    },
  ]);
});

describe("listBrands", () => {
  it("marka başına bayi/rakip/eşleşme/aktif reklam sayılarını doğru hesaplar", async () => {
    const rows = await queries.listBrands();
    const a = rows.find((r) => r.id === brandA)!;
    const b = rows.find((r) => r.id === brandB)!;

    expect(a.dealerCount).toBe(2);
    expect(a.competitorCount).toBe(3);
    expect(a.matchedCount).toBe(1);
    expect(a.pendingMatch).toBe(1);
    expect(a.activeAds).toBe(2);

    expect(b.dealerCount).toBe(1);
    expect(b.competitorCount).toBe(1);
    expect(b.activeAds).toBe(1);
    expect(b.isActive).toBe(false);
  });
});

describe("listDealers", () => {
  it("bayi başına rakip ve eşleşme sayılarını verir", async () => {
    const rows = await queries.listDealers(brandA);
    expect(rows).toHaveLength(2);
    const bandirma = rows.find((r) => r.name === "İşbir Yatak Bandırma")!;
    expect(bandirma.competitorCount).toBe(2);
    expect(bandirma.matchedCount).toBe(1);
    const bursa = rows.find((r) => r.name === "İşbir Yatak Bursa")!;
    expect(bursa.competitorCount).toBe(1);
    expect(bursa.matchedCount).toBe(0);
  });
});

describe("listCompetitors", () => {
  it("aktif reklam sayısı ve son görülme tarihini getirir", async () => {
    const rows = await queries.listCompetitors(brandA);
    expect(rows).toHaveLength(3);
    const lova = rows.find((r) => r.name === "Bandırma Lova Yatak")!;
    expect(lova.activeAds).toBe(2);
    expect(lova.lastSeenAt).not.toBeNull();
    const puffy = rows.find((r) => r.name === "Puffy Bandırma")!;
    expect(puffy.activeAds).toBe(0);
    expect(puffy.lastSeenAt).toBeNull();
  });

  it("il, eşleştirme durumu, aktif reklam ve arama filtreleri çalışır", async () => {
    expect(
      await queries.listCompetitors(brandA, { city: "Bursa" }),
    ).toHaveLength(1);
    expect(
      await queries.listCompetitors(brandA, { matchStatus: "matched" }),
    ).toHaveLength(1);
    expect(
      await queries.listCompetitors(brandA, { onlyWithActiveAds: true }),
    ).toHaveLength(1);
    expect(
      await queries.listCompetitors(brandA, { search: "puffy" }),
    ).toHaveLength(1);
    // Bayi adıyla da aranabilir.
    expect(
      await queries.listCompetitors(brandA, { search: "Bandırma" }),
    ).toHaveLength(2);
  });

  it("başka markanın rakiplerini karıştırmaz", async () => {
    const rows = await queries.listCompetitors(brandB);
    expect(rows.map((r) => r.name)).toEqual(["Rakip B"]);
  });
});

describe("listAds", () => {
  it("varsayılan olarak yalnızca aktif reklamları döndürür", async () => {
    const rows = await queries.listAds({ onlyActive: true });
    expect(rows.map((r) => r.adArchiveId).sort()).toEqual([
      "AD-ACTIVE-1",
      "AD-ACTIVE-2",
      "AD-BRAND-B",
    ]);
  });

  it("bildirim durumunu doğru raporlar", async () => {
    const rows = await queries.listAds();
    const notified = rows.find((r) => r.adArchiveId === "AD-ACTIVE-1")!;
    const notNotified = rows.find((r) => r.adArchiveId === "AD-ACTIVE-2")!;
    expect(notified.notified).toBe(true);
    expect(notNotified.notified).toBe(false);
  });

  it("marka, il, tarih, tek reklam ve metin filtreleri çalışır", async () => {
    expect(await queries.listAds({ brandId: brandA })).toHaveLength(3);
    expect(await queries.listAds({ city: "İzmir" })).toHaveLength(1);
    expect(
      await queries.listAds({
        since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      }),
    ).toHaveLength(2);
    expect(await queries.listAds({ adArchiveId: "AD-STOPPED" })).toHaveLength(1);
    expect(await queries.listAds({ search: "Yaz indirimi" })).toHaveLength(1);
  });

  it("marka, bayi ve rakip bilgisini birlikte getirir", async () => {
    const [row] = await queries.listAds({ adArchiveId: "AD-ACTIVE-1" });
    expect(row.brandName).toBe("İşbir Yatak");
    expect(row.dealerName).toBe("İşbir Yatak Bandırma");
    expect(row.competitorName).toBe("Bandırma Lova Yatak");
    expect(row.fbPageId).toBe("999");
  });
});

describe("sayfalama (listAds offset/limit + countAds)", () => {
  it("varsayılan çağrı sınırın altındaki veri için hepsini döndürür", async () => {
    // 4 reklam, varsayılan ADS_PAGE_SIZE'ın (30) çok altında.
    expect(await queries.listAds()).toHaveLength(4);
  });

  it("countAds toplam kaydı, filtreyle birlikte doğru sayar", async () => {
    expect(await queries.countAds()).toBe(4);
    expect(await queries.countAds({ onlyActive: true })).toBe(3);
    expect(await queries.countAds({ brandId: brandA })).toBe(3);
  });

  it("offset + limit sayfaları böler, kayıt ne eksik ne mükerrer olur", async () => {
    const page1 = await queries.listAds({}, { limit: 2, offset: 0 });
    const page2 = await queries.listAds({}, { limit: 2, offset: 2 });
    const page3 = await queries.listAds({}, { limit: 2, offset: 4 });

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page3).toHaveLength(0); // toplamın (4) ötesinde — boş, hata değil

    const ids1 = page1.map((r) => r.adArchiveId);
    const ids2 = page2.map((r) => r.adArchiveId);
    // İki sayfa arasında kesişim yok; birlikte tüm kayıtları kapsar.
    expect(ids1.filter((id) => ids2.includes(id))).toHaveLength(0);
    expect([...ids1, ...ids2].sort()).toEqual(
      (await queries.listAds()).map((r) => r.adArchiveId).sort(),
    );
  });

  it("sıralama kararlıdır — aynı firstSeenAt'te adArchiveId ile tekilleşir", async () => {
    // AD-ACTIVE-1 ve AD-BRAND-B aynı firstSeenAt'e sahip (fixture'da "now").
    // Kararlı ikincil sıralama olmadan sayfa sınırında kayıt kaybolabilir.
    const first = await queries.listAds({}, { limit: 4, offset: 0 });
    const second = await queries.listAds({}, { limit: 4, offset: 0 });
    expect(first.map((r) => r.adArchiveId)).toEqual(
      second.map((r) => r.adArchiveId),
    );
  });
});

describe("eşleştirme kuyruğu", () => {
  it("unverified ve no_page kayıtları listeler, matched olanları dışlar", async () => {
    const rows = await queries.listMatchingQueue(brandA);
    expect(rows.map((r) => r.name).sort()).toEqual([
      "Puffy Bandırma",
      "Yatsan Nilüfer",
    ]);
  });

  it("durum sayılarını verir", async () => {
    expect(await queries.matchingCounts(brandA)).toEqual({
      unverified: 1,
      matched: 1,
      no_page: 1,
      ignored: 0,
    });
  });
});

describe("pano ve tarama geçmişi", () => {
  it("pano istatistikleri", async () => {
    const stats = await queries.dashboardStats();
    expect(stats.activeAds).toBe(3);
    expect(stats.totalAds).toBe(4);
    expect(stats.newThisWeek).toBe(2);
    expect(stats.pendingMatch).toBe(1);
    expect(stats.failedRunsThisWeek).toBe(1);
    expect(Number(stats.costThisWeek)).toBeCloseTo(0.05);
  });

  it("marka başına son tarama", async () => {
    const latest = await queries.lastRunByBrand();
    expect(latest.get(brandA)?.status).toBe("failed");
    expect(latest.has(brandB)).toBe(false);
  });

  it("tarama geçmişi marka adıyla birlikte gelir", async () => {
    const rows = await queries.listRuns();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.brandName === "İşbir Yatak")).toBe(true);
    expect(rows.some((r) => r.error?.includes("Sıfır sonuç"))).toBe(true);
  });

  it("il listeleri boş şehirleri atar", async () => {
    expect(await queries.listCities(brandA)).toEqual(["Balıkesir", "Bursa"]);
    expect(await queries.listAllCities()).toEqual([
      "Balıkesir",
      "Bursa",
      "İzmir",
    ]);
  });

  it("son bildirimler marka/bayi/rakip bilgisiyle gelir", async () => {
    const rows = await recentNotifications(5);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "new_ad",
      brandName: "İşbir Yatak",
      dealerName: "İşbir Yatak Bandırma",
      competitorName: "Bandırma Lova Yatak",
    });
  });
});
