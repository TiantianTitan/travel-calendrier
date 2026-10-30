import type { NextConfig } from "next";
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "thumb.wikimedia.org", pathname: "/wikipedia/commons/thumb/**", search: "" }],
  },
};
export default config;
