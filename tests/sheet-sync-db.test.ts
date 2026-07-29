import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

vi.mock("@/db", async () => {
  const mod = await import("./helpers/test-db");
  return { db: mod.testDb, schema };
});

const { testDb, migrate, truncateAll } = await import("./helpers/test-db");
const {
  claimSheetSync,
  loadSheetSyncContext,
  markSheetSyncDone,
  releaseSheetSync,
} = await import("@/server/sheet-sync");

const { ads, brands, competitors, dealers, sheetSyncs } = schema;

let dealerId: number;
let competitorId: number;

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await truncateAll();
  const [brand] = await testDb
    .insert(brands)
    .values({ name: "İşbir Yatak" })
    .returning({ id: brands.id });
  const [dealer] = await testDb
    .insert(dealers)
    .values({ brandId: brand.id, name: "İşbir Yatak Bandırma", city: "Balıkesir" })
    .returning({ id: dealers.id });
  dealerId = dealer.id;
  const [competitor] = await testDb
    .insert(competitors)
    .values({
      dealerId,
      name: "Bandırma Lova Yatak",
      instagramHandle: "lovayatak.bandirma",
      fbPageId: "110095108749967",
      matchStatus: "matched",
    })
    .returning({ id: competitors.id });
  competitorId = competitor.id;
  await testDb.insert(ads).values({
    adArchiveId: "AD-1",
    competitorId,
    startedAt: new Date("2026-07-20T00:00:00Z"),
    firstSeenAt: new Date("2026-07-26T00:00:00Z"),
    lastSeenAt: new Date("2026-07-26T00:00:00Z"),
  });
});

describe("sahiplenme (claim) — mükerrer satır imkânsız", () => {
  it("ilk sahiplenme başarılı, ikinci reddedilir", async () => {
    expect(await claimSheetSync("AD-1")).toBe(true);
    expect(await claimSheetSync("AD-1")).toBe(false);

    const [count] = await testDb
      .select({ n: sql<number>`count(*)::int` })
      .from(sheetSyncs);
    expect(count.n).toBe(1);
  });

  it("farklı reklamlar bağımsız sahiplenilir", async () => {
    await testDb.insert(ads).values({
      adArchiveId: "AD-2",
      competitorId,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });
    expect(await claimSheetSync("AD-1")).toBe(true);
    expect(await claimSheetSync("AD-2")).toBe(true);
  });
});

describe("context yükleme — satır oluşturmak için gereken alanlar", () => {
  it("bayi, rakip ve reklam bilgisini birlikte getirir", async () => {
    const context = await loadSheetSyncContext("AD-1");
    expect(context).toMatchObject({
      adArchiveId: "AD-1",
      competitorName: "Bandırma Lova Yatak",
      dealerName: "İşbir Yatak Bandırma",
      dealerCity: "Balıkesir",
      instagramHandle: "lovayatak.bandirma",
      fbPageId: "110095108749967",
    });
    expect(context!.startedAt).not.toBeNull();
  });

  it("olmayan reklamda null döner", async () => {
    expect(await loadSheetSyncContext("YOK")).toBeNull();
  });
});

describe("başarı ve başarısızlık sonrası durum", () => {
  it("markSheetSyncDone senkron zamanını işaretler", async () => {
    await claimSheetSync("AD-1");
    await markSheetSyncDone("AD-1");
    const [row] = await testDb
      .select({ syncedAt: sheetSyncs.syncedAt })
      .from(sheetSyncs);
    expect(row.syncedAt).not.toBeNull();
  });

  it("releaseSheetSync sahiplenmeyi geri alır — yeniden denenebilir", async () => {
    await claimSheetSync("AD-1");
    await releaseSheetSync("AD-1", "Sheets API zaman aşımı");

    const [count] = await testDb
      .select({ n: sql<number>`count(*)::int` })
      .from(sheetSyncs);
    expect(count.n).toBe(0);

    // Serbest bırakıldığı için yeniden sahiplenilebilir.
    expect(await claimSheetSync("AD-1")).toBe(true);
  });
});

describe("Slack bildirimlerinden bağımsızlık", () => {
  it("notifications tablosu boş olsa da sheet_syncs bağımsız çalışır", async () => {
    // Slack hiç bilgilendirilmemiş (notifications boş) — sheet senkronu
    // yine de başarıyla ilerleyebilmeli, çünkü ayrı bir tabloda tutuluyor.
    const [notifCount] = await testDb
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.notifications);
    expect(notifCount.n).toBe(0);

    expect(await claimSheetSync("AD-1")).toBe(true);
    await markSheetSyncDone("AD-1");

    const [row] = await testDb
      .select({ syncedAt: sheetSyncs.syncedAt })
      .from(sheetSyncs);
    expect(row.syncedAt).not.toBeNull();
  });
});
