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
