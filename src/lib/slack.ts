import { env } from "./env";
import {
  adLibraryAdUrl,
  adLibraryUrl,
  instagramProfileUrl,
} from "./adlibrary";
import { PLATFORM_LABELS } from "./normalize";

/**
 * Slack mesajları. Tüm markalar TEK kanalı kullandığı için marka adı
 * mesaj başlığında zorunludur (AC-09, AC-10).
 */

export type NewAdMessageInput = {
  brandName: string;
  dealerName: string;
  dealerCity: string | null;
  competitorName: string;
  instagramHandle: string | null;
  fbPageId: string | null;
  adArchiveId: string;
  startedAt: Date | null;
  platforms: string[];
  activeAdCount: number;
  creativeText: string | null;
  creativeTitle: string | null;
  imageUrl: string | null;
};

const TR_DATE = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Istanbul",
});

export function formatTrDate(date: Date | null | undefined): string {
  if (!date) return "bilinmiyor";
  return TR_DATE.format(date);
}

export function formatPlatforms(platforms: string[]): string {
  if (platforms.length === 0) return "platform bilgisi yok";
  return platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(", ");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function dashboardAdUrl(adArchiveId: string): string {
  return `${env.appUrl}/ads?ad=${encodeURIComponent(adArchiveId)}`;
}

/* -------------------------------------------------------------------------- */
/* Yeni reklam bildirimi                                                       */
/* -------------------------------------------------------------------------- */

export function buildNewAdMessage(input: NewAdMessageInput) {
  const dealerLine = [input.dealerName, input.dealerCity]
    .filter(Boolean)
    .join(" · ");
  const competitorLine = [
    input.competitorName,
    input.instagramHandle ? `@${input.instagramHandle}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const startLine = `${formatTrDate(input.startedAt)} · ${formatPlatforms(input.platforms)}`;

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🔴 Yeni Rakip Reklamı — ${truncate(input.brandName, 100)}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Bayi*\n${dealerLine || "—"}` },
        { type: "mrkdwn", text: `*Rakip*\n${competitorLine || "—"}` },
        { type: "mrkdwn", text: `*Başlangıç*\n${startLine}` },
        {
          type: "mrkdwn",
          text: `*Aktif reklam*\n${input.activeAdCount} kampanya`,
        },
      ],
    },
  ];

  const creative = [input.creativeTitle, input.creativeText]
    .filter(Boolean)
    .join("\n");
  if (creative) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `>${truncate(creative, 600).replace(/\n/g, "\n>")}` },
    });
  }

  if (input.imageUrl) {
    blocks.push({
      type: "image",
      image_url: input.imageUrl,
      alt_text: truncate(input.competitorName, 60),
    });
  }

  const elements: Record<string, unknown>[] = [
    {
      type: "button",
      text: { type: "plain_text", text: "Ad Library'de Aç" },
      url: input.fbPageId
        ? adLibraryUrl(input.fbPageId)
        : adLibraryAdUrl(input.adArchiveId),
    },
  ];
  if (input.instagramHandle) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: "Instagram Profili" },
      url: instagramProfileUrl(input.instagramHandle),
    });
  }
  elements.push({
    type: "button",
    text: { type: "plain_text", text: "Panelde Gör" },
    url: dashboardAdUrl(input.adArchiveId),
  });
  blocks.push({ type: "actions", elements });

  return {
    // Bildirim önizlemesi ve erişilebilirlik için düz metin karşılığı.
    text: `Yeni Rakip Reklamı — ${input.brandName}: ${input.competitorName} (${dealerLine})`,
    blocks,
  };
}

/* -------------------------------------------------------------------------- */
/* Toplu bildirim (ilk tarama / ani artış)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tek taramada çok sayıda yeni reklam bulunduğunda kanalı boğmamak için
 * gönderilen özet mesaj. Reklamların hepsi bildirilmiş sayılır — bir daha
 * mesaj üretmezler.
 */
