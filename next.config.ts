// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // 👉 hierdoor faalt de build NIET meer op ESLint-fouten
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
