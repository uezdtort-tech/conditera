import { redirect } from "next/navigation";

/** Legacy public URL: the canonical services storefront is /services-shop. */
export default function ServicesLegacyRedirect(): never {
  redirect("/services-shop");
}
