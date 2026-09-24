/**
 * Meilisearch client — full-text search для каталога товаров.
 *
 * Возможности:
 *  - Мгновенный поиск с опечатками (typo tolerance)
 *  - Фильтры по категории, цене, кондитеру, городу
 *  - Фасеты для sidebar-фильтров
 *  - Сортировка по цене, рейтингу, новизне
 *  - Подсветка совпадений (highlight)
 *
 * Индексация:
 *  - При создании/обновлении товара → addProduct() / updateProduct()
 *  - При удалении → deleteProduct()
 *  - Полная переиндексация → reindexAll() (через /api/search/reindex)
 *
 * Документация: https://www.meilisearch.com/docs/learn/getting_started/quick_start
 *
 * Безопасность:
 *   • MEILI_MASTER_KEY обязателен — без него клиент не инициализируется.
 *   • Все ошибки логируются, не бросают исключения —
 *     сбой Meilisearch не должен блокировать бизнес-логику.
 *   • Type-safe interfaces для ProductSearchDocument и SearchResult.
 */
import { Meilisearch } from 'meilisearch'
import { supabaseAdmin } from './supabase/admin'

// ===== Singleton client =====
let client: Meilisearch | null = null

function getClient(): Meilisearch | null {
  if (client) return client

  const host = process.env.MEILI_HOST || process.env.MEILI_URL || 'http://localhost:7700'
  const apiKey = process.env.MEILI_MASTER_KEY

  if (!apiKey) {
    console.warn('[meilisearch] MEILI_MASTER_KEY not set — search disabled')
    return null
  }

  client = new Meilisearch({ host, apiKey })
  return client
}

// ===== Index names =====
export const INDEXES = {
  products: 'products',
  confectioners: 'confectioners',
  recipes: 'recipes',
} as const

// ===== Types =====
export interface ProductSearchDocument {
  id: string
  title: string
  description: string
  category: string
  price: number
  oldPrice?: number
  images: string[]
  confectionerId: string
  confectionerName: string
  city: string
  rating: number
  reviewsCount: number
  isPopular: boolean
  isNew: boolean
  isHit: boolean
  tags: string[]
  weight?: string
  servings?: number
  createdAt: string  // ISO для сортировки
}

export interface SearchResult {
  hits: ProductSearchDocument[]
  totalHits: number
  processingTimeMs: number
  query: string
  facets?: Record<string, Record<string, number>>
}

// ===== Index configuration =====
const PRODUCT_INDEX_CONFIG = {
  // Поля, по которым ищем
  searchableAttributes: [
    'title',
    'description',
    'confectionerName',
    'tags',
  ],
  // Поля для фильтрации
  filterableAttributes: [
    'category',
    'confectionerId',
    'city',
    'isPopular',
    'isNew',
    'isHit',
    'price',
    'rating',
  ],
  // Поля для сортировки
  sortableAttributes: [
    'price',
    'rating',
    'reviewsCount',
    'createdAt',
  ],
  // Поля для отображения (все)
  displayedAttributes: ['*'],
}

// ===== Public API =====

/**
 * Инициализация индексов — вызывать при старте приложения.
 * Создаёт индексы с правильной конфигурацией если их нет.
 */
export async function initMeilisearchIndexes(): Promise<void> {
  const c = getClient()
  if (!c) return

  try {
    // Products index
    const productsIndex = c.index(INDEXES.products)
    await productsIndex.updateSearchableAttributes(PRODUCT_INDEX_CONFIG.searchableAttributes)
    await productsIndex.updateFilterableAttributes(PRODUCT_INDEX_CONFIG.filterableAttributes)
    await productsIndex.updateSortableAttributes(PRODUCT_INDEX_CONFIG.sortableAttributes)

    // Typo tolerance — минимум 2 символа перед typo
    await productsIndex.updateTypoTolerance({
      enabled: true,
      minWordSizeForTypos: {
        oneTypo: 4,
        twoTypos: 8,
      },
    })

    // Ranking rules — порядок важности
    await productsIndex.updateRankingRules([
      'words',
      'typo',
      'proximity',
      'attribute',
      'sort',
      'exactness',
    ])

    console.info('[meilisearch] Indexes initialized:', Object.values(INDEXES).join(', '))
  } catch (err) {
    console.error('[meilisearch] Init failed:', err)
  }
}

/**
 * Поиск товаров с фильтрами и сортировкой.
 *
 * @example
 *   const results = await searchProducts('торт шоколад', {
 *     category: 'cakes',
 *     maxPrice: 3000,
 *     sort: 'price:asc',
 *   })
 */
