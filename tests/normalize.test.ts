import { describe, expect, it } from "vitest";
import {
  fieldCoverage,
  normalizeAdRecord,
  normalizeDataset,
  parseAdDate,
} from "@/lib/normalize";

/** Ad Library JSON'una benzeyen iç içe biçim (curious_coder tarzı). */
const NESTED_RECORD = {
  ad_archive_id: "1234567890",
  page_id: "987654321",
  page_name: "Bandırma Lova Yatak",
  start_date: 1784160000,
  publisher_platform: ["FACEBOOK", "INSTAGRAM"],
  snapshot: {
    body: { text: "Yaz indirimi başladı! Tüm yatak modellerinde %40" },
    title: "Lova Yatak",
    link_url: "https://lovayatak.com/kampanya",
    images: [
      {
        original_image_url: "https://scontent.xx.fbcdn.net/orig.jpg",
        resized_image_url: "https://scontent.xx.fbcdn.net/small.jpg",
      },
    ],
  },
};

/** Düz biçim (apify/facebook-ads-scraper tarzı). */
const FLAT_RECORD = {
  adArchiveID: "5555",
  pageId: 123,
  adCreativeBody: "Kampanya metni",
  imageUrl: "https://scontent.xx.fbcdn.net/flat.jpg",
  adDeliveryStartTime: "2026-07-20",
  platforms: ["instagram"],
};

describe("actor çıktısı normalize etme", () => {
  it("iç içe biçimi çözer", () => {
    const ad = normalizeAdRecord(NESTED_RECORD);
    expect(ad).not.toBeNull();
    expect(ad!.adArchiveId).toBe("1234567890");
    expect(ad!.pageId).toBe("987654321");
    expect(ad!.creativeText).toContain("Yaz indirimi");
    expect(ad!.creativeTitle).toBe("Lova Yatak");
    expect(ad!.imageUrl).toBe("https://scontent.xx.fbcdn.net/orig.jpg");
    expect(ad!.landingUrl).toBe("https://lovayatak.com/kampanya");
    expect(ad!.platforms).toEqual(["facebook", "instagram"]);
    expect(ad!.startedAt?.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("düz biçimi de çözer (yedek actor uyumu)", () => {
    const ad = normalizeAdRecord(FLAT_RECORD);
    expect(ad!.adArchiveId).toBe("5555");
    expect(ad!.pageId).toBe("123");
    expect(ad!.creativeText).toBe("Kampanya metni");
    expect(ad!.platforms).toEqual(["instagram"]);
  });

  it("arşiv kimliği olmayan kaydı reddeder", () => {
    expect(normalizeAdRecord({ page_id: "1", body: "metin" })).toBeNull();
    expect(normalizeAdRecord(null)).toBeNull();
    expect(normalizeAdRecord("metin")).toBeNull();
  });

  it("HTML etiketlerini metinden temizler", () => {
    const ad = normalizeAdRecord({
      ad_archive_id: "1",
      snapshot: { body: { text: "Satır1<br>Satır2 &amp; devamı" } },
    });
    expect(ad!.creativeText).toBe("Satır1\nSatır2 & devamı");
  });

  it("bilinmeyen platform adlarını yok sayar", () => {
    const ad = normalizeAdRecord({
      ad_archive_id: "1",
      publisher_platform: ["FACEBOOK", "TIKTOK", "audience_network"],
    });
    expect(ad!.platforms).toEqual(["facebook", "audience_network"]);
  });

  it("active_status alanını yorumlar", () => {
    expect(
      normalizeAdRecord({ ad_archive_id: "1", active_status: "inactive" })!
        .isActiveOnMeta,
    ).toBe(false);
    // Sorgu active_status=active ile yapıldığı için varsayılan aktif.
    expect(normalizeAdRecord({ ad_archive_id: "1" })!.isActiveOnMeta).toBe(true);
  });
});

describe("tarih ayrıştırma", () => {
  it("unix saniye ve milisaniyeyi ayırt eder", () => {
    expect(parseAdDate(1784160000)?.toISOString()).toBe(
      "2026-07-16T00:00:00.000Z",
    );
    expect(parseAdDate(1784160000000)?.toISOString()).toBe(
      "2026-07-16T00:00:00.000Z",
    );
  });

  it("ISO ve Türkçe gg.aa.yyyy biçimini okur", () => {
    expect(parseAdDate("2026-07-26")?.toISOString()).toBe(
      "2026-07-26T00:00:00.000Z",
    );
    expect(parseAdDate("26.07.2026")?.toISOString()).toBe(
      "2026-07-26T00:00:00.000Z",
    );
  });

  it("çözümlenemeyen değerde null döner", () => {
    expect(parseAdDate(null)).toBeNull();
    expect(parseAdDate("")).toBeNull();
    expect(parseAdDate("yakında")).toBeNull();
  });
});

describe("dataset tekleme", () => {
  it("aynı arşiv kimliğini teke indirir ve zengin kaydı seçer", () => {
    const { ads, skipped } = normalizeDataset([
      { ad_archive_id: "1" },
      {
        ad_archive_id: "1",
        snapshot: {
          body: { text: "metin" },
          images: [{ original_image_url: "https://x/y.jpg" }],
        },
      },
      { page_id: "yok" },
    ]);
    expect(ads).toHaveLength(1);
    expect(ads[0].imageUrl).toBe("https://x/y.jpg");
    expect(skipped).toBe(1);
  });
});

describe("alan kapsamı raporu", () => {
  it("dolu alanları sayar (verify-actor betiği için)", () => {
    const { ads } = normalizeDataset([NESTED_RECORD, FLAT_RECORD]);
    const coverage = fieldCoverage(ads);
    expect(coverage.adArchiveId).toBe(2);
    expect(coverage.imageUrl).toBe(2);
    expect(coverage.landingUrl).toBe(1);
    expect(coverage.platforms).toBe(2);
  });
});
