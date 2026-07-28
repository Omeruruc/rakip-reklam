import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { BrandNav } from "@/components/brand-nav";
import { Stat } from "@/components/ui/card";
import { requireSession } from "@/lib/auth";
import { pageSearchActorId } from "@/lib/apify";
import { getBrand, listMatchingQueue, matchingCounts } from "@/server/queries";
import { MatchingList } from "./matching-list";

export const dynamic = "force-dynamic";

export default async function MatchingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const brandId = Number.parseInt((await params).id, 10);
  const brand = await getBrand(brandId);
  if (!brand) notFound();

  const [queue, counts] = await Promise.all([
    listMatchingQueue(brandId),
    matchingCounts(brandId),
  ]);

  return (
    <>
      <PageHeader
        title={`${brand.name} — Page eşleştirme`}
        description="Ad Library, Instagram değil Facebook Page temellidir. Bu ekran sistemin tek manuel adımı: her rakip için bir kerelik Page ID onayı verilir. Otomatik eşleştirme sahte pozitif ürettiği için onay insana bırakılmıştır."
      />
      <BrandNav brandId={brandId} active="matching" pendingMatch={counts.unverified} />

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Eşleştirme bekliyor"
          value={counts.unverified}
          tone={counts.unverified > 0 ? "warn" : "ok"}
          hint="Taranmıyor"
        />
        <Stat label="Eşleşti" value={counts.matched} tone="ok" hint="Taranıyor" />
        <Stat label="Sayfası yok" value={counts.no_page} />
        <Stat label="Yok sayıldı" value={counts.ignored} />
      </div>

      <MatchingList
        brandId={brandId}
        rows={queue}
        pageSearchEnabled={Boolean(pageSearchActorId())}
      />
    </>
  );
}
