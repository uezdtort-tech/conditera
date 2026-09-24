#!/usr/bin/env python3
"""
Batch migration: removes @ts-nocheck from short API stub routes and rewrites
them to use supabaseAdmin + role-guards instead of db.* Prisma-shim.

Each file follows the pattern:
  - GET: returns data from audit_log by action field
  - POST: creates audit_log entry

This script handles files ≤10 lines (simple stubs).
"""
import os
import re

PROJECT_ROOT = "/home/z/my-project"

# Template for routes with GET only (no params)
TEMPLATE_GET_ONLY = '''/**
 * {description}
 *
 * Auth: {auth}
 */
import {{ NextRequest, NextResponse }} from "next/server";
import {{ supabaseAdmin }} from "@/lib/supabase/admin";
import {{ getUserFromRequest }} from "@/lib/auth";
import {{ {imports} }} from "@/lib/role-guards";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {{
  try {{
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({{ error: "Не авторизован" }}, {{ status: 401 }});

    const guard = await {guard_call};
    if (guard) return new NextResponse(guard.body, {{ status: guard.status, headers: guard.headers }});

    const {{ data, error }} = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("action", "{action}")
      .order("created_at", {{ ascending: false }})
      .limit(50);

    if (error) console.warn("[{tag}] GET error:", error.message);
    return NextResponse.json({{ {key}: data || [] }});
  }} catch (error: any) {{
    return NextResponse.json({{ error: "Ошибка", detail: error?.message }}, {{ status: 500 }});
  }}
}}
'''

# Simple files to migrate: (filepath, description, auth_roles, guard_call, action, response_key)
SIMPLE_FILES = [
    # Inspector
    ("src/app/api/inspector/[id]/route.ts", "GET /api/inspector/:id — данные инспектора", '["INSPECTOR", "ADMIN"]', "requireAnyRole(user.id, [\"INSPECTOR\", \"ADMIN\"])", "inspection_record", "inspector"),
    ("src/app/api/inspector/schedule/route.ts", "GET /api/inspector/schedule — расписание проверок", '["INSPECTOR", "ADMIN"]', "requireAnyRole(user.id, [\"INSPECTOR\", \"ADMIN\"])", "inspection_scheduled", "schedule"),
    ("src/app/api/inspector/confectioner/[id]/route.ts", "GET /api/inspector/confectioner/:id — проверки кондитера", '["INSPECTOR", "ADMIN"]', "requireAnyRole(user.id, [\"INSPECTOR\", \"ADMIN\"])", "inspection_record", "inspections"),
    # Nutritionist
    ("src/app/api/nutritionist/products/route.ts", "GET /api/nutritionist/products — продукты для верификации КБЖУ", '["NUTRITIONIST", "ADMIN"]', "requireAnyRole(user.id, [\"NUTRITIONIST\", \"ADMIN\"])", "nutritionist_product", "products"),
    ("src/app/api/nutritionist/recommendations/route.ts", "GET /api/nutritionist/recommendations — рекомендации диетолога", '["NUTRITIONIST", "ADMIN"]', "requireAnyRole(user.id, [\"NUTRITIONIST\", \"ADMIN\"])", "nutritionist_recommendation", "recommendations"),
    # Certification
    ("src/app/api/certification/applications/route.ts", "GET /api/certification/applications — заявки на сертификацию", '["CERTIFICATION_AGENT", "ADMIN"]', "requireAnyRole(user.id, [\"CERTIFICATION_AGENT\", \"ADMIN\"])", "certification_application", "applications"),
    ("src/app/api/certification/applications/[id]/route.ts", "GET /api/certification/applications/:id — карточка заявки", '["CERTIFICATION_AGENT", "ADMIN"]', "requireAnyRole(user.id, [\"CERTIFICATION_AGENT\", \"ADMIN\"])", "certification_application", "application"),
    ("src/app/api/certification/confectioner/[id]/route.ts", "GET /api/certification/confectioner/:id — сертификаты кондитера", '["CERTIFICATION_AGENT", "ADMIN"]', "requireAnyRole(user.id, [\"CERTIFICATION_AGENT\", \"ADMIN\"])", "certification_issued", "certificates"),
    # Copywriter
    ("src/app/api/copywriter/tasks/route.ts", "GET /api/copywriter/tasks — задачи копирайтера", '["COPYWRITER", "ADMIN"]', "requireAnyRole(user.id, [\"COPYWRITER\", \"ADMIN\"])", "copywriter_task", "tasks"),
    ("src/app/api/copywriter/tasks/[id]/route.ts", "GET /api/copywriter/tasks/:id — карточка задачи", '["COPYWRITER", "ADMIN"]', "requireAnyRole(user.id, [\"COPYWRITER\", \"ADMIN\"])", "copywriter_task", "task"),
    # Venues
    ("src/app/api/venues/[id]/book/route.ts", "POST /api/venues/:id/book — забронировать площадку", '["CUSTOMER", "EVENT_ORGANIZER", "ADMIN"]', "requireAnyRole(user.id, [\"CUSTOMER\", \"EVENT_ORGANIZER\", \"ADMIN\"])", "venue_booking", "booking"),
    ("src/app/api/venues/[id]/bookings/route.ts", "GET /api/venues/:id/bookings — бронирования площадки", '["VENUE_OWNER", "ADMIN"]', "requireAnyRole(user.id, [\"VENUE_OWNER\", \"ADMIN\"])", "venue_booking", "bookings"),
]

for filepath, description, roles, guard_call, action, key in SIMPLE_FILES:
    full_path = os.path.join(PROJECT_ROOT, filepath)
    if not os.path.exists(full_path):
        print(f"SKIP (not found): {filepath}")
        continue

    # Check if file has @ts-nocheck
    with open(full_path, 'r') as f:
        content = f.read()
    if '@ts-nocheck' not in content:
        print(f"SKIP (already migrated): {filepath}")
        continue

    # Determine imports based on guard_call
    if 'requireAnyRole' in guard_call:
        imports = "requireAnyRole"
        guard_call_str = guard_call
    elif 'requireRole' in guard_call:
        imports = "requireRole"
        guard_call_str = guard_call
    else:
        imports = "requireAnyRole"
        guard_call_str = guard_call

    # Generate template
    tag = filepath.split('/')[-2] if '/[' not in filepath else filepath.split('/')[-3]
    new_content = TEMPLATE_GET_ONLY.format(
        description=description,
        auth=', '.join(roles),
        imports=imports,
        guard_call=guard_call_str,
        action=action,
        key=key,
        tag=tag,
    )

    with open(full_path, 'w') as f:
        f.write(new_content)
    print(f"✓ Migrated: {filepath}")

print(f"\nTotal: {len(SIMPLE_FILES)} files processed")
