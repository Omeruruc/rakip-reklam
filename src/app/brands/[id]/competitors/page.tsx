import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { BrandNav } from "@/components/brand-nav";
import { ScanButton } from "@/components/scan-button";
import { requireSession } from "@/lib/auth";
import type { MatchStatus } from "@/db/schema";
import {
  getBrand,
  listCities,
  listCompetitors,
  listDealers,
  matchingCounts,
} from "@/server/queries";
import { CompetitorsTable } from "./competitors-table";

export const dynamic = "force-dynamic";

const VALID_STATUSES: MatchStatus[] = [
  "unverified",
  "matched",
  "no_page",
  "ignored",
];

export default async function CompetitorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    city?: string;
    status?: string;
    active?: string;
    search?: string;
  }>;
}) {
  await requireSession();
  const brandId = Number.parseInt((await params).id, 10);
  const brand = await getBrand(brandId);
  if (!brand) notFound();

  const query = await searchParams;
  const status = VALID_STATUSES.includes(query.status as MatchStatus)
    ? (query.status as MatchStatus)
    : undefined;

  const [rows, cities, dealerRows, counts] = await Promise.all([
    listCompetitors(brandId, {
      city: query.city || undefined,
      matchStatus: status,
      onlyWithActiveAds: query.active === "1",
      search: query.search || undefined,
    }),
    listCities(brandId),
    listDealers(brandId),
    matchingCounts(brandId),
  ]);

  return (
    <>
      <PageHeader
        title={brand.name}
        description="Yalnızca “Eşleşti” durumundaki rakipler taranır."
        actions={<ScanButton brandId={brandId} />}
      />
      <BrandNav
        brandId={brandId}
        active="competitors"
        pendingMatch={counts.unverified}
      />
      <CompetitorsTable
        brandId={brandId}
        rows={rows}
        cities={cities}
        dealers={dealerRows.map((d) => ({
          id: d.id,
          name: d.name,
          city: d.city,
        }))}
        filters={{
          city: query.city ?? "",
          status: status ?? "",
          active: query.active === "1",
          search: query.search ?? "",
        }}
      />
    </>
  );
}
