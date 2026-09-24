import { RouteFallback } from '@/components/route-fallback';

// Next.js 15+: searchParams является Promise, нужно await
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ legal?: string }>;
}) {
  const params = await searchParams;
  const legal = params.legal ? { legal: params.legal } : undefined;
  return <RouteFallback view="about" params={legal} />;
}
