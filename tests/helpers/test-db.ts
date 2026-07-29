import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@/db/schema";

/**
 * Bellek içi gerçek Postgres (PGlite).
 *
 * Neden: içe aktarma ve fark analizi mantığının doğruluğu UNIQUE kısıtlarına,
 * ON CONFLICT davranışına ve transaction'a bağlı. Bunlar taklit edilemez —
 * gerçek SQL ile denenmeleri gerekir.
 */
export const client = new PGlite();
export const testDb = drizzle(client, { schema });

let migrated = false;

/** drizzle-kit ile üretilmiş göç dosyalarını uygular. */
export async function migrate(): Promise<void> {
  if (migrated) return;
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8").replaceAll(
      "--> statement-breakpoint",
      "",
    );
    await client.exec(sql);
  }
  migrated = true;
}

/** Testler arasında tabloları boşaltır (kimlik sayaçları da sıfırlanır). */
export async function truncateAll(): Promise<void> {
  await client.exec(`
    truncate table sheet_syncs, notifications, ads, scrape_runs, competitors, dealers, brands
    restart identity cascade;
  `);
}
