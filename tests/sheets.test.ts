import { beforeEach, describe, expect, it } from "vitest";

describe("satır oluşturma (buildSheetRow) — saf fonksiyon", () => {
  it("kullanıcının istediği yedi kolonu, istenen sırayla üretir", async () => {
    const { buildSheetRow, SHEET_HEADERS } = await import("@/lib/sheets");
    const row = buildSheetRow({
      competitorName: "Bandırma Lova Yatak",
      dealerName: "İşbir Yatak Bandırma",
      dealerCity: "Balıkesir",
      instagramHandle: "lovayatak.bandirma",
      fbPageId: "110095108749967",
      adArchiveId: "1234567890",
      adDate: new Date("2026-07-26T12:00:00Z"),
    });

    expect(Object.keys(row)).toEqual([...SHEET_HEADERS]);
    expect(row["Reklam Tarihi"]).toBe("26.07.2026"); // 12:00 UTC + 3 = aynı gün
    expect(row["Rakip Bayi İsmi"]).toBe("Bandırma Lova Yatak");
    expect(row["Bizdeki hangi bayinin rakibi"]).toBe("İşbir Yatak Bandırma");
    expect(row["İl"]).toBe("Balıkesir");
    expect(row["İlçe"]).toBe(""); // veri modelinde henüz yok — bilerek boş
  });

  it("Page ID varsa sayfanın Ad Library adresini kullanır", async () => {
    const { buildSheetRow } = await import("@/lib/sheets");
    const row = buildSheetRow({
      competitorName: "X",
      dealerName: "Y",
      dealerCity: null,
      instagramHandle: null,
      fbPageId: "110095108749967",
      adArchiveId: "AD-1",
      adDate: null,
    });
    expect(row.URL).toBe(
      "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=TR&view_all_page_id=110095108749967",
    );
  });

  it("Page ID yoksa reklamın kendi Ad Library adresine düşer", async () => {
    const { buildSheetRow } = await import("@/lib/sheets");
    const row = buildSheetRow({
      competitorName: "X",
      dealerName: "Y",
      dealerCity: null,
      instagramHandle: null,
      fbPageId: null,
      adArchiveId: "AD-1",
      adDate: null,
    });
    expect(row.URL).toContain("id=AD-1");
  });

  it("Instagram yoksa boş bırakır, adresi uydurmaz", async () => {
    const { buildSheetRow } = await import("@/lib/sheets");
    const row = buildSheetRow({
      competitorName: "X",
      dealerName: "Y",
      dealerCity: null,
      instagramHandle: null,
      fbPageId: null,
      adArchiveId: "AD-1",
      adDate: null,
    });
    expect(row["İnstagram Adresi"]).toBe("");
  });

  it("İl yoksa boş bırakır", async () => {
    const { buildSheetRow } = await import("@/lib/sheets");
    const row = buildSheetRow({
      competitorName: "X",
      dealerName: "Y",
      dealerCity: null,
      instagramHandle: null,
      fbPageId: null,
      adArchiveId: "AD-1",
      adDate: null,
    });
    expect(row["İl"]).toBe("");
  });

  it("tarih yoksa 'bilinmiyor' yazar (Slack ile tutarlı)", async () => {
    const { buildSheetRow } = await import("@/lib/sheets");
    const row = buildSheetRow({
      competitorName: "X",
      dealerName: "Y",
      dealerCity: null,
      instagramHandle: null,
      fbPageId: null,
      adArchiveId: "AD-1",
      adDate: null,
    });
    expect(row["Reklam Tarihi"]).toBe("bilinmiyor");
  });
});

describe("sheetsConfigured — kurulum algılama", () => {
  const KEYS = [
    "GOOGLE_SHEETS_ID",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  ] as const;
  const originals: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      originals[key] = process.env[key];
      delete process.env[key];
    }
  });

  it("üç değişken de eksikse false döner (kurulum yapılmamış = sessizce atla)", async () => {
    const { sheetsConfigured } = await import("@/lib/sheets");
    expect(sheetsConfigured()).toBe(false);
  });

  it("yalnızca ikisi tanımlıysa yine false döner", async () => {
    process.env.GOOGLE_SHEETS_ID = "abc";
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "svc@example.com";
    const { sheetsConfigured } = await import("@/lib/sheets");
    expect(sheetsConfigured()).toBe(false);
  });

  it("üçü de tanımlıysa true döner", async () => {
    process.env.GOOGLE_SHEETS_ID = "abc";
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "svc@example.com";
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "-----BEGIN...";
    const { sheetsConfigured } = await import("@/lib/sheets");
    expect(sheetsConfigured()).toBe(true);
  });
});
