import { noIndexRouteMetadata } from "@/lib/route-metadata";

export function generateMetadata() {
  return noIndexRouteMetadata("Рецепты и мастер-классы", "Раздел рецептов находится в подготовке; демонстрационные материалы не индексируются.");
}

import { RouteFallback } from '@/components/route-fallback';

// Next.js 15+: searchParams является Promise, нужно await
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const params = await searchParams;
  const id = params.id ? { id: params.id } : undefined;
  const view = id?.id ? 'recipe-detail' : 'recipes';
  return <RouteFallback view={view} params={id} />;
}
