import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { scrapeRuns } from "@/db/schema";

/**
 * Tüm denemeler tükendiğinde açıkta kalan `running` taramayı kapatır.
 * Kritik nokta: hiçbir reklam pasife alınmaz — veri asla otomatik silinmez.
 */
export async function markBrandRunsFailed(
  brandId: number,
  error: string,
): Promise<number | null> {
  const [openRun] = await db
    .select({ id: scrapeRuns.id })
    .from(scrapeRuns)
    .where(and(eq(scrapeRuns.brandId, brandId), eq(scrapeRuns.status, "running")))
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(1);

  if (!openRun) return null;

  await db
    .update(scrapeRuns)
    .set({
      status: "failed",
      error: error.slice(0, 2000),
      finishedAt: new Date(),
    })
    .where(eq(scrapeRuns.id, openRun.id));

  return openRun.id;
}
