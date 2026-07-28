import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

/**
 * Inngest webhook uç noktası.
 *
 * Middleware bu yolu oturum kontrolünden muaf tutar; kimlik doğrulama
 * Inngest'in HMAC imzasıyla yapılır. Üretimde INNGEST_SIGNING_KEY tanımlı
 * olmak zorundadır (AC-11).
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
