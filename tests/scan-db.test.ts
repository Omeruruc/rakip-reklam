import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";

vi.mock("@/db", async () => {
  const mod = await import("./helpers/test-db");
  return { db: mod.testDb, schema };
});

const { testDb, migrate, truncateAll } = await import("./helpers/test-db");
const {
  applyScanResults,
  claimNotification,
  claimNotifications,
  createRun,
  failRun,
  loadBurstSummary,
  loadNotificationContext,
  loadScanTargets,
  markNotificationSent,
} = await import("@/server/scan");
const { collectWeeklyDigest, markStoppedAdsReported } = await import(
  "@/server/digest"
);

const { ads, brands, competitors, dealers, notifications, scrapeRuns } = schema;

const PAGE_ID = "987654321098765";
const OTHER_PAGE_ID = "111111111111111";

/** Ad Library JSON'una benzeyen ham actor kaydı. */
function record(adArchiveId: string, pageId = PAGE_ID, overrides: object = {}) {
  return {
    ad_archive_id: adArchiveId,
    page_id: pageId,
    page_name: "Bandırma Lova Yatak",
    start_date: 1784160000,
    publisher_platform: ["INSTAGRAM", "FACEBOOK"],
    snapshot: {
      body: { text: "Yaz indirimi başladı! Tüm yatak modellerinde %40" },
      images: [{ original_image_url: "https://scontent.xx.fbcdn.net/a.jpg" }],
      link_url: "https://lovayatak.com",
    },
    ...overrides,
  };
}

type Fixture = {
  brandId: number;
  competitorId: number;
  targets: {
    competitorId: number;
    competitorName: string;
    instagramHandle: string | null;
    fbPageId: string;
    dealerName: string;
    dealerCity: string | null;
  }[];
};

async function seedBrand(
  brandName: string,
  pageId = PAGE_ID,
): Promise<Fixture> {
  const [brand] = await testDb
    .insert(brands)
    .values({ name: brandName })
    .returning({ id: brands.id });

  const [dealer] = await testDb
    .insert(dealers)
    .values({
      brandId: brand.id,
      name: `${brandName} Bandırma`,
      city: "Balıkesir",
    })
    .returning({ id: dealers.id });

  const [competitor] = await testDb
    .insert(competitors)
    .values({
      dealerId: dealer.id,
      name: "Bandırma Lova Yatak",
      instagramHandle: "lovayatak.bandirma",
      fbPageId: pageId,
      matchStatus: "matched",
    })
    .returning({ id: competitors.id });

  return {
    brandId: brand.id,
    competitorId: competitor.id,
    targets: [
      {
        competitorId: competitor.id,
        competitorName: "Bandırma Lova Yatak",
        instagramHandle: "lovayatak.bandirma",
        fbPageId: pageId,
        dealerName: `${brandName} Bandırma`,
        dealerCity: "Balıkesir",
      },
    ],
  };
}

let fixture: Fixture;

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await truncateAll();
  fixture = await seedBrand("İşbir Yatak");
});

describe("tarama hedefleri (AC-04)", () => {
  it("yalnızca matched + Page ID'si olan rakipleri döndürür", async () => {
    // Eşleştirilmemiş bir rakip daha eklenir.
    const [dealer] = await testDb
      .select({ id: dealers.id })
      .from(dealers)
      .limit(1);
    await testDb.insert(competitors).values({
      dealerId: dealer.id,
      name: "Puffy Bandırma",
      instagramHandle: "puffybandirma",
      matchStatus: "unverified",
    });
    // Page ID'si olmayan ama matched işaretlenmiş kayıt da taranmamalı.
    await testDb.insert(competitors).values({
      dealerId: dealer.id,
      name: "Sayfasız Rakip",
      matchStatus: "matched",
    });

    const targets = await loadScanTargets(fixture.brandId);
    expect(targets.targets).toHaveLength(1);
    expect(targets.targets[0].fbPageId).toBe(PAGE_ID);
    expect(targets.pendingMatch).toBe(1);
  });
});

