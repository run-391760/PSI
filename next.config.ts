import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  // NEXT_DEV_FS_CACHE=0 turns off Turbopack's on-disk dev cache (it can grow by gigabytes on low-disk machines).
  experimental: { turbopackFileSystemCacheForDev: process.env.NEXT_DEV_FS_CACHE !== "0" },
  serverExternalPackages: ["@electric-sql/pglite", "pg", "imapflow", "mailparser", "nodemailer"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Microphone allowed for this site only (inbox dictation); camera and location stay off.
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          // Ignored by browsers on plain-HTTP (local) origins; enforces HTTPS in production.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
  // CX pages that were removed or moved: old links and bookmarks land on their replacement (query kept).
  async redirects() {
    const to = (source: string, destination: string) => ({ source, destination, permanent: false });
    return [
      to("/cx/messages", "/cx/inbox"),
      to("/cx/search", "/cx/inbox"),
      to("/cx/mentions-tracker", "/cx/listening/platforms"),
      to("/cx/listening/dashboards", "/cx/listening/platforms"),
      to("/cx/listening/reviews", "/cx/listening/platforms"),
      to("/cx/listening/ugc", "/cx/listening/platforms"),
      to("/cx/quality/:path*", "/cx/settings/quality/:path*"),
      to("/cx/surveys/:path*", "/cx/settings/surveys/:path*"),
    ];
  },
};
export default config;
