#!/usr/bin/env python3
"""
Исправляет поломанные скриптом add-lazy-loading.py и add-decoding-async.py случаи:
когда был `<img ... />` (self-closing), скрипт добавил loading= ПОСЛЕ />, ломая JSX.

Корректный путь: добавить атрибуты ДО слэша, т.е. `<img ... loading="lazy" decoding="async" />`.
"""
import re
from pathlib import Path

ROOT = Path("/home/z/my-project/src/components")

# Ищем паттерн: `/> loading="lazy" decoding="async">` — сломанный вариант
# Заменяем на: `loading="lazy" decoding="async" />`
# Также `/> loading="lazy">` → `loading="lazy" />`
def process(content: str) -> str:
    # Случай: `" / loading="lazy" decoding="async">` (пробел перед /)
    # Заменяем на: `" loading="lazy" decoding="async" />`
    content = re.sub(
        r'"\s*/\s*loading="lazy"\s*decoding="async">',
        '" loading="lazy" decoding="async" />',
        content
    )
    # Случай: `" / loading="lazy">`
    content = re.sub(
        r'"\s*/\s*loading="lazy">',
        '" loading="lazy" />',
        content
    )
    # Случай: `" / decoding="async">`
    content = re.sub(
        r'"\s*/\s*decoding="async">',
        '" decoding="async" />',
        content
    )
    return content

changed = 0
for f in ROOT.rglob("*.tsx"):
    original = f.read_text(encoding="utf-8")
    fixed = process(original)
    if fixed != original:
        f.write_text(fixed, encoding="utf-8")
        changed += 1
        print(f"✓ {f.relative_to(ROOT)}")
print(f"\nTotal: {changed} files fixed")