describe("ilk tarama (AC-05)", () => {
  it("kayıt oluşur ve tam olarak bir bildirim sahiplenilir", async () => {
    const runId = await createRun(fixture.brandId, "test-actor");

    const result = await applyScanResults({
      brandId: fixture.brandId,
      runId,
      items: [record("AD-1")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: 0.0123,
    });

    expect(result.ok).toBe(true);
    expect(result.adsFound).toBe(1);
    expect(result.newAdIds).toEqual(["AD-1"]);

    const [ad] = await testDb.select().from(ads);
    expect(ad.competitorId).toBe(fixture.competitorId);
    expect(ad.isActive).toBe(true);
    expect(ad.creativeText).toContain("Yaz indirimi");
    expect(ad.imageUrl).toBe("https://scontent.xx.fbcdn.net/a.jpg");
    expect(ad.platforms).toEqual(["instagram", "facebook"]);

    const [run] = await testDb.select().from(scrapeRuns);
    expect(run.status).toBe("completed");
    expect(run.adsFound).toBe(1);
    expect(run.newAds).toBe(1);
    expect(run.costUsd).toBe("0.0123");

    // Bildirim tam olarak bir kez sahiplenilir.
    expect(await claimNotification("AD-1", "new_ad")).toBe(true);
    expect(await claimNotification("AD-1", "new_ad")).toBe(false);

    const [count] = await testDb
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications);
    expect(count.n).toBe(1);
  });

  it("bildirim içeriği Slack mesajı için gereken her alanı taşır (AC-10)", async () => {
    const runId = await createRun(fixture.brandId, "test-actor");
    await applyScanResults({
      brandId: fixture.brandId,
      runId,
      items: [record("AD-1"), record("AD-2")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    const context = await loadNotificationContext("AD-1");
    expect(context).not.toBeNull();
    expect(context!.brandName).toBe("İşbir Yatak");
    expect(context!.dealerName).toBe("İşbir Yatak Bandırma");
    expect(context!.dealerCity).toBe("Balıkesir");
    expect(context!.competitorName).toBe("Bandırma Lova Yatak");
    expect(context!.instagramHandle).toBe("lovayatak.bandirma");
    expect(context!.fbPageId).toBe(PAGE_ID);
    expect(context!.platforms).toEqual(["instagram", "facebook"]);
    expect(context!.imageUrl).toBeTruthy();
    // Rakibin o anki aktif reklam sayısı.
    expect(context!.activeAdCount).toBe(2);
  });
});

describe("ikinci tarama (AC-06)", () => {
  it("aynı reklam için ikinci bildirim üretilmez, yalnızca last_seen_at güncellenir", async () => {
    const firstRun = await createRun(fixture.brandId, "test-actor");
    await applyScanResults({
      brandId: fixture.brandId,
      runId: firstRun,
      items: [record("AD-1")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });
    await claimNotification("AD-1", "new_ad");
    await markNotificationSent("AD-1", "new_ad");

    const [before] = await testDb.select().from(ads);

    const secondRun = await createRun(fixture.brandId, "test-actor");
    const result = await applyScanResults({
      brandId: fixture.brandId,
      runId: secondRun,
      items: [record("AD-1")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    expect(result.newAdIds).toEqual([]);
    expect(result.unchangedCount).toBe(1);
    expect(result.stoppedCount).toBe(0);

    const [after] = await testDb.select().from(ads);
    expect(after.lastSeenAt.getTime()).toBeGreaterThanOrEqual(
      before.lastSeenAt.getTime(),
    );
    // İlk görülme anı asla değişmez.
    expect(after.firstSeenAt.getTime()).toBe(before.firstSeenAt.getTime());

    // Bildirim sayısı hâlâ 1 (AC-06, AC-08).
    const [count] = await testDb
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications);
    expect(count.n).toBe(1);
  });

  it("actor boş metin döndürürse mevcut kreatif ezilmez", async () => {
    const firstRun = await createRun(fixture.brandId, "test-actor");
    await applyScanResults({
      brandId: fixture.brandId,
      runId: firstRun,
      items: [record("AD-1")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    const secondRun = await createRun(fixture.brandId, "test-actor");
    await applyScanResults({
      brandId: fixture.brandId,
      runId: secondRun,
      // Bu kez metin ve görsel yok.
      items: [{ ad_archive_id: "AD-1", page_id: PAGE_ID }],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    const [ad] = await testDb.select().from(ads);
    expect(ad.creativeText).toContain("Yaz indirimi");
    expect(ad.imageUrl).toBe("https://scontent.xx.fbcdn.net/a.jpg");
  });
});

describe("sıfır sonuç = arıza (AC-07)", () => {
  it("hiçbir reklam pasife alınmaz, bildirim gitmez, tarama failed işaretlenir", async () => {
    const firstRun = await createRun(fixture.brandId, "test-actor");
    await applyScanResults({
      brandId: fixture.brandId,
      runId: firstRun,
      items: [record("AD-1"), record("AD-2")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    const emptyRun = await createRun(fixture.brandId, "test-actor");
    const result = await applyScanResults({
      brandId: fixture.brandId,
      runId: emptyRun,
      items: [],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: 0.004,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Sıfır sonuç");
    expect(result.newAdIds).toEqual([]);
    expect(result.stoppedCount).toBe(0);

    // Reklamların ikisi de hâlâ aktif — veri asla otomatik silinmez/pasifleşmez.
    const rows = await testDb.select().from(ads);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.isActive)).toBe(true);
    expect(rows.every((row) => row.stoppedAt === null)).toBe(true);

    // Hiç bildirim yok.
    const [count] = await testDb
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications);
    expect(count.n).toBe(0);

    // Çağıran taraf taramayı failed işaretler.
    await failRun(emptyRun, result.reason ?? "", { adsFound: 0, costUsd: 0.004 });
    const [run] = await testDb
      .select()
      .from(scrapeRuns)
      .where(eq(scrapeRuns.id, emptyRun));
    expect(run.status).toBe("failed");
    expect(run.error).toContain("Sıfır sonuç");
    expect(run.finishedAt).not.toBeNull();
  });

  it("hiç eşleştirilmiş rakip yoksa da yazma yapmaz", async () => {
    const runId = await createRun(fixture.brandId, "test-actor");
    const result = await applyScanResults({
      brandId: fixture.brandId,
      runId,
      items: [],
      targets: [],
      scannedPageIds: [],
      costUsd: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("matched");
  });

  it("page_id hiçbir rakibe denk gelmezse kayıtları yazmaz ve uyarır", async () => {
    const runId = await createRun(fixture.brandId, "test-actor");
    const result = await applyScanResults({
      brandId: fixture.brandId,
      runId,
      items: [record("AD-1", "000000000000")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    expect(result.ok).toBe(false);
    expect(result.unattributed).toBe(1);
    expect(result.reason).toContain("atanamadı");
    expect(await testDb.select().from(ads)).toHaveLength(0);
  });
});

describe("duran reklam ve haftalık özet", () => {
  it("görünmeyen reklam pasife alınır ve anlık bildirim üretmez", async () => {
    const firstRun = await createRun(fixture.brandId, "test-actor");
    await applyScanResults({
      brandId: fixture.brandId,
      runId: firstRun,
      items: [record("AD-1"), record("AD-2")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    const secondRun = await createRun(fixture.brandId, "test-actor");
    const result = await applyScanResults({
      brandId: fixture.brandId,
      runId: secondRun,
      items: [record("AD-1")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    expect(result.stoppedCount).toBe(1);
    expect(result.newAdIds).toEqual([]);

    const [stopped] = await testDb
      .select()
      .from(ads)
      .where(eq(ads.adArchiveId, "AD-2"));
    expect(stopped.isActive).toBe(false);
    expect(stopped.stoppedAt).not.toBeNull();

    const [run] = await testDb
      .select()
      .from(scrapeRuns)
      .where(eq(scrapeRuns.id, secondRun));
    expect(run.stoppedAds).toBe(1);
  });

  it("duran reklam yalnızca BİR haftalık özette görünür", async () => {
    const firstRun = await createRun(fixture.brandId, "test-actor");
    await applyScanResults({
      brandId: fixture.brandId,
      runId: firstRun,
      items: [record("AD-1"), record("AD-2")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });
    const secondRun = await createRun(fixture.brandId, "test-actor");
    await applyScanResults({
      brandId: fixture.brandId,
      runId: secondRun,
      items: [record("AD-1")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    const first = await collectWeeklyDigest();
    expect(first.brands).toHaveLength(1);
    expect(first.brands[0].brandName).toBe("İşbir Yatak");
    expect(first.brands[0].newAds).toBe(2);
    expect(first.brands[0].activeAds).toBe(1);
    expect(first.stoppedAdIds).toEqual(["AD-2"]);
    expect(first.brands[0].stoppedAds).toEqual([
      {
        competitorName: "Bandırma Lova Yatak",
        dealerName: "İşbir Yatak Bandırma",
        count: 1,
      },
    ]);

    await markStoppedAdsReported(first.stoppedAdIds);

    const second = await collectWeeklyDigest();
    expect(second.stoppedAdIds).toEqual([]);
    expect(second.brands[0].stoppedAds).toEqual([]);
  });
});

describe("çoklu marka (AC-09)", () => {
  it("iki marka aynı gün taranır, her bildirim doğru markaya bağlanır", async () => {
    const other = await seedBrand("Diğer Marka", OTHER_PAGE_ID);

    const runA = await createRun(fixture.brandId, "test-actor");
    await applyScanResults({
      brandId: fixture.brandId,
      runId: runA,
      items: [record("A-1", PAGE_ID)],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    const runB = await createRun(other.brandId, "test-actor");
    await applyScanResults({
      brandId: other.brandId,
      runId: runB,
      items: [record("B-1", OTHER_PAGE_ID)],
      targets: other.targets,
      scannedPageIds: [OTHER_PAGE_ID],
      costUsd: null,
    });

    expect((await loadNotificationContext("A-1"))!.brandName).toBe("İşbir Yatak");
    expect((await loadNotificationContext("B-1"))!.brandName).toBe("Diğer Marka");

    const runs = await testDb.select().from(scrapeRuns);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "completed")).toBe(true);
  });

  it("bir markanın taraması diğerinin reklamlarını durdurmaz", async () => {
    const other = await seedBrand("Diğer Marka", OTHER_PAGE_ID);

    const runB = await createRun(other.brandId, "test-actor");
    await applyScanResults({
      brandId: other.brandId,
      runId: runB,
      items: [record("B-1", OTHER_PAGE_ID)],
      targets: other.targets,
      scannedPageIds: [OTHER_PAGE_ID],
      costUsd: null,
    });

    const runA = await createRun(fixture.brandId, "test-actor");
    await applyScanResults({
      brandId: fixture.brandId,
      runId: runA,
      items: [record("A-1", PAGE_ID)],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    const [b] = await testDb
      .select()
      .from(ads)
      .where(eq(ads.adArchiveId, "B-1"));
    expect(b.isActive).toBe(true);
  });
});

describe("toplu bildirim (gürültü önlemi)", () => {
  it("çok sayıda yeni reklamı tek seferde sahiplenir ve rakip bazında özetler", async () => {
    const runId = await createRun(fixture.brandId, "test-actor");
    const items = Array.from({ length: 30 }, (_, i) => record(`AD-${i}`));
    const result = await applyScanResults({
      brandId: fixture.brandId,
      runId,
      items,
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });
    expect(result.newAdIds).toHaveLength(30);

    const claimed = await claimNotifications(result.newAdIds, "new_ad");
    expect(claimed).toHaveLength(30);
    // İkinci kez sahiplenme boş döner — mükerrer mesaj imkânsız.
    expect(await claimNotifications(result.newAdIds, "new_ad")).toHaveLength(0);

    const summary = await loadBurstSummary(claimed);
    expect(summary).toEqual([
      {
        competitorName: "Bandırma Lova Yatak",
        dealerName: "İşbir Yatak Bandırma",
        dealerCity: "Balıkesir",
        count: 30,
      },
    ]);
  });
});

describe("mükerrer bildirim kısıtı (AC-08)", () => {
  it("aynı reklam+tür için ikinci satır oluşamaz", async () => {
    const runId = await createRun(fixture.brandId, "test-actor");
    await applyScanResults({
      brandId: fixture.brandId,
      runId,
      items: [record("AD-1")],
      targets: fixture.targets,
      scannedPageIds: [PAGE_ID],
      costUsd: null,
    });

    await testDb
      .insert(notifications)
      .values({ adArchiveId: "AD-1", type: "new_ad" });

    await expect(
      testDb
        .insert(notifications)
        .values({ adArchiveId: "AD-1", type: "new_ad" }),
    ).rejects.toThrow();

    // Farklı tür (duran reklam) ayrı kayıt olarak eklenebilir.
    await testDb
      .insert(notifications)
      .values({ adArchiveId: "AD-1", type: "stopped_ad" });

    const [count] = await testDb
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.adArchiveId, "AD-1")));
    expect(count.n).toBe(2);
  });
});
