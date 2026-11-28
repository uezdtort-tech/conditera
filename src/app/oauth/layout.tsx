import type { ReactNode } from "react";
import { noIndexRouteMetadata } from "@/lib/route-metadata";

export const metadata = noIndexRouteMetadata("Завершение авторизации", "Служебный маршрут завершения OAuth-входа.");

export default function PrivateRouteLayout({ children }: { children: ReactNode }) {
  return children;
}
