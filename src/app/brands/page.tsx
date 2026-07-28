import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th, EmptyRow } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { listBrands } from "@/server/queries";
import { BrandCreateForm } from "./brand-create-form";
import { BrandActiveToggle } from "./brand-active-toggle";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  await requireSession();
  const rows = await listBrands();

  return (
    <AppShell active="/brands">
      <PageHeader
        title="Markalar"
        description="Her markanın kendi bayi–rakip listesi vardır. Tüm bildirimler tek Slack kanalına gider; marka adı mesaj başlığında yazar."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Marka</Th>
                <Th>Bayi</Th>
                <Th>Rakip (eşleşen/toplam)</Th>
                <Th>Aktif reklam</Th>
                <Th>Durum</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={6}>
                  Henüz marka yok. Sağdaki formdan ilk markayı ekleyin.
                </EmptyRow>
              ) : (
                rows.map((brand) => (
                  <tr key={brand.id}>
                    <Td>
                      <Link
                        href={`/brands/${brand.id}/competitors`}
                        className="font-medium hover:underline"
                      >
                        {brand.name}
                      </Link>
                    </Td>
                    <Td className="tabular-nums">{brand.dealerCount}</Td>
                    <Td className="tabular-nums">
                      {brand.matchedCount}/{brand.competitorCount}
                      {brand.pendingMatch > 0 ? (
                        <Link href={`/brands/${brand.id}/matching`}>
                          <Badge tone="warn" className="ml-2">
                            {brand.pendingMatch} bekliyor
                          </Badge>
                        </Link>
                      ) : null}
                    </Td>
                    <Td className="tabular-nums">{brand.activeAds}</Td>
                    <Td>
                      {brand.isActive ? (
                        <Badge tone="ok">Aktif · taranıyor</Badge>
                      ) : (
                        <Badge tone="neutral">Pasif</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <BrandActiveToggle
                          brandId={brand.id}
                          isActive={brand.isActive}
                        />
                        <Link
                          href={`/brands/${brand.id}/import`}
                          className="text-xs font-medium text-brand-500 hover:underline"
                        >
                          Excel
                        </Link>
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>

        <BrandCreateForm />
      </div>
    </AppShell>
  );
}
