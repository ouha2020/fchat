import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The development floating badge overlaps the mobile chat input. Runtime
  // and compilation error overlays remain enabled by Next.js.
  devIndicators: false,
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  images: {
    localPatterns: [
      { pathname: "/**", search: "" },
      { pathname: "/welcome-home-main.png", search: "?v=no-status-20260530" },
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
};

export default nextConfig;
