#!/usr/bin/env python3
"""
Скрипт: добавляет loading="lazy" ко всем <img> тегам, у которых его ещё нет.
Пропускает img с priority или fetchPriority (LCP-изображения).
Пропускает img с src="/logo.png" / "/favicon.png" (UI-иконки, видны сразу).
"""
import re
import os
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project/src/components")
EXCLUDE_SRC_PATTERNS = ["/logo.png", "/favicon.png", "data:image/svg"]

def process_file(filepath: Path):
    content = filepath.read_text(encoding="utf-8")
    original = content

    # Регэксп для поиска <img ...> без loading=
    # match <img ... >  (не self-closing)
    img_pattern = re.compile(r'<img\b([^>]*)>', re.DOTALL)

    def add_lazy(match):
        attrs = match.group(1)
        # уже есть loading?
        if 'loading=' in attrs:
            return match.group(0)
        # есть priority или fetchPriority?
        if 'priority' in attrs or 'fetchPriority' in attrs:
            return match.group(0)
        # исключаем UI-иконки
        for excluded in EXCLUDE_SRC_PATTERNS:
            if excluded in attrs:
                return match.group(0)
        # добавляем loading="lazy" + decoding="async" для неблокирующего декодирования
        new_attrs = attrs.rstrip()
        if not new_attrs.endswith('"'):
            new_attrs = new_attrs + ' loading="lazy" decoding="async"'
        else:
            new_attrs = new_attrs + ' loading="lazy" decoding="async"'
        return f"<img{new_attrs}>"

    content = img_pattern.sub(add_lazy, content)

    if content != original:
        filepath.write_text(content, encoding="utf-8")
        return True
    return False

def main():
    changed = 0
    for tsx_file in ROOT.rglob("*.tsx"):
        if process_file(tsx_file):
            changed += 1
            print(f"✓ {tsx_file.relative_to(ROOT)}")
    print(f"\nTotal: {changed} files modified")

if __name__ == "__main__":
    main()
