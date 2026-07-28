import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { competitors, dealers } from "@/db/schema";
import { collectDealers, parseRows } from "@/lib/excel";
import type {
  ColumnMapping,
  ImportPreview,
  ParsedRow,
} from "@/lib/excel-types";
import { REQUIRED_FIELDS } from "@/lib/excel-types";
import { loadSheet } from "@/lib/workbook";

/**
 * Excel içe aktarma.
 *
 * İki aşama:
 *  1. previewImport — HİÇBİR ŞEY YAZMAZ (AC-01). Sayıları hesaplar.
 *  2. commitImport  — tek transaction içinde upsert yapar.
 *
 * Değişmezler:
 *  - Onaylanmış Page ID'ler sıfırlanmaz (AC-03).
 *  - Dosyada olmayan kayıtlar SİLİNMEZ; kullanıcıya pasife alma önerilir.
 */

type ExistingDealer = {
  id: number;
  name: string;
  city: string | null;
  address: string | null;
};

type ExistingCompetitor = {
  id: number;
  dealerId: number;
  name: string;
  instagramHandle: string | null;
  fbPageId: string | null;
  matchStatus: string;
};

function trKey(value: string): string {
  return value.toLocaleLowerCase("tr").trim();
}

function assertMapping(mapping: ColumnMapping) {
  for (const field of REQUIRED_FIELDS) {
    if (mapping[field] === undefined || mapping[field] === null) {
      throw new Error(`Zorunlu kolon eşlenmedi: ${field}`);
    }
  }
}

async function loadExisting(brandId: number) {
  const existingDealers: ExistingDealer[] = await db
    .select({
      id: dealers.id,
      name: dealers.name,
      city: dealers.city,
      address: dealers.address,
    })
    .from(dealers)
    .where(eq(dealers.brandId, brandId));

  const dealerIds = existingDealers.map((d) => d.id);
  const existingCompetitors: ExistingCompetitor[] =
    dealerIds.length > 0
      ? await db
          .select({
            id: competitors.id,
            dealerId: competitors.dealerId,
            name: competitors.name,
            instagramHandle: competitors.instagramHandle,
            fbPageId: competitors.fbPageId,
            matchStatus: competitors.matchStatus,
          })
          .from(competitors)
          .where(inArray(competitors.dealerId, dealerIds))
      : [];

  return { existingDealers, existingCompetitors };
}

/** Rakip kimliği: önce Instagram handle, yoksa ad. */
function findCompetitor(
  pool: ExistingCompetitor[],
  dealerId: number,
  row: ParsedRow,
): ExistingCompetitor | undefined {
  if (row.instagramHandle) {
    const byHandle = pool.find(
      (c) =>
        c.dealerId === dealerId && c.instagramHandle === row.instagramHandle,
    );
    if (byHandle) return byHandle;
  }
  return pool.find(
    (c) => c.dealerId === dealerId && trKey(c.name) === trKey(row.competitorName),
  );
}

export type PlannedImport = {
  rows: ParsedRow[];
  preview: ImportPreview;
};

