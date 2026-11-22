import type { ReactNode } from "react";
import { noIndexRouteMetadata } from "@/lib/route-metadata";

export const metadata = noIndexRouteMetadata("Личный кабинет", "Личные данные и рабочие инструменты доступны только после входа.");

export default function PrivateRouteLayout({ children }: { children: ReactNode }) {
  return children;
}
