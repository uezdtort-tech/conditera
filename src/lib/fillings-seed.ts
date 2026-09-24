/**
 * DB seeding function for fillings — server-only, separate from client-safe fillings-data.ts.
 *
 * Заполняет таблицу fillings системными начинками (52 начинки из FILLINGS_SEED).
 * Запуск: bun run prisma/seed.ts или через API /api/fillings/seed (ADMIN only).
 *
 * Безопасность:
 *   • Использует supabaseAdmin (upsert по slug).
 *   • Все системные начинки получают status="APPROVED".
 *   • Idempotent — повторный запуск обновляет существующие записи.
 */
import { supabaseAdmin } from "./supabase/admin";
import { FILLINGS_SEED, type FillingSeed } from "./fillings-data";

interface SupabaseError {
  message: string;
}

export async function seedFillings(): Promise<void> {
  console.log("🌱 Заполнение базы начинок...");

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const filling of FILLINGS_SEED) {
    try {
      // Check if filling exists by slug
      const { data: existing, error: findErr } = await supabaseAdmin
        .from("fillings")
        .select("id")
        .eq("slug", filling.slug)
        .maybeSingle() as { data: { id: string } | null; error: SupabaseError | null };

      if (findErr) {
        console.warn(`⚠️  [seed] lookup failed for "${filling.name}":`, findErr.message);
        errors++;
        continue;
      }

      const fillingData = {
        name: filling.name,
        slug: filling.slug,
        description: filling.description,
        category: filling.category,
        allergens: filling.allergens,
        consistency: filling.consistency,
        color: filling.color,
        suggested_price_modifier: filling.suggestedPriceModifier,
        status: "APPROVED",
        created_by: null,
        created_by_name: "Системная начинка",
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        // Update existing
        const { error: updateErr } = await supabaseAdmin
          .from("fillings")
          .update(fillingData)
          .eq("id", existing.id);

        if (updateErr) {
          console.warn(`⚠️  [seed] update failed for "${filling.name}":`, updateErr.message);
          errors++;
        } else {
          updated++;
        }
      } else {
        // Create new
        const { error: insertErr } = await supabaseAdmin
          .from("fillings")
          .insert({
            ...fillingData,
            usage_count: 0,
            created_at: new Date().toISOString(),
          });

        if (insertErr) {
          console.warn(`⚠️  [seed] insert failed for "${filling.name}":`, insertErr.message);
          errors++;
        } else {
          created++;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`⚠️  [seed] error for "${filling.name}":`, msg);
      errors++;
    }
  }

  console.log(`✅ Заполнено начинок: создано ${created}, обновлено ${updated}, ошибок ${errors} (из ${FILLINGS_SEED.length})`);
}
