import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Göçler DIRECT_DATABASE_URL varsa onu kullanır.
 *
 * Supabase iki adres verir: uygulama sunucusuz ortamda "pooler" adresine
 * (port 6543, transaction mode) bağlanmalı; göçler ise doğrudan bağlantıyı
 * (port 5432) kullanmalı. Neon'da tek adres yeterlidir — o durumda bu değişken
 * tanımsız kalır ve DATABASE_URL kullanılır.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || "",
  },
  strict: true,
  verbose: true,
});
