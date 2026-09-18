"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { brands, competitors, dealers } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { extractInstagramHandle, extractPageId } from "@/lib/adlibrary";
import { searchFacebookPages, type PageCandidate } from "@/lib/apify";
import { inngest } from "@/inngest/client";
import {
  commitImport,
  deactivateMissing,
  previewImport,
} from "./import";
import type { ColumnMapping, ImportPreview } from "@/lib/excel-types";
import { buildSheetPreview, loadSheet } from "@/lib/workbook";
import type { SheetPreview } from "@/lib/excel-types";

/**
 * Tüm mutasyonlar. Her biri oturum kontrolüyle başlar — middleware'e ek
 * ikinci savunma hattı (AC-11).
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: message };
}

/* -------------------------------------------------------------------------- */
/* Markalar                                                                    */
/* -------------------------------------------------------------------------- */

export async function createBrand(
  formData: FormData,
): Promise<ActionResult<{ id: number }>> {
  await requireSession();
  const parsed = z
    .object({ name: z.string().trim().min(2, "Marka adı en az 2 karakter.") })
    .safeParse({ name: formData.get("name") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  try {
    const [brand] = await db
      .insert(brands)
      .values({ name: parsed.data.name })
      .returning({ id: brands.id });
    revalidatePath("/brands");
    revalidatePath("/");
    return { ok: true, data: { id: brand.id } };
  } catch (error) {
    if (String(error).includes("brands_name_unique")) {
      return { ok: false, error: "Bu isimde bir marka zaten var." };
    }
    return fail(error);
  }
}

export async function setBrandActive(
  brandId: number,
  isActive: boolean,
): Promise<ActionResult> {
  await requireSession();
  try {
    await db.update(brands).set({ isActive }).where(eq(brands.id, brandId));
    revalidatePath("/brands");
    revalidatePath("/");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Bayiler                                                                     */
/* -------------------------------------------------------------------------- */

const dealerSchema = z.object({
  name: z.string().trim().min(2, "Bayi adı en az 2 karakter."),
  city: z.string().trim().max(100).optional().nullable(),
  address: z.string().trim().max(1000).optional().nullable(),
});

export async function createDealer(
  brandId: number,
  formData: FormData,
): Promise<ActionResult> {
  await requireSession();
  const parsed = dealerSchema.safeParse({
    name: formData.get("name"),
    city: formData.get("city") || null,
    address: formData.get("address") || null,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  try {
    await db.insert(dealers).values({ brandId, ...parsed.data });
    revalidatePath(`/brands/${brandId}/dealers`);
    return { ok: true, data: undefined };
  } catch (error) {
    if (String(error).includes("dealers_brand_name_unique")) {
      return { ok: false, error: "Bu markada aynı isimli bayi zaten var." };
    }
    return fail(error);
  }
}

export async function updateDealer(
  dealerId: number,
  formData: FormData,
): Promise<ActionResult> {
  await requireSession();
  const parsed = dealerSchema.safeParse({
    name: formData.get("name"),
    city: formData.get("city") || null,
    address: formData.get("address") || null,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  try {
    const [row] = await db
      .update(dealers)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(dealers.id, dealerId))
      .returning({ brandId: dealers.brandId });
    if (row) revalidatePath(`/brands/${row.brandId}/dealers`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function setDealerActive(
  dealerId: number,
  isActive: boolean,
): Promise<ActionResult> {
  await requireSession();
  try {
    const [row] = await db
      .update(dealers)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(dealers.id, dealerId))
      .returning({ brandId: dealers.brandId });
    if (row) revalidatePath(`/brands/${row.brandId}/dealers`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Rakipler                                                                    */
/* -------------------------------------------------------------------------- */

export async function createCompetitor(
  brandId: number,
  formData: FormData,
): Promise<ActionResult> {
  await requireSession();

  const parsed = z
    .object({
      dealerId: z.coerce.number().int().positive("Bayi seçin."),
      name: z.string().trim().min(2, "Rakip adı en az 2 karakter."),
      instagram: z.string().trim().optional().nullable(),
    })
    .safeParse({
      dealerId: formData.get("dealerId"),
      name: formData.get("name"),
      instagram: formData.get("instagram") || null,
    });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const handle = extractInstagramHandle(parsed.data.instagram);
  if (parsed.data.instagram && !handle) {
    return {
      ok: false,
      error: "Instagram adresi çözümlenemedi. Örnek: instagram.com/kullanici",
    };
  }

  try {
    // Yeni rakip her zaman unverified başlar ve taranmaz (AC-04).
    await db.insert(competitors).values({
      dealerId: parsed.data.dealerId,
      name: parsed.data.name,
      instagramHandle: handle,
      matchStatus: "unverified",
    });
    revalidatePath(`/brands/${brandId}/competitors`);
    revalidatePath(`/brands/${brandId}/matching`);
    return { ok: true, data: undefined };
  } catch (error) {
    if (String(error).includes("competitors_dealer_handle_unique")) {
      return { ok: false, error: "Bu bayide aynı Instagram hesabı zaten kayıtlı." };
    }
    if (String(error).includes("competitors_dealer_name_unique")) {
      return { ok: false, error: "Bu bayide aynı isimli rakip zaten kayıtlı." };
    }
    return fail(error);
  }
}

export async function updateCompetitor(
  brandId: number,
  competitorId: number,
  formData: FormData,
): Promise<ActionResult> {
  await requireSession();

  const parsed = z
    .object({
      name: z.string().trim().min(2, "Rakip adı en az 2 karakter."),
      instagram: z.string().trim().optional().nullable(),
    })
    .safeParse({
      name: formData.get("name"),
      instagram: formData.get("instagram") || null,
    });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const handle = extractInstagramHandle(parsed.data.instagram);
  if (parsed.data.instagram && !handle) {
    return { ok: false, error: "Instagram adresi çözümlenemedi." };
  }

  try {
    const [existing] = await db
      .select({
        instagramHandle: competitors.instagramHandle,
        matchStatus: competitors.matchStatus,
      })
      .from(competitors)
      .where(eq(competitors.id, competitorId))
      .limit(1);

    // Instagram değiştiyse onaylı eşleştirme yeniden onaya düşer:
    // yanlış Page eşleşmesi sahte bildirim üretir (§10).
    const handleChanged =
      handle !== null &&
      existing?.instagramHandle !== null &&
      handle !== existing?.instagramHandle;
    const resetMatch = handleChanged && existing?.matchStatus === "matched";

    await db
      .update(competitors)
      .set({
        name: parsed.data.name,
        instagramHandle: handle,
        updatedAt: new Date(),
        ...(resetMatch ? { matchStatus: "unverified" as const } : {}),
      })
      .where(eq(competitors.id, competitorId));

    revalidatePath(`/brands/${brandId}/competitors`);
    revalidatePath(`/brands/${brandId}/matching`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function setCompetitorActive(
  brandId: number,
  competitorId: number,
  isActive: boolean,
): Promise<ActionResult> {
  await requireSession();
  try {
    await db
      .update(competitors)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(competitors.id, competitorId));
    revalidatePath(`/brands/${brandId}/competitors`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Page eşleştirme — sistemin tek manuel adımı                                 */
/* -------------------------------------------------------------------------- */

export async function confirmMatch(input: {
  brandId: number;
  competitorId: number;
  pageId: string;
  pageName?: string | null;
}): Promise<ActionResult> {
  const session = await requireSession();

  const pageId = extractPageId(input.pageId);
  if (!pageId) {
    return {
      ok: false,
      error:
        "Page ID okunamadı. Sayısal Page ID veya içinde view_all_page_id bulunan bir adres girin.",
    };
  }

  try {
    await db
      .update(competitors)
      .set({
        fbPageId: pageId,
        fbPageName: input.pageName ?? null,
        matchStatus: "matched",
        matchedBy: session.email,
        matchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(competitors.id, input.competitorId));

    revalidatePath(`/brands/${input.brandId}/matching`);
    revalidatePath(`/brands/${input.brandId}/competitors`);
    revalidatePath("/");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function setMatchStatus(input: {
  brandId: number;
  competitorId: number;
  status: "unverified" | "no_page" | "ignored";
}): Promise<ActionResult> {
  const session = await requireSession();
  try {
    await db
      .update(competitors)
      .set({
        matchStatus: input.status,
        matchedBy: session.email,
        matchedAt: new Date(),
        updatedAt: new Date(),
        // Eşleştirme geri alınabilir olmalı (§10): Page ID temizlenir.
        ...(input.status === "unverified" ? { fbPageId: null, fbPageName: null } : {}),
      })
      .where(eq(competitors.id, input.competitorId));

    revalidatePath(`/brands/${input.brandId}/matching`);
    revalidatePath(`/brands/${input.brandId}/competitors`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function findPageCandidates(
  competitorId: number,
): Promise<ActionResult<PageCandidate[]>> {
  await requireSession();
  try {
    const [competitor] = await db
      .select({
        name: competitors.name,
        instagramHandle: competitors.instagramHandle,
      })
      .from(competitors)
      .where(eq(competitors.id, competitorId))
      .limit(1);

    if (!competitor) return { ok: false, error: "Rakip bulunamadı." };

    // Ad ve handle ile iki ayrı arama; sonuçlar Page ID'ye göre teklenir.
    const queries = [competitor.name, competitor.instagramHandle].filter(
      (q): q is string => Boolean(q),
    );
    const results = await Promise.all(queries.map((q) => searchFacebookPages(q)));
    const byId = new Map<string, PageCandidate>();
    for (const list of results) {
      for (const candidate of list) {
        if (!byId.has(candidate.pageId)) byId.set(candidate.pageId, candidate);
      }
    }
    return { ok: true, data: [...byId.values()] };
  } catch (error) {
    return fail(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Tarama                                                                      */
/* -------------------------------------------------------------------------- */

export async function triggerScan(brandId: number): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const [brand] = await db
      .select({ isActive: brands.isActive })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1);
    if (!brand) return { ok: false, error: "Marka bulunamadı." };
    if (!brand.isActive) {
      return {
        ok: false,
        error: "Marka pasif — tarama tetiklenmedi. Önce markayı aktif edin.",
      };
    }

    await inngest.send({
      name: "brand/scan.requested",
      data: { brandId, trigger: "manual", requestedBy: session.email },
    });
    revalidatePath("/runs");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Excel içe aktarma                                                           */
/* -------------------------------------------------------------------------- */

const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function fileToBuffer(file: File): Promise<Buffer> {
  if (file.size === 0) throw new Error("Dosya boş.");
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Dosya 10 MB sınırını aşıyor.");
  }
  return Buffer.from(await file.arrayBuffer());
}

function parseMapping(raw: FormDataEntryValue | null): ColumnMapping {
  const parsed = z
    .object({
      dealerName: z.number().int().nonnegative(),
      competitorName: z.number().int().nonnegative(),
      city: z.number().int().nonnegative().optional(),
      address: z.number().int().nonnegative().optional(),
      instagram: z.number().int().nonnegative().optional(),
    })
    .safeParse(JSON.parse(String(raw ?? "{}")));
  if (!parsed.success) {
    throw new Error("Kolon eşlemesi geçersiz. Bayi ve rakip kolonlarını seçin.");
  }
  return parsed.data;
}

/** 1. adım: dosyayı oku, başlıkları ve önerilen eşlemeyi döndür. */
export async function inspectWorkbook(
  formData: FormData,
): Promise<ActionResult<SheetPreview>> {
  await requireSession();
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Dosya seçilmedi." };
    const sheetName = formData.get("sheetName");
    const loaded = loadSheet(
      await fileToBuffer(file),
      sheetName ? String(sheetName) : undefined,
    );
    return { ok: true, data: buildSheetPreview(loaded) };
  } catch (error) {
    return fail(error);
  }
}

/** 2. adım: önizleme. Veritabanına HİÇBİR ŞEY yazılmaz (AC-01). */
export async function previewImportAction(
  brandId: number,
  formData: FormData,
): Promise<ActionResult<ImportPreview>> {
  await requireSession();
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Dosya seçilmedi." };
    const sheetName = formData.get("sheetName");
    const preview = await previewImport({
      brandId,
      buffer: await fileToBuffer(file),
      fileName: file.name,
      sheetName: sheetName ? String(sheetName) : undefined,
      mapping: parseMapping(formData.get("mapping")),
    });
    return { ok: true, data: preview };
  } catch (error) {
    return fail(error);
  }
}

/** 3. adım: onay. Tek transaction içinde upsert. */
export async function commitImportAction(
  brandId: number,
  formData: FormData,
): Promise<ActionResult<Awaited<ReturnType<typeof commitImport>>>> {
  await requireSession();
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Dosya seçilmedi." };
    const sheetName = formData.get("sheetName");
    const token = formData.get("token");
    const result = await commitImport({
      brandId,
      buffer: await fileToBuffer(file),
      sheetName: sheetName ? String(sheetName) : undefined,
      mapping: parseMapping(formData.get("mapping")),
      expectedToken: token ? String(token) : undefined,
    });
    revalidatePath(`/brands/${brandId}/dealers`);
    revalidatePath(`/brands/${brandId}/competitors`);
    revalidatePath(`/brands/${brandId}/matching`);
    revalidatePath("/");
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** Dosyada olmayan kayıtları pasife al — yalnızca kullanıcı onaylarsa. */
export async function deactivateMissingAction(input: {
  brandId: number;
  dealerIds: number[];
  competitorIds: number[];
}): Promise<ActionResult<{ dealers: number; competitors: number }>> {
  await requireSession();
  try {
    const result = await deactivateMissing(input);
    revalidatePath(`/brands/${input.brandId}/dealers`);
    revalidatePath(`/brands/${input.brandId}/competitors`);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** Bir bayinin adını doğrulamak için — rakip formundaki bayi listesi. */
export async function listDealerOptions(
  brandId: number,
): Promise<{ id: number; name: string; city: string | null }[]> {
  await requireSession();
  return db
    .select({ id: dealers.id, name: dealers.name, city: dealers.city })
    .from(dealers)
    .where(and(eq(dealers.brandId, brandId), eq(dealers.isActive, true)))
    .orderBy(dealers.name);
}