export async function previewImport(input: {
  brandId: number;
  buffer: Buffer;
  fileName: string;
  sheetName?: string;
  mapping: ColumnMapping;
}): Promise<ImportPreview> {
  assertMapping(input.mapping);

  const loaded = loadSheet(input.buffer, input.sheetName);
  const parsed = parseRows(loaded.matrix, input.mapping, loaded.headerRowIndex);
  const fileDealers = collectDealers(parsed.rows);
  const { existingDealers, existingCompetitors } = await loadExisting(
    input.brandId,
  );

  const dealerByKey = new Map(existingDealers.map((d) => [trKey(d.name), d]));

  let dealerCreate = 0;
  let dealerUpdate = 0;
  let dealerUnchanged = 0;
  const matchedDealerIds = new Set<number>();

  for (const dealer of fileDealers) {
    const existing = dealerByKey.get(trKey(dealer.name));
    if (!existing) {
      dealerCreate++;
      continue;
    }
    matchedDealerIds.add(existing.id);
    const changed =
      (dealer.city !== null && dealer.city !== existing.city) ||
      (dealer.address !== null && dealer.address !== existing.address) ||
      dealer.name !== existing.name;
    if (changed) dealerUpdate++;
    else dealerUnchanged++;
  }

  let competitorCreate = 0;
  let competitorUpdate = 0;
  let competitorUnchanged = 0;
  let matchPreserved = 0;
  let matchNeedsRecheck = 0;
  const matchedCompetitorIds = new Set<number>();

  for (const row of parsed.rows) {
    const dealer = dealerByKey.get(trKey(row.dealerName));
    if (!dealer) {
      // Bayi de yeni: rakip kesin oluşturulacak.
      competitorCreate++;
      continue;
    }
    const existing = findCompetitor(existingCompetitors, dealer.id, row);
    if (!existing) {
      competitorCreate++;
      continue;
    }
    matchedCompetitorIds.add(existing.id);
    if (existing.fbPageId) matchPreserved++;

    const handleChanged =
      row.instagramHandle !== null &&
      existing.instagramHandle !== null &&
      row.instagramHandle !== existing.instagramHandle;
    const nameChanged = row.competitorName !== existing.name;
    const handleFilled =
      row.instagramHandle !== null && existing.instagramHandle === null;

    if (handleChanged && existing.matchStatus === "matched") {
      matchNeedsRecheck++;
    }
    if (handleChanged || nameChanged || handleFilled) competitorUpdate++;
    else competitorUnchanged++;
  }

  const missingDealers = existingDealers
    .filter((d) => !matchedDealerIds.has(d.id))
    .map((d) => ({ id: d.id, name: d.name }));

  const dealerNameById = new Map(existingDealers.map((d) => [d.id, d.name]));
  const missingCompetitors = existingCompetitors
    .filter((c) => !matchedCompetitorIds.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      dealerName: dealerNameById.get(c.dealerId) ?? "—",
    }));

  return {
    token: loaded.fileHash,
    fileName: input.fileName,
    sheetName: loaded.sheetName,
    mapping: input.mapping,
    dealers: {
      create: dealerCreate,
      update: dealerUpdate,
      unchanged: dealerUnchanged,
    },
    competitors: {
      create: competitorCreate,
      update: competitorUpdate,
      unchanged: competitorUnchanged,
      matchPreserved,
      matchNeedsRecheck,
    },
    errors: parsed.errors,
    warnings: parsed.warnings,
    duplicateRows: parsed.duplicateRows,
    skippedBlankRows: parsed.skippedBlankRows,
    totalDataRows: parsed.rows.length,
    missing: { dealers: missingDealers, competitors: missingCompetitors },
    samples: parsed.rows.slice(0, 15),
  };
}

export type CommitResult = {
  dealersCreated: number;
  dealersUpdated: number;
  competitorsCreated: number;
  competitorsUpdated: number;
  matchNeedsRecheck: number;
  rowsProcessed: number;
  errors: number;
};

/**
 * Onaydan sonra tek transaction içinde upsert (§5).
 * Yeni rakipler `unverified` başlar ve taramaya dahil edilmez (AC-04).
 */
