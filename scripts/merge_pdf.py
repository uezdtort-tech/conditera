# -*- coding: utf-8 -*-
"""Склеить cover.pdf + body.pdf в финальный документ с нормализацией к A4."""
import os, sys
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89  # A4 в поинтах

COVER = '/home/z/my-project/build/cover.pdf'
BODY = '/home/z/my-project/build/body.pdf'
OUTPUT = '/home/z/my-project/download/Uyezdnyy-Konditer-v2-Arkhitektura-rolevoy-ekosistemy.pdf'

def normalize_page_to_a4(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.3 or abs(h - A4_H) > 0.3:
        page.scale_to(A4_W, A4_H)
        # Принудительно установить mediabox в точный A4
        page.mediabox.lower_left = (0, 0)
        page.mediabox.upper_right = (A4_W, A4_H)
    return page

writer = PdfWriter()

# 1. Обложка как страница 1
cover_page = PdfReader(COVER).pages[0]
writer.add_page(normalize_page_to_a4(cover_page))

# 2. Тело документа — страницы 2..N
for page in PdfReader(BODY).pages:
    writer.add_page(normalize_page_to_a4(page))

# Метаданные
writer.add_metadata({
    '/Title': 'Уездный кондитер v2.0 — Архитектура ролевой экосистемы',
    '/Author': 'Z.ai',
    '/Subject': 'Техническая документация: дашборды, REST API, схема БД, CJM',
    '/Creator': 'Z.ai',
    '/Producer': 'Z.ai PDF Pipeline',
    '/Keywords': 'кондитерская платформа, маркетплейс, REST API, PostgreSQL, RBAC, CJM, 27 ролей',
})

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, 'wb') as f:
    writer.write(f)

size_kb = os.path.getsize(OUTPUT) / 1024
pages = len(PdfReader(OUTPUT).pages)
print(f'OK: final PDF at {OUTPUT}')
print(f'Pages: {pages}')
print(f'Size: {size_kb:.1f} KB')
