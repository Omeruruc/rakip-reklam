import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";

vi.mock("@/db", async () => {
  const mod = await import("./helpers/test-db");
  return { db: mod.testDb, schema };
});

const { testDb, migrate, truncateAll } = await import("./helpers/test-db");
const { commitImport, previewImport, deactivateMissing } = await import(
  "@/server/import"
);

const { brands, competitors, dealers } = schema;

const MAPPING = {
  dealerName: 0,
  city: 1,
  address: 2,
  competitorName: 3,
  instagram: 4,
};

/** MVP özeti §5'teki gruplandırılmış dosyanın birebir karşılığı. */
const SHEET: (string | null)[][] = [
  ["Bayi Adı", "İl", "Adres", "Rakip Mağaza Adı", "Instagram"],
  [
    "İşbir Yatak Bandırma",
    "Balıkesir",
    "Atatürk Cd. 12",
    "Bandırma Lova Yatak",
    "https://www.instagram.com/lovayatak.bandirma/",
  ],
  [null, null, null, "Puffy Bandırma", "instagram.com/puffybandirma/"],
  [null, null, null, "Bambi Yatak Ayna AVM", "…/ayna.bambiyatak/"],
  [null, null, null, null, null],
  ["İşbir Yatak Bursa", "Bursa", "Nilüfer", "Yatsan Nilüfer", "@yatsan.nilufer"],
  [null, null, null, "Şehir Mobilya", null],
];

function workbook(rows: (string | null)[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Bayi-Rakip");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

async function counts() {
  const [dealerCount] = await testDb
    .select({ n: sql<number>`count(*)::int` })
    .from(dealers);
  const [competitorCount] = await testDb
    .select({ n: sql<number>`count(*)::int` })
    .from(competitors);
  return { dealers: dealerCount.n, competitors: competitorCount.n };
}

let brandId: number;

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await truncateAll();
  const [brand] = await testDb
    .insert(brands)
    .values({ name: "İşbir Yatak" })
    .returning({ id: brands.id });
  brandId = brand.id;
});

describe("önizleme hiçbir şey yazmaz (AC-01)", () => {
  it("doğru sayıları verir ama veritabanına dokunmaz", async () => {
    const buffer = workbook(SHEET);
    const before = await counts();

    const preview = await previewImport({
      brandId,
      buffer,
      fileName: "ornek.xlsx",
      mapping: MAPPING,
    });

    expect(preview.dealers.create).toBe(2);
    expect(preview.competitors.create).toBe(5);
    expect(preview.totalDataRows).toBe(5);
    expect(preview.skippedBlankRows).toBe(1);
    expect(preview.errors).toHaveLength(0);

    expect(await counts()).toEqual(before);
    expect(await counts()).toEqual({ dealers: 0, competitors: 0 });
  });
});

describe("içe aktarma (AC-02, AC-04)", () => {
  it("boş bayi hücreli satırları doğru bayiye bağlar", async () => {
    await commitImport({ brandId, buffer: workbook(SHEET), mapping: MAPPING });

    const rows = await testDb
      .select({
        competitor: competitors.name,
        handle: competitors.instagramHandle,
        dealer: dealers.name,
        city: dealers.city,
        status: competitors.matchStatus,
      })
      .from(competitors)
      .innerJoin(dealers, eq(competitors.dealerId, dealers.id))
      .orderBy(competitors.id);

    expect(rows).toHaveLength(5);
    expect(rows.slice(0, 3).map((r) => r.dealer)).toEqual([
      "İşbir Yatak Bandırma",
      "İşbir Yatak Bandırma",
      "İşbir Yatak Bandırma",
    ]);
    expect(rows.slice(0, 3).every((r) => r.city === "Balıkesir")).toBe(true);
    expect(rows[3].dealer).toBe("İşbir Yatak Bursa");
    expect(rows[4].competitor).toBe("Şehir Mobilya");
    expect(rows[4].handle).toBeNull();
  });

  it("her yeni rakip unverified başlar — taramaya girmez (AC-04)", async () => {
    await commitImport({ brandId, buffer: workbook(SHEET), mapping: MAPPING });
    const rows = await testDb
      .select({ status: competitors.matchStatus })
      .from(competitors);
    expect(rows.every((r) => r.status === "unverified")).toBe(true);
  });
});

describe("aynı dosyanın ikinci yüklemesi (AC-03)", () => {
  it("sıfır yeni kayıt oluşur ve onaylı Page ID'ler bozulmaz", async () => {
    const buffer = workbook(SHEET);
    await commitImport({ brandId, buffer, mapping: MAPPING });

    // Bir rakibin eşleştirmesi insan tarafından onaylanır.
    const [target] = await testDb
      .select({ id: competitors.id })
      .from(competitors)
      .where(eq(competitors.instagramHandle, "lovayatak.bandirma"));

    await testDb
      .update(competitors)
      .set({
        fbPageId: "987654321098765",
        fbPageName: "Bandırma Lova Yatak",
        matchStatus: "matched",
        matchedBy: "omer@example.com",
      })
      .where(eq(competitors.id, target.id));

    const before = await counts();

    // Aynı dosya tekrar yüklenir.
    const preview = await previewImport({
      brandId,
      buffer,
      fileName: "ornek.xlsx",
      mapping: MAPPING,
    });
    expect(preview.dealers.create).toBe(0);
    expect(preview.competitors.create).toBe(0);
    expect(preview.competitors.unchanged).toBe(5);
    expect(preview.competitors.matchPreserved).toBe(1);
    expect(preview.competitors.matchNeedsRecheck).toBe(0);

    const result = await commitImport({ brandId, buffer, mapping: MAPPING });
    expect(result.dealersCreated).toBe(0);
    expect(result.competitorsCreated).toBe(0);
    expect(result.competitorsUpdated).toBe(0);
    expect(await counts()).toEqual(before);

    const [after] = await testDb
      .select({
        fbPageId: competitors.fbPageId,
        status: competitors.matchStatus,
        matchedBy: competitors.matchedBy,
      })
      .from(competitors)
      .where(eq(competitors.id, target.id));

    expect(after.fbPageId).toBe("987654321098765");
    expect(after.status).toBe("matched");
    expect(after.matchedBy).toBe("omer@example.com");
  });

  it("dosya önizlemeden sonra değiştiyse onayı reddeder", async () => {
    const first = workbook(SHEET);
    const preview = await previewImport({
      brandId,
      buffer: first,
      fileName: "ornek.xlsx",
      mapping: MAPPING,
    });

    const changed = workbook([...SHEET, ["Yeni Bayi", "İzmir", null, "Yeni Rakip", null]]);

    await expect(
      commitImport({
        brandId,
        buffer: changed,
        mapping: MAPPING,
        expectedToken: preview.token,
      }),
    ).rejects.toThrow(/değişti/);
  });
});

