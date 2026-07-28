"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { createBrand } from "@/server/actions";

export function BrandCreateForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Marka ekle</CardTitle>
        <CardDescription>
          Yeni marka aktif başlar ve günlük taramaya dahil edilir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            start(async () => {
              const result = await createBrand(formData);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setError(null);
              formRef.current?.reset();
              router.refresh();
            });
          }}
        >
          <div>
            <Label htmlFor="name">Marka adı</Label>
            <Input id="name" name="name" required placeholder="İşbir Yatak" />
          </div>
          {error ? (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <Button type="submit" variant="brand" disabled={pending}>
            {pending ? "Ekleniyor…" : "Ekle"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
