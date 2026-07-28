"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { triggerScan } from "@/server/actions";

/** Elle tarama tetikleme — pilot sırasında beklemeden test etmek için. */
export function ScanButton({
  brandId,
  variant = "outline",
  label = "Şimdi tara",
}: {
  brandId: number;
  variant?: "outline" | "brand" | "default";
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await triggerScan(brandId);
            setMessage(
              result.ok
                ? "Tarama kuyruğa alındı."
                : `Hata: ${result.error}`,
            );
            router.refresh();
          })
        }
      >
        {pending ? "Gönderiliyor…" : label}
      </Button>
      {message ? <span className="text-xs muted">{message}</span> : null}
    </div>
  );
}
