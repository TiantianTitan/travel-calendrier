import { SHARED_SUPABASE_PROJECT } from "./supabase-project";

type PublicConfig = { url: string; key: string };

/** No environment configuration means this trip's shared project, never local mode. */
export function resolveSupabaseConfig(url?: string, key?: string): PublicConfig {
  const overrideUrl = url?.trim();
  const overrideKey = key?.trim();
  if (!overrideUrl && !overrideKey) return SHARED_SUPABASE_PROJECT;
  if (!overrideUrl || !overrideKey) throw new Error("Supabase URL and publishable key must be configured together.");

  let parsed: URL;
  try { parsed = new URL(overrideUrl); } catch { throw new Error("Invalid Supabase project URL."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:")) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("Supabase must use an HTTPS project URL (HTTP is allowed only for local development).");
  }
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(overrideKey);
  if (!publicKey) {
    try {
      const parts = overrideKey.split(".");
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      publicKey = parts.length === 3 && payload.role === "anon";
    } catch { /* A secret or malformed key must never reach a client bundle. */ }
  }
  if (!publicKey) throw new Error("Only a Supabase publishable key or legacy anon key is allowed in the browser.");
  return { url: parsed.origin, key: overrideKey };
}
