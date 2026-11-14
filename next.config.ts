import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Loaded from node_modules at runtime rather than bundled: pdf.js (via unpdf)
  // ships its own worker setup and @napi-rs/canvas is a native module.
  serverExternalPackages: ["unpdf", "@napi-rs/canvas", "js-tiktoken"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The library used to live at /library; it's the home page now, so keep old links working.
  async redirects() {
    return [{ source: "/library", destination: "/", permanent: true }];
  },
};

export default nextConfig;
