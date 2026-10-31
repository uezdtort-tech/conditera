import { RecipesRoute } from '@/components/recipes-route';

// Next.js 15+: searchParams является Promise, нужно await
//
// Конвергенция рецептов: /recipes больше не идёт через store-косвенность
// RouteFallback (SSR которой отдавал HomePage из дефолтного store-view).
// RecipesRoute рендерит оболочку приложения и КАТАЛОГ РЕЦЕПТОВ напрямую —
// SSR отдаёт контент рецептов из реального API, а не hero главной.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const params = await searchParams;
  const id = params.id ? { id: params.id } : undefined;
  const view = id?.id ? ('recipe-detail' as const) : ('recipes' as const);
  return <RecipesRoute view={view} params={id} />;
}
