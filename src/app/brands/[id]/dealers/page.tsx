import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { BrandNav } from "@/components/brand-nav";
import { ScanButton } from "@/components/scan-button";
import { requireSession } from "@/lib/auth";
import { getBrand, listDealers, matchingCounts } from "@/server/queries";
import { DealersTable } from "./dealers-table";

export const dynamic = "force-dynamic";

export default async function DealersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const brandId = Number.parseInt((await params).id, 10);
  const brand = await getBrand(brandId);
  if (!brand) notFound();

  const [rows, counts] = await Promise.all([
    listDealers(brandId),
    matchingCounts(brandId),
  ]);

  return (
    <>
      <PageHeader
        title={brand.name}
        description="Bayiler ve her bayinin rakip sayısı."
        actions={<ScanButton brandId={brandId} />}
      />
      <BrandNav brandId={brandId} active="dealers" pendingMatch={counts.unverified} />
      <DealersTable brandId={brandId} rows={rows} />
    </>
  );
}
