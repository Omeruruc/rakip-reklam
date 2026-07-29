/**
 * Rakip Reklam Takip tablosunun Google Sheets linkini Slack kanalına
 * gönderir ve PİNLER. Tek seferlik kurulum betiğidir — otomatik taramanın
 * bir parçası değildir.
 *
 * NEDEN AYRI BİR MEKANİZMA: Incoming Webhook (SLACK_WEBHOOK_URL) yalnızca
 * mesaj gönderebilir, pinleyemez. Pinlemek Slack'in Web API'sini ve bir
 * Bot Token'ı (xoxb-...) gerektirir. Kurulum adımları README §14'te.
 *
 * İdempotent: kanalda zaten bu Sheet'e linkleyen bir pin varsa hiçbir şey
 * yapmadan çıkar — betiği güvenle tekrar çalıştırabilirsiniz.
 *
 *   npx tsx scripts/pin-sheet-link.ts
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SLACK_API = "https://slack.com/api";

type SlackResponse = {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
  items?: { message?: { text?: string; ts?: string } }[];
};

async function slackCall(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SlackResponse> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return (await response.json()) as SlackResponse;
}

function explainError(error: string | undefined): string {
  switch (error) {
    case "not_in_channel":
      return (
        "Bot kanalın üyesi değil. Slack'te kanala gidip yazın: /invite @Rakip Reklam Takip\n" +
        "      (uygulamanızın adı farklıysa o adı kullanın)"
      );
    case "missing_scope":
      return (
        "Bot Token'da chat:write ve/veya pins:write kapsamı eksik.\n" +
        "      api.slack.com/apps → uygulamanız → OAuth & Permissions →\n" +
        "      Bot Token Scopes'a ekleyin → uygulamayı workspace'e YENİDEN yükleyin\n" +
        "      (yeniden yükleme yeni bir Bot Token üretir, .env.local'i güncelleyin)."
      );
    case "channel_not_found":
      return "SLACK_CHANNEL_ID yanlış. Kanal detaylarının altındaki 'Copy channel ID' ile alın.";
    case "invalid_auth":
    case "not_authed":
      return "SLACK_BOT_TOKEN geçersiz. xoxb- ile başlayan Bot User OAuth Token'ı kullanın.";
    default:
      return error ?? "bilinmeyen hata";
  }
}

async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  const sheetId = process.env.GOOGLE_SHEETS_ID;

  const missing = [
    !token && "SLACK_BOT_TOKEN",
    !channel && "SLACK_CHANNEL_ID",
    !sheetId && "GOOGLE_SHEETS_ID",
  ].filter(Boolean);

  if (missing.length > 0) {
    console.error(`Eksik ortam değişkeni: ${missing.join(", ")}`);
    console.error("Kurulum adımları için README §14'e bakın.");
    process.exit(1);
  }

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

  console.log("Kanal:", channel);
  console.log("Sheet:", sheetUrl);
  console.log("");

  // İdempotency: bu Sheet'e linkleyen bir pin zaten var mı?
  const pins = await slackCall("pins.list", token!, { channel });
  if (!pins.ok) {
    console.error(`pins.list başarısız: ${explainError(pins.error)}`);
    process.exit(1);
  }
  const already = pins.items?.some((item) =>
    item.message?.text?.includes(sheetId!),
  );
  if (already) {
    console.log("✅ Bu Sheet'e linkleyen bir pin zaten var. Değişiklik yapılmadı.");
    process.exit(0);
  }

  const text = `📋 *Rakip Reklam Takip Tablosu*\n${sheetUrl}\n\nHer yeni rakip reklamı bu tabloya otomatik satır olarak eklenir.`;

  const posted = await slackCall("chat.postMessage", token!, {
    channel,
    text,
    unfurl_links: true,
  });
  if (!posted.ok) {
    console.error(`chat.postMessage başarısız: ${explainError(posted.error)}`);
    process.exit(1);
  }

  const pinned = await slackCall("pins.add", token!, {
    channel: posted.channel,
    timestamp: posted.ts,
  });
  if (!pinned.ok) {
    console.error(`pins.add başarısız: ${explainError(pinned.error)}`);
    console.error("Mesaj gönderildi ama pinlenemedi; elle pinleyebilirsiniz.");
    process.exit(1);
  }

  console.log("✅ Mesaj gönderildi ve pinlendi.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
