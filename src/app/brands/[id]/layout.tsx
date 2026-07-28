import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getBrand } from "@/server/queries";
import { AppShell } from "@/components/app-shell";

export default async function BrandLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const brandId = Number.parseInt(id, 10);
  if (!Number.isFinite(brandId)) notFound();
  const brand = await getBrand(brandId);
  if (!brand) notFound();

  return <AppShell active="/brands">{children}</AppShell>;
}
