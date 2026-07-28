import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rakip Reklam Takip",
  description:
    "Rakiplerin Meta reklamlarını takip et, yeni kampanya başlayınca Slack'e haber ver.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
