import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["100.101.51.48", "minivlad", "minivlad.local"],
  experimental: {
    serverActions: {
      // Default 1MB is too low for image uploads; uploadDraftImage caps at 8MB.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
