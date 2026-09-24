#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
«Уездный кондитер» — анализ интеграции SimpleX Chat.
ReportLab generation script (Report pipeline).
"""
import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, NextPageTemplate, PageTemplate, Frame, BaseDocTemplate,
)
from reportlab.platypus.flowables import HRFlowable

# ===== Fonts =====
def safe_register(name, paths):
    for p in paths:
        if os.path.exists(p):
            try:
                pdfmetrics.registerFont(TTFont(name, p))
                return True
            except Exception:
                continue
    return False

safe_register("BodyFont", [
    "/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Regular.otf",
    "/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
])
safe_register("BodyFont-Bold", [
    "/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Bold.otf",
    "/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
])
safe_register("HeadFont", [
    "/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
])
safe_register("HeadFont-Bold", [
    "/usr/share/fonts/truetype/chinese/NotoSansSC-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
])
safe_register("MonoFont", ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"])

# ===== Palette =====
PAGE_BG       = colors.HexColor('#f2f2f1')
SECTION_BG    = colors.HexColor('#e9e9e7')
CARD_BG       = colors.HexColor('#eeede9')
TABLE_STRIPE  = colors.HexColor('#f3f2f0')
HEADER_FILL   = colors.HexColor('#71694e')
COVER_BLOCK   = colors.HexColor('#6a6042')
BORDER        = colors.HexColor('#dad4c3')
ICON          = colors.HexColor('#948042')
ACCENT        = colors.HexColor('#887029')
ACCENT_2      = colors.HexColor('#7155c6')
TEXT_PRIMARY  = colors.HexColor('#161614')
TEXT_MUTED    = colors.HexColor('#8d8b84')
SEM_SUCCESS   = colors.HexColor('#3f7351')
SEM_WARNING   = colors.HexColor('#ae8d4b')
SEM_ERROR     = colors.HexColor('#95423b')
SEM_INFO      = colors.HexColor('#547697')

# ===== Styles =====
styles = getSampleStyleSheet()
style_h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontName="HeadFont-Bold",
    fontSize=18, leading=24, textColor=HEADER_FILL, spaceBefore=18, spaceAfter=10, keepWithNext=1)
style_h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="HeadFont-Bold",
    fontSize=13, leading=18, textColor=COVER_BLOCK, spaceBefore=14, spaceAfter=6, keepWithNext=1)
style_h3 = ParagraphStyle("H3", parent=styles["Heading3"], fontName="HeadFont-Bold",
    fontSize=11, leading=15, textColor=ACCENT, spaceBefore=10, spaceAfter=4, keepWithNext=1)
style_body = ParagraphStyle("Body", parent=styles["BodyText"], fontName="BodyFont",
    fontSize=10, leading=14.5, textColor=TEXT_PRIMARY, spaceBefore=2, spaceAfter=6, alignment=0)
style_body_muted = ParagraphStyle("BodyMuted", parent=style_body,
    textColor=TEXT_MUTED, fontSize=9, leading=13)
style_code = ParagraphStyle("Code", parent=styles["Code"], fontName="MonoFont",
    fontSize=8.5, leading=11.5, textColor=TEXT_PRIMARY, backColor=TABLE_STRIPE,
    leftIndent=8, rightIndent=8, spaceBefore=4, spaceAfter=6,
    borderColor=BORDER, borderWidth=0.5, borderPadding=6)
style_bullet = ParagraphStyle("Bullet", parent=style_body,
    leftIndent=14, bulletIndent=2, spaceAfter=3)

def P(text, style=None): return Paragraph(text, style or style_body)
def B(text): return Paragraph(f"• {text}", style_bullet)
def H1(text): return Paragraph(text, style_h1)
def H2(text): return Paragraph(text, style_h2)
def H3(text): return Paragraph(text, style_h3)
def CODE(text):
    safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(f"<pre>{safe}</pre>", style_code)

def comparison_table(data, col_widths=None):
    if col_widths is None:
        col_widths = [28*mm, 32*mm, 32*mm, 32*mm, 32*mm]
    # First row = header
    rows = []
    for i, row in enumerate(data):
        rows.append([Paragraph(c, ParagraphStyle("cell", parent=style_body,
            fontSize=8.5, leading=11, textColor=TEXT_PRIMARY if i > 0 else colors.white,
            fontName="BodyFont-Bold" if i == 0 else "BodyFont")) for c in row])
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), HEADER_FILL),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, TABLE_STRIPE]),
        ("BOX", (0,0), (-1,-1), 0.5, BORDER),
        ("INNERGRID", (0,0), (-1,-1), 0.25, BORDER),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 4),
        ("RIGHTPADDING", (0,0), (-1,-1), 4),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ]))
    return t

def info_table(rows, col_widths=None):
    if col_widths is None:
        col_widths = [50*mm, 110*mm]
    data = []
    for k, v in rows:
        data.append([Paragraph(f"<b>{k}</b>", style_body), Paragraph(v, style_body)])
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (0,-1), TABLE_STRIPE),
        ("BOX", (0,0), (-1,-1), 0.5, BORDER),
        ("INNERGRID", (0,0), (-1,-1), 0.25, BORDER),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1), 6),
        ("RIGHTPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ]))
    return t

# ===== Cover =====
def draw_cover(canvas, doc):
    c = canvas
    c.saveState()
    c.setFillColor(colors.HexColor('#1f1d18'))
    c.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    # Accent bar
    c.setFillColor(ACCENT)
    c.rect(18*mm, A4[1] - 30*mm, 80*mm, 4*mm, fill=1, stroke=0)
    # Title
    c.setFillColor(colors.white)
    c.setFont("HeadFont-Bold", 26)
    c.drawString(18*mm, A4[1] - 60*mm, "SimpleX Chat")
    c.setFont("BodyFont", 14)
    c.setFillColor(colors.HexColor('#dad4c3'))
    c.drawString(18*mm, A4[1] - 70*mm, "Анализ интеграции в маркетплейс")
    c.drawString(18*mm, A4[1] - 77*mm, "«Уездный кондитер»")
    # Line
    c.setStrokeColor(ACCENT)
    c.setLineWidth(2)
    c.line(18*mm, A4[1] - 85*mm, 18*mm + 60*mm, A4[1] - 85*mm)
    # Meta
    c.setFont("BodyFont", 10)
    c.setFillColor(colors.HexColor('#948042'))
    c.drawString(18*mm, A4[1] - 100*mm, "Версия документа")
    c.setFillColor(colors.HexColor('#e9e9e7'))
    c.drawString(18*mm, A4[1] - 105*mm, "1.0  ·  2026-07-25")
    c.setFillColor(colors.HexColor('#948042'))
    c.drawString(18*mm, A4[1] - 115*mm, "Объект анализа")
    c.setFillColor(colors.HexColor('#e9e9e7'))
    c.drawString(18*mm, A4[1] - 120*mm, "SimpleX Chat v6.5.6 (stable)")
    c.drawString(18*mm, A4[1] - 125*mm, "github.com/simplex-chat/simplex-chat")
    c.setFillColor(colors.HexColor('#948042'))
    c.drawString(18*mm, A4[1] - 135*mm, "Цель")
    c.setFillColor(colors.HexColor('#e9e9e7'))
    c.drawString(18*mm, A4[1] - 140*mm, "Оценка пригодности SimpleX как замены")
    c.drawString(18*mm, A4[1] - 145*mm, "Socket.IO для чата маркетплейса")
    c.setFillColor(colors.HexColor('#948042'))
    c.drawString(18*mm, A4[1] - 155*mm, "Рекомендация")
    c.setFillColor(colors.white)
    c.setFont("HeadFont-Bold", 11)
    c.drawString(18*mm, A4[1] - 161*mm, "Дополнительный канал, не замена основному")
    c.drawString(18*mm, A4[1] - 167*mm, "Matrix (Synapse) — лучшая альтернатива")
    c.restoreState()

PAGE_W, PAGE_H = A4
MARGIN = 18*mm

def on_page(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 14*mm, PAGE_W - MARGIN, 14*mm)
    canvas.setFont("BodyFont", 8)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, 10*mm, "Уездный кондитер · SimpleX Chat анализ · v1.0")
    canvas.drawRightString(PAGE_W - MARGIN, 10*mm, f"Стр. {doc.page}")
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(1)
    canvas.line(MARGIN, PAGE_H - 12*mm, MARGIN + 30*mm, PAGE_H - 12*mm)
    canvas.restoreState()

def on_cover(canvas, doc):
    draw_cover(canvas, doc)

# ===== Build story =====
def build_story():
    story = []
    story.append(Spacer(1, 1))
    story.append(PageBreak())

    # === 1. Резюме ===
    story.append(H1("1. Резюме и рекомендация"))
    story.append(P(
        "SimpleX Chat — это децентрализованный E2E-мессенджер с уникальной архитектурой: "
        "в отличие от Signal, Matrix и Telegram, он не назначает пользователям никаких "
        "идентификаторов — даже случайных. Вместо центральных аккаунтов используются парные "
        "однонаправленные очереди сообщений на релейных SMP-серверах, которые можно "
        "развернуть в собственном Docker-контейнере. Аудиты Trail of Bits (2022 и 2024), "
        "инвестиции Jack Dorsey (август 2024) и активная разработка (v6.5.6 stable в июне "
        "2025, v7.0.0-beta в июле 2025) делают проект технологически зрелым."
    ))
    story.append(P(
        "Для маркетплейса «Уездный кондитер» вывод неоднозначный. SimpleX обеспечивает "
        "лучший в классе уровень приватности — E2E-шифрование Double Ratchet плюс "
        "пост-квантовый алгоритм CRYSTALS-Kyber, отсутствие центральных идентификаторов "
        "и поддержка self-hosting всех серверных компонентов. Однако принципиальная "
        "невозможность модерации переписки (E2E = админ не видит содержимое) делает "
        "SimpleX непригодным для замены текущего Socket.IO-чата, через который проходит "
        "основной поток сделок, споры по эскроу и общение с поддержкой."
    ))

    story.append(H2("Итоговая оценка"))
    story.append(comparison_table([
        ["Критерий", "SimpleX", "Matrix/Element", "Socket.IO (текущий)"],
        ["E2E-шифрование", "✓ Double Ratchet + PQ", "✓ Megolm+Olm", "✗ нет"],
        ["Модерация переписки", "✗ невозможна", "✓ опционально", "✓ полная"],
        ["Self-hosting", "✓ Docker, 1 ГБ RAM", "✓ тяжелее, 2-4 ГБ", "✓ ваш backend"],
        ["REST API", "✗ только WebSocket", "✓ REST + SDK", "✓ родной протокол"],
        ["Web-виджет для встраивания", "✗ нет", "✓ matrix-react-sdk", "✓ ваш frontend"],
        ["Лицензия", "AGPLv3", "Apache 2.0/AGPLv3", "MIT"],
        ["Совместимость с эскроу-спорами", "✗ нет", "✓ есть", "✓ есть"],
    ], col_widths=[42*mm, 38*mm, 38*mm, 42*mm]))
    story.append(Spacer(1, 4*mm))

    story.append(H2("Рекомендация"))
    story.append(P(
        "SimpleX не следует рассматривать как замену Socket.IO. Однако он отлично "
        "вписывается как <b>дополнительный приватный канал поддержки</b> для "
        "премиум-клиентов и B2B-сегмента, где конфиденциальность переговоров критична "
        "(корпоративные заказы на торты, оптовые поставки ингредиентов, оформление "
        "франшизы). В этом сценарии SimpleX работает параллельно с основным чатом — "
        "пользователь сам выбирает канал общения. Для полноценной замены Socket.IO с "
        "добавлением E2E и сохранением модерации <b>Matrix (Synapse) с matrix-react-sdk</b> "
        "технически подходит лучше, но требует существенно больших ресурсов (PostgreSQL, "
        "2-4 ГБ RAM) и более сложной эксплуатации."
    ))

    # === 2. Архитектура SimpleX ===
    story.append(PageBreak())
    story.append(H1("2. Архитектура SimpleX Chat"))

    story.append(H2("2.1. Принцип «без идентификаторов»"))
    story.append(P(
        "SimpleX — единственный мессенджер без каких-либо user ID. Вместо центральных "
        "аккаунтов используется парная адресация per-queue: каждое соединение между "
        "пользователями A и B создаёт две однонаправленные очереди (A→B и B→A) на "
        "SMP-сервере. В каждой очереди есть два адреса — для отправителя и получателя, "
        "плюс опционально третий адрес для push-уведомлений. Идентификаторы очередей "
        "генерируются сервером при создании и локальны для этого сервера."
    ))
    story.append(P(
        "Результат: даже если один и тот же профиль A связывается с B и с C, между этими "
        "каналами нет общих метаданных — B и C не смогут подтвердить, что общаются с "
        "одним и тем же человеком. Для n пользователей возможно до n·(n-1) очередей, что "
        "делает наблюдение графа связей на прикладном уровне вычислительно сложным. Это "
        "принципиально отличает SimpleX от Signal (где номер телефона = идентификатор) и "
        "Matrix (где Matrix ID @user:server виден всем участникам комнаты)."
    ))

    story.append(H2("2.2. Протокол SMP (Simplex Messaging Protocol)"))
    story.append(P(
        "SMP — клиент-серверный протокол передачи сообщений через релейные серверы. "
        "Спецификация открыта и опубликована. Протокол вдохновлён Redis serialization "
        "protocol, но проще: 10 клиентских команд (NEW, SUB, SEND, GET, ACK, OFF, DEL, "
        "SUSPEND, KEY, NID) и 8 серверных ответов. Передача идёт через TLS 1.2/1.3 с "
        "ALPN-переговорами (smp/1, xftp/1, http/1.1). Дополнительный слой блочного "
        "шифрования TSbChainKeys обеспечивает forward secrecy с блоком 16384 байта и "
        "паддингом против traffic analysis. Поддерживается tls-unique channel binding — "
        "каждая команда подписана ephemeral ключом очереди против replay-атак."
    ))
    story.append(P(
        "Критически важно для архитектуры: сервер хранит очередь и сообщения в памяти "
        "(по умолчанию) или в опциональном journal-логе. После доставки сообщения "
        "адресату оно удаляется с сервера. Это означает, что SimpleX-сервер не может "
        "служить архивом переписки — если пользователь потерял устройство и не сделал "
        "backup, история теряется безвозвратно. Для маркетплейса, где переписка может "
        "быть доказательством в споре по эскроу, это серьёзный риск."
    ))

    story.append(H2("2.3. Типы серверов: SMP, XFTP, NTF"))
    story.append(P(
        "Архитектура SimpleXMQ использует три независимых типа серверов, каждый из "
        "которых можно self-hostить отдельно:"
    ))
    story.append(info_table([
        ("SMP server", "Передача сообщений через simplex queues. Порт 5223 (TCP) с fallback на 443. Docker-образ simplexchat/smp-server. Реализация на Haskell, in-memory + опциональный journal-лог."),
        ("XFTP server", "Передача больших файлов (до 1 ГБ) chunked и E2E-шифрованных. Порт 443 (HTTP/2). Образ simplexchat/xftp-server. Файлы хранятся на диске."),
        ("NTF server", "Push-уведомления для iOS через APNs (iOS не разрешает фоновые сервисы). Образ управляется SimpleX, self-hosting с v6+. Уведомления E2E-шифрованы между NTF и устройством."),
        ("WebRTC STUN/TURN", "Установление P2P audio/video звонков. Сигналинг через SMP-сообщения, медиа-поток напрямую между пирами."),
    ]))
    story.append(Spacer(1, 4*mm))
    story.append(P(
        "Для маркетплейса минимальная конфигурация self-hosting — один SMP-сервер "
        "(сообщения) + один XFTP-сервер (файлы: фото тортов, сертификаты, документы). "
        "NTF-сервер нужен только если в аудитории есть пользователи iOS — для Android "
        "push работает через фоновый polling без Google Play Services."
    ))

    # === 3. Возможности чата ===
    story.append(H2("2.4. Возможности чата и E2E-шифрование"))
    story.append(P(
        "SimpleX использует Double Ratchet (как Signal) для E2E-шифрования с добавлением "
        "пост-квантового алгоритма CRYSTALS-Kyber с версии 5.6. Это означает защиту даже "
        "от будущего квантового компьютера, который может расшифровать записанный сегодня "
        "трафик (harvest now, decrypt later). Возможности чата включают: группы до "
        "примерно 1000 участников (large groups в активной разработке), файлы до 1 ГБ "
        "через XFTP, voice/video звонки 1-на-1 через WebRTC (групповые звонки пока не "
        "поддерживаются), read receipts, typing indicators, edit/delete сообщений, "
        "reactions, disappearing messages с настраиваемым TTL."
    ))
    story.append(P(
        "Особо стоит отметить business-адреса, добавленные в v6.2 (сентябрь 2024) — "
        "это отдельный тип контакта, при котором каждый клиент подключается к бизнесу "
        "через уникальный чат, но бизнес видит все обращения в едином интерфейсе. Это "
        "прямое соответствие сценарию «поддержка маркетплейса»: один профиль «Уездный "
        "кондитер», к которому клиенты подключаются через QR-код или #simplex-ссылку, "
        "а операторы поддержки отвечают из единого CLI или web-клиента."
    ))

    # === 4. API и интеграция ===
    story.append(PageBreak())
    story.append(H1("3. API и варианты интеграции"))

    story.append(H2("3.1. Архитектура интеграции: Bot API через WebSocket"))
    story.append(P(
        "У SimpleX нет REST/JSON-RPC API на стороне сервера. Вместо этого "
        "предоставляется Bot API — возможность подключиться к запущенному CLI-процессу "
        "simplex-chat через WebSocket и обмениваться командами в JSON-формате. Полный "
        "справочник команд занимает 43 КБ (2167 строк) и включает создание/удаление "
        "контактов, отправку сообщений, управление группами, приём файлов, настройку "
        "профилей. Этот подход называется «bot-мост»: backend маркетплейса запускает "
        "simplex-chat CLI в headless-режиме, подключается к нему по WebSocket и "
        "пересылает события во внутреннюю систему через HTTP webhook."
    ))
    story.append(P(
        "Архитектурно это означает, что в стеке маркетплейса появляется новый сервис — "
        "simplex-bridge. Он работает параллельно с web, chat-service (Socket.IO), db, "
        "redis, n8n и caddy. На входе simplex-bridge слушает WebSocket от simplex-chat "
        "CLI, на выходе отправляет HTTP-запросы в основной backend маркетплейса. "
        "Команды от backend к SimpleX идут в обратном направлении: HTTP от backend к "
        "simplex-bridge, затем WebSocket от bridge к CLI, затем SMP-протокол к "
        "SMP-серверу."
    ))

    story.append(H3("Пример bot-моста (TypeScript)"))
    story.append(CODE('''import WebSocket from "ws";
import axios from "axios";

const SIMPLEX_WS = "ws://localhost:5225";  // simplex-chat CLI
const BACKEND_WEBHOOK = "https://api.uyezdny.ru/simplex/incoming";

const ws = new WebSocket(SIMPLEX_WS);

ws.on("open", () => {
  console.log("[bridge] Connected to SimpleX CLI");
  ws.send(JSON.stringify({ corrId: "init-1", cmd: "/_users" }));
});

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.corrId) return;  // response, skip
  const resp = msg.resp;
  if (resp?.type === "newChatItems") {
    for (const item of resp.chatItems) {
      const text = item.chatInfo?.text;
      const fromContact = item.chatInfo?.chatInfo?.fromContact?.displayName;
      await axios.post(BACKEND_WEBHOOK, {
        from: fromContact, text,
        chatItemId: item.chatInfo?.chatItemId,
        timestamp: item.chatInfo?.meta?.itemTs,
      });
    }
  }
});

export async function sendToContact(contactName: string, text: string) {
  ws.send(JSON.stringify({
    corrId: `out-${Date.now()}`,
    cmd: `@${contactName} ${text}`,
  }));
}'''))

    story.append(H2("3.2. SDK и клиенты"))
    story.append(P(
        "Официальные SDK: TypeScript (пакет @simplex-chat/types, но в статусе deprecated "
        "— рекомендуется прямой WebSocket), Rust (community-порт). Python SDK официально "
        "нет, но возможно использовать любую WebSocket-библиотеку (websockets, "
        "websocket-client) с ручной сериализацией JSON-команд. Для интеграции в "
        "Next.js-приложение «Уездного кондитера» оптимально создать собственный "
        "модуль simplex-bridge на TypeScript, который будет работать как edge-сервис."
    ))
    story.append(P(
        "Критический нюанс: SimpleX не предоставляет web-клиента для встраивания в "
        "другие приложения. Пользователь маркетплейса должен установить отдельное "
        "приложение SimpleX (iOS, Android, desktop для macOS/Windows/Linux). Это "
        "снижает конверсию — далеко не каждый покупатель торта готов устанавливать "
        "незнакомый мессенджер ради общения с кондитером. В отличие от этого, "
        "matrix-react-sdk позволяет встроить чат непосредственно в web-интерфейс "
        "маркетплейса без установки сторонних приложений."
    ))

    # === 5. Лицензия и compliance ===
    story.append(PageBreak())
    story.append(H1("4. Лицензия, compliance, 152-ФЗ"))

    story.append(H2("4.1. AGPLv3 — что значит для коммерческого использования"))
    story.append(P(
        "SimpleX Chat распространяется под GNU AGPLv3 — самой сильной copyleft-лицензией. "
        "Ключевая особенность AGPL (отличие от GPL) — так называемый Affero clause: если "
        "вы модифицируете SimpleX и предоставляете к нему доступ через сеть (SaaS), вы "
        "обязаны предоставить исходный код модификаций всем пользователям этого сервиса. "
        "Однако это требование распространяется только на модификации самого SimpleX-кода."
    ))
    story.append(P(
        "Применительно к «Уездному кондитеру» это означает: self-hosting SMP/XFTP-серверов "
        "в стандартной конфигурации + использование simplex-chat CLI как чёрного ящика "
        "для бота через WebSocket не создаёт AGPL-обязательств для backend-кода "
        "маркетплейса. Bot-мост — отдельная программа, общается через протокол, не "
        "является derivative work. Но если вы решите форкнуть SimpleX-клиент с другим "
        "брендингом или модифицировать simplex-chat CLI с дополнительными функциями — "
        "обязаны открыть код модификаций под AGPLv3."
    ))

    story.append(H2("4.2. Совместимость с 152-ФЗ"))
    story.append(P(
        "152-ФЗ «О персональных данных» требует хранение ПДн граждан РФ в РФ, согласие "
        "на обработку, возможность удаления и защиту. SimpleX с маркетплейсом в принципе "
        "совместим и даёт уникальные преимущества, но не освобождает от регистрации БД "
        "ПДн для тех данных, которые маркетплейс собирает о пользователе (имя, телефон, "
        "заказы). Self-hosting SMP-сервера в РФ (Selectel, Yandex.Cloud) полностью "
        "удовлетворяет требованию о хранении ПДн в РФ. E2E-шифрование — лучший класс "
        "защиты переписки. Однако если использовать публичные smp*.simplex.im серверы — "
        "это передача данных за рубеж (Нидерланды/Финляндия), что требует отдельного "
        "согласия пользователя."
    ))

    # === 6. Риски ===
    story.append(H1("5. Риски для маркетплейса"))

    story.append(H2("5.1. Невозможность модерации"))
    story.append(P(
        "Главный риск: E2E-шифрование делает невозможной модерацию переписки. В текущей "
        "архитектуре Socket.IO операторы поддержки могут читать переписку, вмешиваться в "
        "спор по эскроу, выявлять мошеннические схемы (например, кондитер уговаривает "
        "покупателя перевести деньги напрямую в обход платформы). С SimpleX это "
        "технически невозможно — даже при судебном запросе сервер не сможет расшифровать "
        "переписку, потому что ключи хранятся только на устройствах участников."
    ))
    story.append(P(
        "Частичное решение: SimpleX с v6.2 поддерживает privacy-preserving content "
        "moderation в больших группах — пользователи могут пожаловаться на сообщение, "
        "и оно будет расшифровано и показано модератору. Но это работает только для "
        "групп, не для direct-чатов, и требует добровольного действия пользователя. "
        "Для маркетплейса, где основные споры возникают в direct-переписке «покупатель "
        "↔ кондитер», это не подходит."
    ))

    story.append(H2("5.2. Backup/restore и потеря доступа"))
    story.append(P(
        "SimpleX не имеет централизованного восстановления аккаунта — потому что "
        "аккаунта нет. Если пользователь потерял устройство и не сделал backup ключей, "
        "он теряет доступ ко всем своим чатам безвозвратно. Для маркетплейса это "
        "означает: покупатель, общавшийся с кондитером через SimpleX и потерявший "
        "телефон, не сможет продолжить переписку. Создастся новый контакт, история "
        "исчезнет. В сценарии эскроу-спора, когда переписка нужна как "
        "доказательство, это критично."
    ))
    story.append(P(
        "Решение: документировать для пользователей обязательность backup. SimpleX "
        "позволяет сделать зашифрованный backup-файл и сохранить его в облаке. Но "
        "это ответственность пользователя, и в реальности многие её не выполняют."
    ))

    story.append(H2("5.3. Дополнительные риски"))
    story.append(B("<b>Сложность UX.</b> Пользователь должен установить SimpleX-клиент. Это снижает конверсию — далеко не каждый покупатель торта готов устанавливать незнакомый мессенджер. Matrix с matrix-react-sdk позволяет встроить чат в web-интерфейс маркетплейса."))
    story.append(B("<b>Нет voice-сообщений в группах.</b> Group-звонки не поддерживаются — только 1-на-1. Если в будущем потребуется групповая видеоконференция (например, согласование многоярусного торта с дизайнером и кондитером одновременно), SimpleX не подойдёт."))
    story.append(B("<b>Зависимость от Haskell-инфраструктуры.</b> Серверы написаны на Haskell. Если потребуется deep-customization (не через конфиг, а через код), нужен Haskell-разработчик — это редкая специализация на рынке РФ."))
    story.append(B("<b>Нет официального Python SDK.</b> Для интеграции с backend на Python (если в будущем часть сервисов будет мигрирована) потребуется ручная реализация WebSocket-клиента или использование community-Rust-SDK через FFI."))

    # === 7. Сценарий интеграции ===
    story.append(PageBreak())
    story.append(H1("6. Рекомендуемый сценарий интеграции"))

    story.append(H2("6.1. Гибридная модель: Socket.IO + SimpleX"))
    story.append(P(
        "Рекомендуется не заменять Socket.IO, а добавить SimpleX как параллельный канал "
        "для премиум-сегмента. В дашборде пользователя появляется выбор канала общения "
        "с кондитером: «Стандартный чат» (Socket.IO, модерация, история на сервере) или "
        "«Приватный канал SimpleX» (E2E, без модерации, нужен SimpleX-клиент). Кондитер "
        "со своей стороны может подключить SimpleX-аккаунт к своему профилю — тогда в "
        "его карточке появится QR-код для подключения клиентов напрямую."
    ))
    story.append(P(
        "Такой подход даёт несколько преимуществ. Во-первых, не нарушается работа "
        "основного потока сделок и эскроу — они идут через Socket.IO с полной "
        "модерацией. Во-вторых, премиум-клиенты получают реальную приватность для "
        "конфиденциальных переговоров (корпоративные заказы, франшиза). В-третьих, "
        "кондитеры, работающие с B2B-сегментом, получают профессиональный канал связи "
        "без посредничества платформы — это может быть конкурентным преимуществом "
        "тарифа PREMIUM."
    ))

    story.append(H2("6.2. Архитектура гибридной модели"))
    story.append(P(
        "В docker-compose.yml добавляются два новых сервиса: smp-server (SimpleX "
        "Messaging Protocol server, порт 5223) и simplex-bridge (Node.js-процесс с "
        "simplex-chat CLI + bot-мост). SMP-сервер хранит очереди сообщений in-memory "
        "с опциональным journal-логом на volume smp_data. SimpleX-bridge подключается "
        "к CLI по WebSocket на локальном порту 5225 и пересылает события в основной "
        "backend через HTTP webhook на /api/simplex/incoming."
    ))
    story.append(P(
        "В Prisma-схему добавляется модель SimpleXContact с полями: id, userId "
        "(внешний ключ к User), simplexAddress (строка вида smp://fingerprint@host), "
        "contactProfileId (внешний ключ к Confectioner или Customer), createdAt. "
        "Эта модель связывает внутренний userId маркетплейса с SimpleX-контактом. "
        "Когда пользователь генерирует QR-код для подключения, создаётся запись в "
        "SimpleXContact; когда клиент подключается, bot-мост получает событие "
        "newChatItems и записывает chatItemId в ChatMessage как обычное сообщение "
        "типа simplex."
    ))

    story.append(H2("6.3. Этапы реализации"))
    story.append(info_table([
        ("Этап 1 (1-2 дня)", "Self-host SMP-сервер в Docker. Конфигурация через переменные окружения. Тестирование с официальными клиентами SimpleX (iOS, desktop). Получение #simplex-адреса."),
        ("Этап 2 (3-5 дней)", "Создание simplex-bridge сервиса. WebSocket-клиент к simplex-chat CLI. HTTP-webhook в backend. Сохранение входящих сообщений в БД через Prisma. Команды отправки ответов."),
        ("Этап 3 (2-3 дня)", "Интеграция в UI. Раздел «Приватный канал» в настройках профиля. QR-код для подключения клиентов. Список активных SimpleX-чатов в дашборде."),
        ("Этап 4 (2-3 дня)", "Документация для пользователей. Инструкция по установке SimpleX-клиента. Backup-стратегия. Уведомление о рисках E2E (нельзя восстановить переписку)."),
        ("Этап 5 (1-2 дня)", "Мониторинг. Healthcheck для SMP-сервера и simplex-bridge. Логирование событий. Alerting при недоступности."),
    ]))
    story.append(Spacer(1, 4*mm))

    story.append(H2("6.4. Альтернатива: Matrix (Synapse)"))
    story.append(P(
        "Если основная цель — не просто добавить приватный канал, а заменить Socket.IO "
        "на E2E-чат с сохранением модерации, рассмотрите Matrix (Synapse) + Element. "
        "Преимущества: REST Client-Server API, matrix-react-sdk для встраивания "
        "web-чата в маркетплейс, опциональное E2E (можно отключить для room, где нужна "
        "модерация), Python SDK (matrix-bot-sdk, asyncio), федерация. Недостатки: "
        "тяжелее self-host (PostgreSQL обязательно, 2-4 ГБ RAM), более сложная "
        "эксплуатация, медленнее чем SimpleX на equivalent-железе."
    ))
    story.append(P(
        "Для маркетплейса «Уездный кондитер» Matrix технически подходит лучше SimpleX "
        "как полная замена Socket.IO — но при этом существенно дороже в эксплуатации. "
        "Если цель — минимум усилий с максимальной приватностью, SimpleX как "
        "дополнительный канал предпочтительнее. Если цель — архитектурный рефакторинг "
        "чата с E2E и модерацией, Matrix + matrix-react-sdk — правильный выбор."
    ))

    # === 8. Вывод ===
    story.append(PageBreak())
    story.append(H1("7. Итоговый вывод"))

    story.append(P(
        "SimpleX Chat — технологически впечатляющий проект с уникальной архитектурой "
        "без идентификаторов и лучшим в классе E2E-шифрованием. Для маркетплейса "
        "«Уездный кондитер» он не подходит как замена Socket.IO, потому что "
        "невозможность модерации переписки вступает в противоречие с бизнес-моделью "
        "эскроу-платформы, где операторы должны иметь возможность разрешать споры и "
        "выявлять мошенничество. Также отсутствие web-клиента для встраивания снижает "
        "конверсию — покупатель торта не станет устанавливать отдельный мессенджер."
    ))
    story.append(P(
        "Однако SimpleX отлично вписывается как <b>дополнительный приватный канал</b> "
        "для премиум-клиентов и B2B-сегмента. Гибридная модель «Socket.IO + SimpleX» "
        "даёт пользователям выбор: стандартный чат с модерацией или приватный канал "
        "с E2E. Это конкурентное преимущество для тарифа PREMIUM и attractive-фича "
        "для корпоративных клиентов, заказывающих торты на мероприятия. Реализация "
        "займёт 9-15 рабочих дней (5 этапов), добавит в docker-compose два новых "
        "сервиса (smp-server, simplex-bridge) и одну модель в Prisma-схему "
        "(SimpleXContact)."
    ))
    story.append(P(
        "Если в перспективе планируется полная замена Socket.IO на E2E-чат с "
        "сохранением модерации, правильный кандидат — <b>Matrix (Synapse) с "
        "matrix-react-sdk</b>. Но это существенно больший проект: миграция существующих "
        "чатов, обучение операторов, переработка дашбордов. SimpleX в гибридной модели "
        "можно рассматривать как первый шаг к E2E-стратегии маркетплейса — он быстрее "
        "выводится в production и не требует миграции основного чата."
    ))

    story.append(H2("Сильные стороны SimpleX для маркетплейса"))
    story.append(B("Лучший в классе E2E: Double Ratchet + пост-квантовый CRYSTALS-Kyber (защита от harvest now, decrypt later)."))
    story.append(B("Self-hosting всех серверных компонентов в Docker (SMP, XFTP, NTF) — данные не покидают РФ."))
    story.append(B("Business-адреса (v6.2+) — единый профиль поддержки с отдельным чатом на каждого клиента."))
    story.append(B("AGPLv3 не затрагивает backend маркетплейса при использовании CLI/сервера как чёрного ящика."))
    story.append(B("Активная разработка (v7.0.0-beta в июле 2025), аудиты Trail of Bits, инвестиции Jack Dorsey."))

    story.append(H2("Слабые стороны для маркетплейса"))
    story.append(B("Невозможность модерации переписки — критично для эскроу-споров."))
    story.append(B("Нет web-клиента для встраивания — нужен отдельный SimpleX-клиент у пользователя."))
    story.append(B("Backup/restore полностью на пользователе — потеря устройства = потеря истории."))
    story.append(B("Нет REST API, только WebSocket к CLI — нестандартная интеграция."))
    story.append(B("Групповые звонки не поддерживаются — только 1-на-1."))

    return story

def main():
    out_path = "/home/z/my-project/download/simplex_chat_analysis.pdf"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    doc = BaseDocTemplate(
        out_path, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=20*mm, bottomMargin=18*mm,
        title="Уездный кондитер — SimpleX Chat анализ",
        author="Z.ai",
        subject="Анализ интеграции SimpleX Chat в маркетплейс",
        creator="Z.ai PDF Skill (Report pipeline)",
    )
    cover_frame = Frame(0, 0, PAGE_W, PAGE_H, showBoundary=0)
    cover_template = PageTemplate(id="cover", frames=[cover_frame], onPage=on_cover)
    body_frame = Frame(MARGIN, 18*mm, PAGE_W - 2*MARGIN, PAGE_H - 38*mm, showBoundary=0)
    body_template = PageTemplate(id="body", frames=[body_frame], onPage=on_page)
    doc.addPageTemplates([cover_template, body_template])

    story = build_story()
    story.insert(1, NextPageTemplate("body"))
    doc.build(story)

    size = os.path.getsize(out_path)
    print(f"Generated: {out_path} ({size/1024:.1f} KB)")

if __name__ == "__main__":
    main()
