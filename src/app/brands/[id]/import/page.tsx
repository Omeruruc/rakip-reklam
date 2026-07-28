import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { BrandNav } from "@/components/brand-nav";
import { requireSession } from "@/lib/auth";
import { getBrand, matchingCounts } from "@/server/queries";
import { ImportWizard } from "./import-wizard";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const brandId = Number.parseInt((await params).id, 10);
  const brand = await getBrand(brandId);
  if (!brand) notFound();
  const counts = await matchingCounts(brandId);

  return (
    <>
      <PageHeader
        title={`${brand.name} — Excel içe aktarma`}
        description="Yükle → kolon eşle → önizle → onayla. Önizleme aşamasında veritabanına hiçbir şey yazılmaz."
      />
      <BrandNav brandId={brandId} active="import" pendingMatch={counts.unverified} />
      <ImportWizard brandId={brandId} />
    </>
  );
}
