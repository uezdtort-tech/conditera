#!/usr/bin/env python3
"""Добавляет decoding="async" ко всем <img>, у которых уже есть loading="lazy", но нет decoding."""
import re
from pathlib import Path

ROOT = Path("/home/z/my-project/src/components")

def process_file(filepath: Path):
    content = filepath.read_text(encoding="utf-8")
    original = content

    img_pattern = re.compile(r'<img\b([^>]*)>', re.DOTALL)

    def add_decoding(match):
        attrs = match.group(1)
        if 'decoding=' in attrs:
            return match.group(0)
        if 'loading=' not in attrs:
            return match.group(0)  # только для тех, у кого уже есть loading
        # добавляем decoding="async"
        new_attrs = attrs.rstrip()
        return f"<img{new_attrs} decoding=\"async\">"

    content = img_pattern.sub(add_decoding, content)
    if content != original:
        filepath.write_text(content, encoding="utf-8")
        return True
    return False

changed = 0
for f in ROOT.rglob("*.tsx"):
    if process_file(f):
        changed += 1
        print(f"✓ {f.relative_to(ROOT)}")
print(f"\nTotal: {changed} files modified")
