import { describe, expect, it } from "vitest";

process.env.APIFY_TOKEN = "apify_api_test";
process.env.APIFY_ACTOR_ID = "curious_coder/facebook-ads-library-scraper";
process.env.APIFY_LIMIT_PER_SOURCE = "100";

const { buildActorInput } = await import("@/lib/apify");

const PAGES = ["110095108749967", "123456789012345", "100064812345678"];

describe("actor girdisi", () => {
  const input = buildActorInput(PAGES, "urls");

  it("her Page ID için bir Ad Library adresi üretir", () => {
    const urls = input.urls as { url: string }[];
    expect(urls).toHaveLength(3);
    for (const [i, page] of PAGES.entries()) {
      expect(urls[i].url).toContain(`view_all_page_id=${page}`);
      expect(urls[i].url).toContain("country=TR");
      expect(urls[i].url).toContain("active_status=active");
    }
  });

  /**
   * Bu testin varlık nedeni gerçek bir hata: `count` alanı TÜM çalıştırma için
   * toplam sınırdır. Toplu taramada kullanılırsa sınıra ulaşıldıktan sonraki
   * rakiplerin reklamları hiç gelmez ve fark analizi onları DURMUŞ sanar —
   * yani yanlış "reklam durdu" raporu üretir. Sınır rakip başına olmalıdır.
   */
  it("toplam sınır (count) DEĞİL, rakip başına sınır (limitPerSource) kullanır", () => {
    expect(input.limitPerSource).toBe(100);
    expect(input).not.toHaveProperty("count");
  });

  it("sınıra takılırsa en yeni reklamlar korunacak şekilde sıralar", () => {
    // impressions_desc olsaydı yeni başlamış, az gösterimli kampanya
    // sınırın dışında kalabilirdi — tam olarak kaçırmak istemediğimiz şey.
    expect(input["scrapePageAds.sortBy"]).toBe("most_recent");
  });

  it("kullanılmayan ek veriyi (EU reach) istemez", () => {
    expect(input.scrapeAdDetails).toBe(false);
  });

  it("ülke ve aktiflik filtresini actor alanlarında da tekrarlar", () => {
    expect(input["scrapePageAds.countryCode"]).toBe("TR");
    expect(input["scrapePageAds.activeStatus"]).toBe("active");
  });

  it("yedek actor biçimleri için girdi anahtarını değiştirir", () => {
    expect(buildActorInput(PAGES, "startUrls")).toHaveProperty("startUrls");
    expect(buildActorInput(PAGES, "pageIds")).toMatchObject({ pageIds: PAGES });
  });
});
