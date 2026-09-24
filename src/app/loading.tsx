/**
 * Loading UI для Next.js App Router.
 * Показывается когда Next.js Suspense ожидает загрузки контента.
 *
 * Документация: https://nextjs.org/docs/app/api-reference/file-conventions/loading
 */
export default function Loading() {
  return (
    <div
      className="min-h-[60vh] flex items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label="Загрузка страницы"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-10 w-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      </div>
    </div>
  );
}
