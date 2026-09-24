/**
 * П.24: Schema.org JSON-LD разметка для SEO.
 *
 * Добавляет структурированные данные, которые Google использует для:
 *  - Organization: сниппет с логотипом, контактами, соцсетями
 *  - Product: попадание в Google Shopping, рейтинг в сниппете
 *  - Recipe: расширенный сниппет с КБЖУ, временем приготовления
 *  - BreadcrumbList: хлебные крошки в выдаче
 *  - WebSite + SearchAction: sitelinks search box
 *
 * Компоненты — server components, отдают JSON-LD через <script type="application/ld+json">.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
import { siteConfig } from "./site-config";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || siteConfig.name;
const APP_LOGO = `${APP_URL}/logo.png`;

// ===== Organization =====
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: APP_NAME,
    alternateName: "Uezdny Konditer",
    url: APP_URL,
    logo: APP_LOGO,
    image: APP_LOGO,
    description:
      "Маркетплейс кондитерских изделий от частных кондитеров России. Конструктор тортов, безопасные платежи с эскроу, доставка.",
    foundingDate: "2024",
    email: "support@conditera.ru",
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        availableLanguage: ["Russian"],
        email: "support@conditera.ru",
      },
    ],
    sameAs: [
      "https://t.me/conditera_konditer",
      "https://vk.com/conditera_konditer",
    ],
    address: {
      "@type": "PostalAddress",
      addressCountry: "RU",
      addressLocality: "Москва",
    },
  };
}

// ===== WebSite + SearchAction (sitelinks search box) =====
export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: APP_NAME,
    url: APP_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${APP_URL}/catalog?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

// ===== Product =====
export interface ProductSchemaInput {
  id: string;
  title: string;
  description: string;
  price: number; // рубли
  image: string;
  category?: string;
  availability?: "inStock" | "outOfStock" | "preOrder";
  rating?: number;
  reviewCount?: number;
  confectionerName?: string;
  confectionerUrl?: string;
}

export function productJsonLd(p: ProductSchemaInput) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    description: p.description,
    image: p.image?.startsWith("http") ? p.image : `${APP_URL}${p.image}`,
    category: p.category,
    sku: p.id,
    brand: {
      "@type": "Brand",
      name: p.confectionerName || APP_NAME,
    },
    offers: {
      "@type": "Offer",
      url: `${APP_URL}/catalog?product=${p.id}`,
      priceCurrency: "RUB",
      price: p.price,
      availability: `https://schema.org/${p.availability || "InStock"}`,
      itemCondition: "https://schema.org/NewCondition",
      seller: p.confectionerUrl
        ? {
            "@type": "Organization",
            name: p.confectionerName,
            url: `${APP_URL}${p.confectionerUrl}`,
          }
        : { "@type": "Organization", name: APP_NAME, url: APP_URL },
    },
    ...(p.rating && p.reviewCount
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: p.rating,
            reviewCount: p.reviewCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

// ===== Recipe =====
export interface RecipeSchemaInput {
  title: string;
  description: string;
  image: string;
  prepTimeMin: number; // минуты
  cookTimeMin: number;
  totalTimeMin?: number;
  servings: number;
  ingredients: string[];
  steps: string[];
  category?: string;
  cuisine?: string;
  nutrition?: { calories?: number; protein?: number; fat?: number; carbohydrate?: number };
  authorName?: string;
  datePublished?: string;
}

export function recipeJsonLd(r: RecipeSchemaInput) {
  const toIsoDuration = (min: number) => `PT${min}M`;
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: r.title,
    description: r.description,
    image: r.image?.startsWith("http") ? r.image : `${APP_URL}${r.image}`,
    recipeCategory: r.category || "Десерт",
    recipeCuisine: r.cuisine || "Русская",
    prepTime: toIsoDuration(r.prepTimeMin),
    cookTime: toIsoDuration(r.cookTimeMin),
    totalTime: toIsoDuration(r.totalTimeMin || r.prepTimeMin + r.cookTimeMin),
    recipeYield: `${r.servings} порц.`,
    nutrition:
      r.nutrition && (r.nutrition.calories || r.nutrition.protein)
        ? {
            "@type": "NutritionInformation",
            calories: r.nutrition.calories ? `${r.nutrition.calories} kcal` : undefined,
            proteinContent: r.nutrition.protein ? `${r.nutrition.protein} g` : undefined,
            fatContent: r.nutrition.fat ? `${r.nutrition.fat} g` : undefined,
            carbohydrateContent: r.nutrition.carbohydrate ? `${r.nutrition.carbohydrate} g` : undefined,
          }
        : undefined,
    recipeIngredient: r.ingredients,
    recipeInstructions: r.steps.map((text, idx) => ({
      "@type": "HowToStep",
      position: idx + 1,
      text,
    })),
    author: {
      "@type": "Organization",
      name: r.authorName || APP_NAME,
    },
    datePublished: r.datePublished,
  };
}

// ===== BreadcrumbList =====
export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${APP_URL}${item.url}`,
    })),
  };
}

// ===== Хелпер: рендер JSON-LD как <script> =====
export function JsonLd({ data }: { data: object | object[] }) {
  const json = JSON.stringify(data);
  return (
    <script
      type="application/ld+json"
      // Данные генерируются на сервере из наших объектов — XSS невозможен,
      // но на всякий случай экранируем </script>
      dangerouslySetInnerHTML={{
        __html: json.replace(/</g, "\\u003c"),
      }}
    />
  );
}
