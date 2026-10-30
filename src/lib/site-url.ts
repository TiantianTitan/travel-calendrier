type SiteUrlEnvironment = Partial<Pick<NodeJS.ProcessEnv, "NEXT_PUBLIC_SITE_URL" | "VERCEL_PROJECT_PRODUCTION_URL" | "PORT">>;

function parseSiteOrigin(value: string, variable: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variable} must be an absolute HTTP(S) site URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${variable} must be an HTTP(S) site URL without credentials.`);
  }
  // This app is served at the origin root; do not carry copied query strings into metadata.
  return new URL(url.origin);
}

/** Prefer a configured public origin, then Vercel's stable production domain. */
export function getSiteUrl(environment: SiteUrlEnvironment = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  PORT: process.env.PORT,
}): URL {
  const configured = environment.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return parseSiteOrigin(configured, "NEXT_PUBLIC_SITE_URL");

  const production = environment.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return parseSiteOrigin(`https://${production}`, "VERCEL_PROJECT_PRODUCTION_URL");

  const port = environment.PORT && /^\d+$/.test(environment.PORT) && Number(environment.PORT) > 0 && Number(environment.PORT) <= 65535
    ? environment.PORT : "3000";
  return new URL(`http://localhost:${port}`);
}
