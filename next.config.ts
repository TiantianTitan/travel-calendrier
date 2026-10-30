import type { NextConfig } from "next";
import { resolveSupabaseConfig } from "./src/lib/supabase-config";

// Reject partial/privileged overrides during the build instead of shipping a local-only app.
resolveSupabaseConfig(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "thumb.wikimedia.org", pathname: "/wikipedia/commons/thumb/**", search: "" }],
  },
};
export default config;