export function buildBurstMessage(input: {
  brandName: string;
  totalNewAds: number;
  byCompetitor: {
    competitorName: string;
    dealerName: string;
    dealerCity: string | null;
    count: number;
  }[];
}) {
  const detail = input.byCompetitor
    .slice(0, 20)
    .map(
      (row) =>
        `• *${row.competitorName}* — ${row.dealerName}${
          row.dealerCity ? ` · ${row.dealerCity}` : ""
        }: ${row.count} reklam`,
    )
    .join("\n");
  const rest =
    input.byCompetitor.length > 20
      ? `\n• … ve ${input.byCompetitor.length - 20} rakip daha`
      : "";

  return {
    text: `Yeni Rakip Reklamları — ${input.brandName}: ${input.totalNewAds} reklam`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🔴 ${input.totalNewAds} Yeni Rakip Reklamı — ${truncate(input.brandName, 80)}`,
          emoji: true,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Tek tarama içinde çok sayıda yeni reklam bulundu; kanalı boğmamak için tek mesajda özetlendi.",
          },
        ],
      },
      { type: "section", text: { type: "mrkdwn", text: detail + rest } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Reklam Akışını Aç" },
            url: `${env.appUrl}/ads`,
          },
        ],
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Haftalık özet                                                               */
/* -------------------------------------------------------------------------- */

export type DigestBrandSummary = {
  brandName: string;
  newAds: number;
  stoppedAds: { competitorName: string; dealerName: string; count: number }[];
  activeAds: number;
  competitorsMatched: number;
  competitorsPending: number;
  failedRuns: number;
};

export function buildWeeklyDigestMessage(input: {
  periodStart: Date;
  periodEnd: Date;
  brands: DigestBrandSummary[];
}) {
  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "📊 Haftalık Rakip Reklam Özeti",
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${formatTrDate(input.periodStart)} – ${formatTrDate(input.periodEnd)}`,
        },
      ],
    },
  ];

  if (input.brands.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_Aktif marka yok._" },
    });
  }

  for (const brand of input.brands) {
    const stoppedTotal = brand.stoppedAds.reduce((sum, s) => sum + s.count, 0);
    const lines = [
      `*${brand.brandName}*`,
      `• Yeni reklam: *${brand.newAds}*`,
      `• Duran reklam: *${stoppedTotal}*`,
      `• Şu an aktif: *${brand.activeAds}*`,
    ];
    if (brand.competitorsPending > 0) {
      lines.push(
        `• ⚠️ Eşleştirme bekleyen rakip: *${brand.competitorsPending}* (taranmıyor)`,
      );
    }
    if (brand.failedRuns > 0) {
      lines.push(`• 🚨 Başarısız tarama: *${brand.failedRuns}*`);
    }
    if (brand.stoppedAds.length > 0) {
      const detail = brand.stoppedAds
        .slice(0, 10)
        .map((s) => `   – ${s.competitorName} (${s.dealerName}): ${s.count}`)
        .join("\n");
      lines.push("• Duranlar:", detail);
      if (brand.stoppedAds.length > 10) {
        lines.push(`   – … ve ${brand.stoppedAds.length - 10} rakip daha`);
      }
    }
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Panoyu Aç" },
        url: `${env.appUrl}/`,
      },
    ],
  });

  return { text: "Haftalık Rakip Reklam Özeti", blocks };
}

/* -------------------------------------------------------------------------- */
/* Teknik alarm                                                                */
/* -------------------------------------------------------------------------- */

export function buildTechAlertMessage(input: {
  title: string;
  brandName?: string;
  runId?: number;
  detail: string;
}) {
  const lines = [`*${input.title}*`];
  if (input.brandName) lines.push(`Marka: ${input.brandName}`);
  if (input.runId) lines.push(`Tarama: #${input.runId}`);
  lines.push(input.detail);
  return {
    text: `🚨 ${input.title}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `🚨 ${lines.join("\n")}` },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Tarama Geçmişi" },
            url: `${env.appUrl}/runs`,
          },
        ],
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Gönderim                                                                    */
/* -------------------------------------------------------------------------- */

export type SlackPayload = { text: string; blocks?: unknown[] };

async function post(url: string, payload: SlackPayload): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok || body.trim() !== "ok") {
    throw new Error(
      `Slack gönderimi başarısız (${response.status}): ${body.slice(0, 300)}`,
    );
  }
}

export async function sendSlack(payload: SlackPayload): Promise<void> {
  await post(env.slackWebhookUrl, payload);
}

export async function sendSlackAlert(payload: SlackPayload): Promise<void> {
  await post(env.slackAlertWebhookUrl, payload);
}
