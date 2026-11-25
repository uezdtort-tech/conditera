import type { ReactNode } from "react";
import { noIndexRouteMetadata } from "@/lib/route-metadata";

export const metadata = noIndexRouteMetadata("Оформление заказа", "Оформление и статус заказа доступны участникам заказа.");

export default function PrivateRouteLayout({ children }: { children: ReactNode }) {
  return children;
}
