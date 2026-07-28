"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setBrandActive } from "@/server/actions";

export function BrandActiveToggle({
  brandId,
  isActive,
}: {
  brandId: number;
  isActive: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setBrandActive(brandId, !isActive);
          router.refresh();
        })
      }
    >
      {isActive ? "Pasife al" : "Aktif et"}
    </Button>
  );
}
