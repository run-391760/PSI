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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Ignored by browsers on plain-HTTP (local) origins; enforces HTTPS in production.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};
export default config;
