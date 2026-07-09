import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // yahoo-finance2 uses Node APIs — keep API routes on Node runtime
  serverExternalPackages: ["yahoo-finance2"],
};

export default nextConfig;
