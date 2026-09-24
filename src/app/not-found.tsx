import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Home, Search } from "lucide-react";

/**
 * 404 — страница не найдена.
 *
 * Документация: https://nextjs.org/docs/app/api-reference/file-conventions/not-found
 */
export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="text-8xl font-display font-bold text-primary/30">404</div>
        <div>
          <h1 className="font-display text-2xl font-bold mb-2">
            Страница не найдена
          </h1>
          <p className="text-sm text-muted-foreground">
            Похоже, такой страницы не существует или она была перемещена.
            Возможно, ссылка устарела или содержит опечатку.
          </p>
        </div>
        <div className="flex gap-2 justify-center flex-wrap">
          <Button asChild>
            <Link href="/">
              <Home className="h-4 w-4 mr-1" />
              На главную
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/catalog">
              <Search className="h-4 w-4 mr-1" />
              В каталог
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
