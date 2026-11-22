import type { Metadata } from "next";
import { siteConfig } from "@/lib/site-config";

interface PublicRouteMetadataInput {
  path: string;
  title: string;
  description: string;
}

export function publicRouteMetadata({
  path,
  title,
  description,
}: PublicRouteMetadataInput): Metadata {
  const canonicalPath = path.startsWith("/") ? path : `/${path}`;
  const fullTitle = `${title} | ${siteConfig.name}`;
  return {
    title: fullTitle,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: fullTitle,
      description,
      url: canonicalPath,
      siteName: siteConfig.name,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
    },
    robots: { index: true, follow: true },
  };
}

export function noIndexRouteMetadata(title: string, description: string): Metadata {
  return {
    title: `${title} | ${siteConfig.name}`,
    description,
    robots: {
      index: false,
      follow: false,
      noarchive: true,
      googleBot: { index: false, follow: false, noimageindex: true },
    },
  };
}
