import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BRAND_NAME } from "@/lib/brand";
import { SHARE_TITLE, SHARE_DESCRIPTION, SHARE_IMAGE_ALT, SHARE_IMAGE_URL, SITE_URL } from "@/lib/share-metadata";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: SHARE_TITLE,
  description: SHARE_DESCRIPTION,
  applicationName: BRAND_NAME,
  alternates: { canonical: SITE_URL.href },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: BRAND_NAME,
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    url: SITE_URL.href,
    images: [{ url: SHARE_IMAGE_URL, width: 960, height: 619, type: "image/jpeg", alt: SHARE_IMAGE_ALT }],
  },
  twitter: {
    card: "summary_large_image",
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    images: [{ url: SHARE_IMAGE_URL, alt: SHARE_IMAGE_ALT }],
  },
  appleWebApp: { capable: true, title: BRAND_NAME, statusBarStyle: "default" },
  icons: {
    icon: { url: "/share/favicon-32.png", type: "image/png", sizes: "32x32" },
    apple: { url: "/share/apple-icon-180.png", type: "image/png", sizes: "180x180" },
  },
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: "#ffffff", colorScheme: "light", interactiveWidget: "resizes-content",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