export async function commitImport(input: {
  brandId: number;
  buffer: Buffer;
  sheetName?: string;
  mapping: ColumnMapping;
  /** Önizlemedeki dosya parmak izi — dosya değiştiyse işlem reddedilir. */
  expectedToken?: string;
}): Promise<CommitResult> {
  assertMapping(input.mapping);

  const loaded = loadSheet(input.buffer, input.sheetName);
  if (input.expectedToken && input.expectedToken !== loaded.fileHash) {
    throw new Error(
      "Dosya önizlemeden sonra değişti. Lütfen yeniden yükleyip önizlemeyi tekrar onaylayın.",
    );
  }

  const parsed = parseRows(loaded.matrix, input.mapping, loaded.headerRowIndex);
  const fileDealers = collectDealers(parsed.rows);

  const result: CommitResult = {
    dealersCreated: 0,
    dealersUpdated: 0,
    competitorsCreated: 0,
    competitorsUpdated: 0,
    matchNeedsRecheck: 0,
    rowsProcessed: parsed.rows.length,
    errors: parsed.errors.length,
  };

  await db.transaction(async (tx) => {
    const existingDealerRows = await tx
      .select({
        id: dealers.id,
        name: dealers.name,
        city: dealers.city,
        address: dealers.address,
      })
      .from(dealers)
      .where(eq(dealers.brandId, input.brandId));

    const dealerIdByKey = new Map<string, number>();
    for (const dealer of existingDealerRows) {
      dealerIdByKey.set(trKey(dealer.name), dealer.id);
    }
    const existingDealerByKey = new Map(
      existingDealerRows.map((d) => [trKey(d.name), d]),
    );

    for (const dealer of fileDealers) {
      const key = trKey(dealer.name);
      const existing = existingDealerByKey.get(key);
      if (!existing) {
        const [inserted] = await tx
          .insert(dealers)
          .values({
            brandId: input.brandId,
            name: dealer.name,
            city: dealer.city,
            address: dealer.address,
          })
          .onConflictDoUpdate({
            target: [dealers.brandId, dealers.name],
            set: { updatedAt: new Date() },
          })
          .returning({ id: dealers.id });
        dealerIdByKey.set(key, inserted.id);
        result.dealersCreated++;
        continue;
      }

      // Boş gelen alan mevcut değeri ezmez.
      const nextCity = dealer.city ?? existing.city;
      const nextAddress = dealer.address ?? existing.address;
      if (nextCity !== existing.city || nextAddress !== existing.address) {
        await tx
          .update(dealers)
          .set({ city: nextCity, address: nextAddress, updatedAt: new Date() })
          .where(eq(dealers.id, existing.id));
        result.dealersUpdated++;
      }
    }

    const dealerIds = [...dealerIdByKey.values()];
    const existingCompetitors: ExistingCompetitor[] =
      dealerIds.length > 0
        ? await tx
            .select({
              id: competitors.id,
              dealerId: competitors.dealerId,
              name: competitors.name,
              instagramHandle: competitors.instagramHandle,
              fbPageId: competitors.fbPageId,
              matchStatus: competitors.matchStatus,
            })
            .from(competitors)
            .where(inArray(competitors.dealerId, dealerIds))
        : [];

    for (const row of parsed.rows) {
      const dealerId = dealerIdByKey.get(trKey(row.dealerName));
      if (!dealerId) continue; // olmaması gerekir; savunma amaçlı

      const existing = findCompetitor(existingCompetitors, dealerId, row);

      if (!existing) {
        const [inserted] = await tx
          .insert(competitors)
          .values({
            dealerId,
            name: row.competitorName,
            instagramHandle: row.instagramHandle,
            matchStatus: "unverified",
          })
          .onConflictDoNothing()
          .returning({ id: competitors.id });
        if (inserted) {
          existingCompetitors.push({
            id: inserted.id,
            dealerId,
            name: row.competitorName,
            instagramHandle: row.instagramHandle,
            fbPageId: null,
            matchStatus: "unverified",
          });
          result.competitorsCreated++;
        }
        continue;
      }

      const handleChanged =
        row.instagramHandle !== null &&
        existing.instagramHandle !== null &&
        row.instagramHandle !== existing.instagramHandle;
      const handleFilled =
        row.instagramHandle !== null && existing.instagramHandle === null;
      const nameChanged = row.competitorName !== existing.name;

      if (!handleChanged && !handleFilled && !nameChanged) continue;

      // Instagram değiştiyse onay yeniden alınır; fb_page_id SİLİNMEZ,
      // öneri olarak kalır. Onaylanmış eşleştirme asla sessizce kullanılmaz.
      const resetMatch = handleChanged && existing.matchStatus === "matched";
      if (resetMatch) result.matchNeedsRecheck++;

      await tx
        .update(competitors)
        .set({
          name: row.competitorName,
          instagramHandle: row.instagramHandle ?? existing.instagramHandle,
          updatedAt: new Date(),
          ...(resetMatch ? { matchStatus: "unverified" as const } : {}),
        })
        .where(eq(competitors.id, existing.id));

      existing.name = row.competitorName;
      existing.instagramHandle = row.instagramHandle ?? existing.instagramHandle;
      if (resetMatch) existing.matchStatus = "unverified";
      result.competitorsUpdated++;
    }
  });

  return result;
}

/** Dosyada bulunmayan kayıtları pasife alır — kullanıcı açıkça onaylarsa. */
export async function deactivateMissing(input: {
  brandId: number;
  dealerIds: number[];
  competitorIds: number[];
}): Promise<{ dealers: number; competitors: number }> {
  let dealersUpdated = 0;
  let competitorsUpdated = 0;

  await db.transaction(async (tx) => {
    if (input.dealerIds.length > 0) {
      const rows = await tx
        .update(dealers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(dealers.brandId, input.brandId),
            inArray(dealers.id, input.dealerIds),
          ),
        )
        .returning({ id: dealers.id });
      dealersUpdated = rows.length;
    }
    if (input.competitorIds.length > 0) {
      const rows = await tx
        .update(competitors)
        .set({ isActive: false, updatedAt: new Date() })
        .where(inArray(competitors.id, input.competitorIds))
        .returning({ id: competitors.id });
      competitorsUpdated = rows.length;
    }
  });

  return { dealers: dealersUpdated, competitors: competitorsUpdated };
}