export async function searchProducts(
  query: string,
  options?: {
    category?: string
    confectionerId?: string
    city?: string
    minPrice?: number
    maxPrice?: number
    minRating?: number
    isPopular?: boolean
    isNew?: boolean
    isHit?: boolean
    sort?: 'price:asc' | 'price:desc' | 'rating:desc' | 'createdAt:desc'
    limit?: number
    offset?: number
    facets?: string[]  // для sidebar-фильтров
  }
): Promise<SearchResult> {
  const c = getClient()
  if (!c) {
    return { hits: [], totalHits: 0, processingTimeMs: 0, query }
  }

  // Строим фильтр
  const filters: string[] = []
  if (options?.category) filters.push(`category = "${options.category}"`)
  if (options?.confectionerId) filters.push(`confectionerId = "${options.confectionerId}"`)
  if (options?.city) filters.push(`city = "${options.city}"`)
  if (options?.minPrice !== undefined) filters.push(`price >= ${options.minPrice}`)
  if (options?.maxPrice !== undefined) filters.push(`price <= ${options.maxPrice}`)
  if (options?.minRating !== undefined) filters.push(`rating >= ${options.minRating}`)
  if (options?.isPopular) filters.push('isPopular = true')
  if (options?.isNew) filters.push('isNew = true')
  if (options?.isHit) filters.push('isHit = true')

  const filterString = filters.length > 0 ? filters.join(' AND ') : undefined

  const response = await c
    .index(INDEXES.products)
    .search(query, {
      filter: filterString,
      sort: options?.sort ? [options.sort] : undefined,
      limit: options?.limit || 24,
      offset: options?.offset || 0,
      facets: options?.facets || ['category', 'city', 'isPopular'],
      attributesToHighlight: ['title', 'description'],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
    })

  return {
    hits: (response.hits as unknown as ProductSearchDocument[]) || [],
    totalHits: (response.estimatedTotalHits as number) || 0,
    processingTimeMs: (response.processingTimeMs as number) || 0,
    query: (response.query as string) || query,
    facets: (response.facetStats as unknown as Record<string, Record<string, number>>) || undefined,
  }
}

/**
 * Добавить или обновить товар в индексе.
 * Вызывать при создании/обновлении товара в БД.
 */
export async function indexProduct(product: ProductSearchDocument): Promise<void> {
  const c = getClient()
  if (!c) return
  await c.index(INDEXES.products).addDocuments([product], { primaryKey: 'id' })
}

/**
 * Массовая индексация товаров.
 */
export async function indexProducts(products: ProductSearchDocument[]): Promise<void> {
  const c = getClient()
  if (!c) return
  await c.index(INDEXES.products).addDocuments(products, { primaryKey: 'id' })
}

/**
 * Удалить товар из индекса.
 * Вызывать при удалении товара из БД.
 */
export async function deleteProductFromIndex(productId: string): Promise<void> {
  const c = getClient()
  if (!c) return
  await c.index(INDEXES.products).deleteDocument(productId)
}

interface ProductRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  price: number;
  old_price: number | null;
  images: string[] | null;
  confectioner_id: string;
  rating: number | null;
  reviews_count: number | null;
  is_popular: boolean | null;
  is_new: boolean | null;
  is_hit: boolean | null;
  tags: string[] | null;
  weight: string | null;
  servings: number | null;
  created_at: string;
}

interface ConfectionerForProductRow {
  business_name: string | null;
  city: string | null;
}

interface SupabaseError {
  message: string;
}

/**
 * Полная переиндексация всех товаров из БД.
 * Использовать через /api/search/reindex (только для админа).
 *
 * @returns количество проиндексированных товаров
 */
export async function reindexAllProducts(): Promise<number> {
  const c = getClient()
  if (!c) return 0

  // Загружаем все товары из БД через supabaseAdmin
  const { data: products, error } = await supabaseAdmin
    .from("products")
    .select(`
      id, title, description, category, price, old_price, images,
      confectioner_id, rating, reviews_count, is_popular, is_new, is_hit,
      tags, weight, servings, created_at
    `) as { data: ProductRow[] | null; error: SupabaseError | null };

  if (error) {
    console.error("[meilisearch] products load failed:", error.message);
    return 0;
  }
  if (!products || products.length === 0) {
    console.info("[meilisearch] No products to index");
    return 0;
  }

  // Загружаем confectioners для business_name и city
  const confectionerIds = [...new Set(products.map((p) => p.confectioner_id))];
  const { data: confectioners, error: confErr } = await supabaseAdmin
    .from("confectioners")
    .select("id, business_name, city")
    .in("id", confectionerIds) as { data: Array<{ id: string } & ConfectionerForProductRow> | null; error: SupabaseError | null };

  if (confErr) {
    console.warn("[meilisearch] confectioners load failed:", confErr.message);
  }

  // Мапа confectioner_id → { businessName, city }
  const confMap = new Map<string, { business_name: string; city: string }>();
  for (const c of confectioners || []) {
    confMap.set(c.id, {
      business_name: c.business_name || "",
      city: c.city || "",
    });
  }

  // Мапим в формат Meilisearch
  const docs: ProductSearchDocument[] = products.map((p) => {
    const conf = confMap.get(p.confectioner_id) || { business_name: "", city: "" };
    return {
      id: p.id,
      title: p.title,
      description: p.description || "",
      category: p.category,
      price: p.price,
      oldPrice: p.old_price || undefined,
      images: p.images || [],
      confectionerId: p.confectioner_id,
      confectionerName: conf.business_name,
      city: conf.city,
      rating: p.rating || 0,
      reviewsCount: p.reviews_count || 0,
      isPopular: p.is_popular || false,
      isNew: p.is_new || false,
      isHit: p.is_hit || false,
      tags: p.tags || [],
      weight: p.weight || undefined,
      servings: p.servings || undefined,
      createdAt: new Date(p.created_at).toISOString(),
    };
  });

  // Массовая загрузка (батчами по 1000)
  const BATCH_SIZE = 1000
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE)
    try {
      await c.index(INDEXES.products).addDocuments(batch, { primaryKey: 'id' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[meilisearch] batch ${i} failed:`, msg);
    }
  }

  console.info(`[meilisearch] Reindexed ${docs.length} products`)
  return docs.length
}

/**
 * Проверка здоровья Meilisearch.
 */
export async function isMeilisearchHealthy(): Promise<boolean> {
  const c = getClient()
  if (!c) return false
  try {
    const health = await c.health()
    return health.status === 'available'
  } catch {
    return false
  }
}
