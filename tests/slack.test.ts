import { describe, expect, it } from "vitest";

// Slack modülü yüklenirken env okunur; sahte değerler import'tan ÖNCE verilir.
process.env.APP_URL = "https://rakip.example.com";
process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/x/y/z";

const {
  buildNewAdMessage,
  buildWeeklyDigestMessage,
  buildTechAlertMessage,
  formatTrDate,
  formatPlatforms,
} = await import("@/lib/slack");

const BASE = {
  brandName: "İşbir Yatak",
  dealerName: "İşbir Yatak Bandırma",
  dealerCity: "Balıkesir",
  competitorName: "Bandırma Lova Yatak",
  instagramHandle: "lovayatak.bandirma",
  fbPageId: "987654321",
  adArchiveId: "1234567890",
  startedAt: new Date("2026-07-26T12:00:00Z"),
  platforms: ["instagram", "facebook"],
  activeAdCount: 3,
  creativeText:
    "Yaz indirimi başladı! Tüm yatak modellerinde %40'a varan fırsatlar…",
  creativeTitle: null,
  imageUrl: "https://scontent.xx.fbcdn.net/creative.jpg",
};

function textOf(blocks: unknown[]): string {
  return JSON.stringify(blocks);
}

describe("yeni reklam mesajı (AC-10)", () => {
  const message = buildNewAdMessage(BASE);
  const serialized = textOf(message.blocks);

  it("marka adını başlıkta taşır (AC-09)", () => {
    const header = message.blocks[0] as {
      type: string;
      text: { text: string };
    };
    expect(header.type).toBe("header");
    expect(header.text.text).toContain("İşbir Yatak");
    expect(header.text.text).toContain("Yeni Rakip Reklamı");
  });

  it("bayi, rakip, tarih, platform ve aktif reklam sayısını içerir", () => {
    expect(serialized).toContain("İşbir Yatak Bandırma");
    expect(serialized).toContain("Balıkesir");
    expect(serialized).toContain("@lovayatak.bandirma");
    expect(serialized).toContain("26.07.2026");
    expect(serialized).toContain("Instagram, Facebook");
    expect(serialized).toContain("3 kampanya");
  });

  it("kreatif metni ve görseli içerir", () => {
    expect(serialized).toContain("Yaz indirimi başladı");
    const image = message.blocks.find(
      (block) => (block as { type: string }).type === "image",
    ) as { image_url: string };
    expect(image.image_url).toBe(BASE.imageUrl);
  });

  it("üç bağlantı da doğru hedefe gider", () => {
    const actions = message.blocks.find(
      (block) => (block as { type: string }).type === "actions",
    ) as { elements: { text: { text: string }; url: string }[] };

    const urls = Object.fromEntries(
      actions.elements.map((element) => [element.text.text, element.url]),
    );

    expect(urls["Ad Library'de Aç"]).toBe(
      "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=TR&view_all_page_id=987654321",
    );
    expect(urls["Instagram Profili"]).toBe(
      "https://www.instagram.com/lovayatak.bandirma/",
    );
    expect(urls["Panelde Gör"]).toBe(
      "https://rakip.example.com/ads?ad=1234567890",
    );
  });

  it("Instagram yoksa o düğmeyi koymaz", () => {
    const message = buildNewAdMessage({ ...BASE, instagramHandle: null });
    const actions = message.blocks.find(
      (block) => (block as { type: string }).type === "actions",
    ) as { elements: { text: { text: string } }[] };
    expect(actions.elements).toHaveLength(2);
  });

  it("Page ID yoksa reklamın kendi Ad Library adresini kullanır", () => {
    const message = buildNewAdMessage({ ...BASE, fbPageId: null });
    expect(textOf(message.blocks)).toContain("id=1234567890");
  });

  it("görsel yoksa image bloğu üretmez", () => {
    const message = buildNewAdMessage({ ...BASE, imageUrl: null });
    expect(
      message.blocks.some((b) => (b as { type: string }).type === "image"),
    ).toBe(false);
  });

  it("düz metin karşılığı marka ve rakip adını taşır", () => {
    expect(message.text).toContain("İşbir Yatak");
    expect(message.text).toContain("Bandırma Lova Yatak");
  });
});

describe("biçimlendirme yardımcıları", () => {
  it("tarihi TR saatiyle gg.aa.yyyy yazar", () => {
    expect(formatTrDate(new Date("2026-07-26T21:30:00Z"))).toBe("27.07.2026");
    expect(formatTrDate(null)).toBe("bilinmiyor");
  });

  it("platform adlarını okunur hale getirir", () => {
    expect(formatPlatforms(["instagram", "audience_network"])).toBe(
      "Instagram, Audience Network",
    );
    expect(formatPlatforms([])).toBe("platform bilgisi yok");
  });
});

describe("haftalık özet", () => {
  it("tüm markaları tek mesajda toplar", () => {
    const message = buildWeeklyDigestMessage({
      periodStart: new Date("2026-07-20T00:00:00Z"),
      periodEnd: new Date("2026-07-27T00:00:00Z"),
      brands: [
        {
          brandName: "İşbir Yatak",
          newAds: 4,
          stoppedAds: [
            { competitorName: "Lova", dealerName: "Bandırma", count: 2 },
          ],
          activeAds: 11,
          competitorsMatched: 8,
          competitorsPending: 3,
          failedRuns: 1,
        },
        {
          brandName: "Diğer Marka",
          newAds: 0,
          stoppedAds: [],
          activeAds: 0,
          competitorsMatched: 2,
          competitorsPending: 0,
          failedRuns: 0,
        },
      ],
    });

    const serialized = textOf(message.blocks);
    expect(serialized).toContain("İşbir Yatak");
    expect(serialized).toContain("Diğer Marka");
    expect(serialized).toContain("Eşleştirme bekleyen rakip");
    expect(serialized).toContain("Başarısız tarama");
  });

  it("marka yoksa da geçerli mesaj üretir", () => {
    const message = buildWeeklyDigestMessage({
      periodStart: new Date("2026-07-20T00:00:00Z"),
      periodEnd: new Date("2026-07-27T00:00:00Z"),
      brands: [],
    });
    expect(textOf(message.blocks)).toContain("Aktif marka yok");
  });
});

describe("teknik alarm", () => {
  it("tarama kimliğini ve nedeni taşır", () => {
    const message = buildTechAlertMessage({
      title: "Sıfır sonuç — scraper arızası varsayıldı",
      brandName: "İşbir Yatak",
      runId: 42,
      detail: "12 rakip tarandı, hiç reklam dönmedi.",
    });
    const serialized = textOf(message.blocks);
    expect(serialized).toContain("Sıfır sonuç");
    expect(serialized).toContain("#42");
    expect(serialized).toContain("12 rakip");
    expect(message.text).toContain("🚨");
  });
});
