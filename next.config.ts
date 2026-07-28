import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Meta CDN hosts for ad creatives. Links are time-limited; see README (soru 3).
    remotePatterns: [
      { protocol: "https", hostname: "**.fbcdn.net" },
      { protocol: "https", hostname: "**.cdninstagram.com" },
      { protocol: "https", hostname: "scontent.xx.fbcdn.net" },
    ],
  },
  serverExternalPackages: ["postgres", "xlsx"],
};

export default nextConfig;
