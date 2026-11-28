import { redirect } from "next/navigation";

/** Legacy public URL: the canonical product listing is /catalog. */
export default function ProductsLegacyRedirect(): never {
  redirect("/catalog");
}
