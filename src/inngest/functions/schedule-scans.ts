import { eq } from "drizzle-orm";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { inngest } from "../client";

/**
 * Her gün 08:00 (TR) — aktif markaları listeler ve her biri için
 * bir tarama olayı yayınlar. Markalar birbirinden bağımsız çalışır;
 * biri hata alırsa diğerleri etkilenmez.
 */
export const scheduleScans = inngest.createFunction(
  { id: "schedule-scans", name: "Günlük taramaları planla" },
  { cron: "TZ=Europe/Istanbul 0 8 * * *" },
  async ({ step }) => {
    const activeBrands = await step.run("list-active-brands", async () =>
      db
        .select({ id: brands.id, name: brands.name })
        .from(brands)
        .where(eq(brands.isActive, true)),
    );

    if (activeBrands.length === 0) {
      return { scheduled: 0, note: "Aktif marka yok." };
    }

    await step.sendEvent(
      "request-brand-scans",
      activeBrands.map((brand) => ({
        name: "brand/scan.requested" as const,
        data: { brandId: brand.id, trigger: "cron" as const },
      })),
    );

    return {
      scheduled: activeBrands.length,
      brands: activeBrands.map((b) => b.name),
    };
  },
);
