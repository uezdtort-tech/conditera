import type { ReactNode } from "react";
import { noIndexRouteMetadata } from "@/lib/route-metadata";

export const metadata = noIndexRouteMetadata("Вход и регистрация", "Авторизация пользователей платформы.");

export default function PrivateRouteLayout({ children }: { children: ReactNode }) {
  return children;
}
