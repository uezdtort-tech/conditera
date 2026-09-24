#!/usr/bin/env node
/**
 * scripts/reindex-meilisearch.ts
 *
 * Полная переиндексация товаров в Meilisearch.
 * Запуск:
 *   npx tsx scripts/reindex-meilisearch.ts
 *
 * Требует переменные окружения:
 *   - DATABASE_URL (или DIRECT_DATABASE_URL)
 *   - MEILISearch_URL
 *   - MEILI_MASTER_KEY
 */
import { config } from 'dotenv'
import { initMeilisearchIndexes, reindexAllProducts, isMeilisearchHealthy } from '../src/lib/meilisearch'

// Загружаем .env.local или .env.production
config({ path: '.env.local' })
config({ path: '.env.production' })

async function main() {
  console.log('🔍 Meilisearch reindex script')
  console.log('===============================')

  // Проверяем что Meilisearch доступен
  console.log('1. Checking Meilisearch health...')
  const healthy = await isMeilisearchHealthy()
  if (!healthy) {
    console.error('❌ Meilisearch is not available')
    console.error('   Check MEILISearch_URL and MEILI_MASTER_KEY in .env')
    process.exit(1)
  }
  console.log('   ✓ Meilisearch is healthy')

  // Инициализируем индексы
  console.log('2. Initializing indexes...')
  await initMeilisearchIndexes()
  console.log('   ✓ Indexes ready')

  // Переиндексация
  console.log('3. Reindexing products...')
  const count = await reindexAllProducts()
  console.log(`   ✓ Reindexed ${count} products`)

  console.log('')
  console.log('✅ Done! Search is ready.')
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Reindex failed:', err)
  process.exit(1)
})
