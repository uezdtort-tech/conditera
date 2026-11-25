import type { ReactNode } from "react";
import { noIndexRouteMetadata } from "@/lib/route-metadata";

export const metadata = noIndexRouteMetadata("Восстановление доступа", "Служебная страница управления доступом к аккаунту.");

export default function PrivateRouteLayout({ children }: { children: ReactNode }) {
  return children;
}
