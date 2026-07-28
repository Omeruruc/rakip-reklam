"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "./ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          router.push("/login");
          router.refresh();
        })
      }
    >
      {pending ? "Çıkılıyor…" : "Çıkış"}
    </Button>
  );
}
