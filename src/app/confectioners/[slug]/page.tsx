/**
 * /confectioners/[slug] — SEO-страница профиля кондитера.
 *
 * v3 ТЗ (Medium-12, sitemap SEO): sitemap ссылается на чистые URL
 * /confectioners/<slug> (query-URL не индексируются поисковиками).
 * Роут загружает профиль по slug из public.confectioners (migration 0017,
 * camelCase) через supabaseAdmin; RLS public SELECT допускает только
 * verified=true — здесь admin client нужен для NOT_FOUND до hydration.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ConfectionerPublic } from "@/lib/supabase/use-marketplace";
import type { Confectioner } from "@/lib/types";
import { ConfectionerSlugPage } from "@/components/pages/confectioner-slug-page";

export const revalidate = 60;

// Конвертация БД-строки → store-тип (синхронизировано с маппером в marquee)
function toConfectioner(c: ConfectionerPublic): Confectioner {
  return {
    id: c.id,
    userId: c.userId,
    businessName: c.businessName,
    slug: c.slug,
    description: c.description,
    avatar: c.avatar,
    cover: c.cover || undefined,
    location:
      (c.location as Confectioner["location"]) || {
        country: "Россия",
        region: "",
        city: c.city,
        district: "",
        street: "",
        house: "",
        apartment: "",
        postalCode: "",
        lat: 0,
        lng: 0,
      },
    city: c.city,
    rating: c.rating,
    reviewsCount: c.reviewsCount,
    ordersCount: c.ordersCount,
    verified: c.verified,
    trustLevel: (c.trustLevel as Confectioner["trustLevel"]) || "NEW",
    tariff: (c.tariff as Confectioner["tariff"]) || "START",
    legalInfo: {
      status: "NPD",
      npdRegisteredAt: c.joinedAt,
      documentsVerified: c.verified,
      verifiedAt: c.verified ? c.joinedAt : undefined,
    },
    taxMode: "NPD",
    specialization: c.specialization || [],
    portfolioImages: c.portfolioImages || [],
    followersCount: c.followersCount,
    responseTime: c.responseTime,
    joinedAt: c.joinedAt,
    selfPickup: c.selfPickup,
    deliveryOptions: (c.deliveryOptions as Confectioner["deliveryOptions"]) || ["own"],
  };
}

async function fetchConfectionerBySlug(slug: string): Promise<ConfectionerPublic | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("confectioners")
      .select("*")
      .eq("slug", slug)
      .eq("verified", true)
      .maybeSingle();
    if (error || !data) return null;
    return data as ConfectionerPublic;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const conf = await fetchConfectionerBySlug(slug);
  if (!conf) return { title: "Кондитер не найден" };
  return {
    title: `${conf.businessName}${conf.city ? `, ${conf.city}` : ""} — кондитер на «Уездном кондитере»`,
    description: conf.description?.slice(0, 160),
    alternates: { canonical: `/confectioners/${conf.slug}` },
  };
}

export default async function ConfectionerRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const conf = await fetchConfectionerBySlug(slug);
  if (!conf) notFound();
  return <ConfectionerSlugPage confectioner={toConfectioner(conf)} />;
}