describe("dosya değiştiğinde davranış", () => {
  it("yeni satırlar eklenir, mevcutlar korunur", async () => {
    await commitImport({ brandId, buffer: workbook(SHEET), mapping: MAPPING });

    const extended = [
      ...SHEET,
      ["İşbir Yatak İzmir", "İzmir", "Bostanlı", "Bellona Karşıyaka", "instagram.com/bellona.k"],
    ];
    const result = await commitImport({
      brandId,
      buffer: workbook(extended),
      mapping: MAPPING,
    });

    expect(result.dealersCreated).toBe(1);
    expect(result.competitorsCreated).toBe(1);
    expect(await counts()).toEqual({ dealers: 3, competitors: 6 });
  });

  it("Instagram değişirse onaylı eşleştirme yeniden onaya düşer, Page ID silinmez", async () => {
    await commitImport({ brandId, buffer: workbook(SHEET), mapping: MAPPING });

    const [target] = await testDb
      .select({ id: competitors.id })
      .from(competitors)
      .where(eq(competitors.instagramHandle, "puffybandirma"));

    await testDb
      .update(competitors)
      .set({ fbPageId: "111222333", matchStatus: "matched" })
      .where(eq(competitors.id, target.id));

    // Aynı bayi + aynı rakip adı, farklı Instagram hesabı.
    const corrected = SHEET.map((row) =>
      row[3] === "Puffy Bandırma"
        ? [row[0], row[1], row[2], row[3], "instagram.com/puffy.bandirma.resmi"]
        : row,
    );

    const preview = await previewImport({
      brandId,
      buffer: workbook(corrected),
      fileName: "duzeltilmis.xlsx",
      mapping: MAPPING,
    });
    expect(preview.competitors.matchNeedsRecheck).toBe(1);

    const result = await commitImport({
      brandId,
      buffer: workbook(corrected),
      mapping: MAPPING,
    });
    expect(result.matchNeedsRecheck).toBe(1);

    const [after] = await testDb
      .select({
        handle: competitors.instagramHandle,
        status: competitors.matchStatus,
        fbPageId: competitors.fbPageId,
      })
      .from(competitors)
      .where(eq(competitors.id, target.id));

    expect(after.handle).toBe("puffy.bandirma.resmi");
    expect(after.status).toBe("unverified");
    // Page ID öneri olarak kalır — manuel iş çöpe atılmaz.
    expect(after.fbPageId).toBe("111222333");
  });

  it("dosyada olmayan kayıtları raporlar ama silmez", async () => {
    await commitImport({ brandId, buffer: workbook(SHEET), mapping: MAPPING });

    const shrunk = SHEET.filter((row) => row[3] !== "Şehir Mobilya");
    const preview = await previewImport({
      brandId,
      buffer: workbook(shrunk),
      fileName: "kisa.xlsx",
      mapping: MAPPING,
    });

    expect(preview.missing.competitors.map((c) => c.name)).toEqual([
      "Şehir Mobilya",
    ]);

    await commitImport({ brandId, buffer: workbook(shrunk), mapping: MAPPING });
    // Otomatik silme yok.
    expect(await counts()).toEqual({ dealers: 2, competitors: 5 });

    // Kullanıcı açıkça isterse pasife alınır.
    const deactivated = await deactivateMissing({
      brandId,
      dealerIds: [],
      competitorIds: preview.missing.competitors.map((c) => c.id),
    });
    expect(deactivated.competitors).toBe(1);

    const [row] = await testDb
      .select({ isActive: competitors.isActive })
      .from(competitors)
      .where(eq(competitors.name, "Şehir Mobilya"));
    expect(row.isActive).toBe(false);
  });
});

describe("veri bütünlüğü", () => {
  it("aynı markada aynı isimli iki bayi oluşamaz", async () => {
    await testDb.insert(dealers).values({ brandId, name: "Bayi A" });
    await expect(
      testDb.insert(dealers).values({ brandId, name: "Bayi A" }),
    ).rejects.toThrow();
  });

  it("aynı bayide aynı Instagram hesabı iki kez olamaz", async () => {
    const [dealer] = await testDb
      .insert(dealers)
      .values({ brandId, name: "Bayi A" })
      .returning({ id: dealers.id });

    await testDb
      .insert(competitors)
      .values({ dealerId: dealer.id, name: "Rakip 1", instagramHandle: "abc" });

    await expect(
      testDb
        .insert(competitors)
        .values({ dealerId: dealer.id, name: "Rakip 2", instagramHandle: "abc" }),
    ).rejects.toThrow();
  });
});
