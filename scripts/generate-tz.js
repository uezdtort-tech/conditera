// generate-tz.js — Техническое задание «Уездный кондитер» v2.0 (Supabase migration)
// Формат: Word .docx, подробное ТЗ (~50 страниц)
// Стек: docx 9.5.1

const {
  Document, Packer, Paragraph, TextRun, Header, Footer,
  AlignmentType, HeadingLevel, PageNumber, PageBreak,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  TableOfContents, NumberFormat, LevelFormat, Tab, TabStopType, TabStopPosition,
  SectionType, convertInchesToTwip, VerticalAlign, HeightRule
} = require('docx');
const fs = require('fs');

// ===== Палитра (Corporate — confectionery warm) =====
const P = {
  primary: '#8B2942',      // deep berry (бренд)
  body: '#1F2937',         // slate-800
  secondary: '#6B7280',    // slate-500
  accent: '#D97706',       // amber-600 (мягкий акцент)
  light: '#FEF3C7',        // amber-50 (фон блоков)
  border: '#E5E7EB',       // slate-200
  white: '#FFFFFF',
  dark: '#1F2937',
};
const c = (hex) => hex.replace('#', '');

// ===== Шрифты =====
const FONT_BODY = { ascii: 'Calibri', eastAsia: 'Calibri', cs: 'Calibri' };
const FONT_HEADING = { ascii: 'Calibri', eastAsia: 'Calibri', cs: 'Calibri' };

// ===== Хелперы =====
function txt(text, opts = {}) {
  return new TextRun({
    text,
    size: opts.size || 22,
    bold: opts.bold || false,
    italics: opts.italics || false,
    color: opts.color || c(P.body),
    font: opts.font || FONT_BODY,
    break: opts.break || 0,
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    alignment: opts.align || AlignmentType.JUSTIFIED,
    indent: opts.indent !== undefined ? opts.indent : { firstLine: 480 },
    spacing: { line: 312, before: opts.before || 0, after: opts.after || 60 },
    children: typeof text === 'string' ? [txt(text, opts)] : text,
  });
}

function h1(text, opts = {}) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.LEFT,
    spacing: { before: 480, after: 240, line: 312 },
    pageBreakBefore: opts.pageBreak || false,
    children: [new TextRun({ text, bold: true, size: 36, color: c(P.primary), font: FONT_HEADING })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    alignment: AlignmentType.LEFT,
    spacing: { before: 360, after: 180, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: c(P.primary), font: FONT_HEADING })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    alignment: AlignmentType.LEFT,
    spacing: { before: 240, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, size: 24, color: c(P.dark), font: FONT_HEADING })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { line: 312, after: 60 },
    children: [txt(text)],
  });
}

function numbered(text, level = 0, ref = 'main-list') {
  return new Paragraph({
    numbering: { reference: ref, level },
    spacing: { line: 312, after: 60 },
    children: [txt(text)],
  });
}

function emptyP() {
  return new Paragraph({ children: [], spacing: { line: 312 } });
}

// ===== Таблицы =====
function tableCell(content, opts = {}) {
  const children = Array.isArray(content) ? content : [content];
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shading ? { type: ShadingType.CLEAR, color: 'auto', fill: c(opts.shading) } : undefined,
    margins: { top: 100, bottom: 100, left: 150, right: 150 },
    verticalAlign: VerticalAlign.CENTER,
    children: children.map(child =>
      typeof child === 'string'
        ? new Paragraph({
            alignment: opts.align || AlignmentType.LEFT,
            spacing: { line: 280 },
            children: [txt(child, { bold: opts.bold, size: opts.size || 20 })],
          })
        : child
    ),
  });
}

function tableRow(cells, opts = {}) {
  return new TableRow({
    tableHeader: opts.header || false,
    cantSplit: true,
    children: cells,
  });
}

function dataTable(headers, rows, widths) {
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headers.map((h, i) => tableCell(h, {
      width: widths ? widths[i] : undefined,
      shading: P.primary,
      bold: true,
      align: AlignmentType.CENTER,
      size: 20,
    })),
  });

  const dataRows = rows.map(row =>
    new TableRow({
      cantSplit: true,
      children: row.map((cell, i) => tableCell(cell, {
        width: widths ? widths[i] : undefined,
        size: 20,
      })),
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: c(P.border) },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: c(P.border) },
      left: { style: BorderStyle.SINGLE, size: 6, color: c(P.border) },
      right: { style: BorderStyle.SINGLE, size: 6, color: c(P.border) },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: c(P.border) },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: c(P.border) },
    },
  });
}

// ===== Callout (жёлтый блок) =====
function callout(title, text) {
  const cell = new TableCell({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: c(P.light) },
    margins: { top: 200, bottom: 200, left: 300, right: 300 },
    children: [
      new Paragraph({
        spacing: { line: 312, after: 100 },
        children: [new TextRun({ text: '⚠ ' + title, bold: true, size: 22, color: c(P.accent), font: FONT_BODY })],
      }),
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { line: 312 },
        children: [txt(text, { size: 20 })],
      }),
    ],
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ cantSplit: true, children: [cell] })],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: c(P.accent) },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: c(P.accent) },
      left: { style: BorderStyle.SINGLE, size: 8, color: c(P.accent) },
      right: { style: BorderStyle.SINGLE, size: 8, color: c(P.accent) },
      insideHorizontal: { style: BorderStyle.NONE, size: 0 },
      insideVertical: { style: BorderStyle.NONE, size: 0 },
    },
  });
}

// ===== COVER =====
function buildCover() {
  const titleCell = new TableCell({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: c(P.primary) },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      // empty top spacer
      ...Array(8).fill(0).map(() => new Paragraph({ children: [], spacing: { line: 312 } })),
      // eyebrow
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 312, after: 240 },
        indent: { left: 720, right: 720 },
        children: [new TextRun({ text: 'ТЕХНИЧЕСКОЕ ЗАДАНИЕ', size: 22, color: c(P.white), bold: true, font: FONT_HEADING, characterSpacing: 80 })],
      }),
      // main title
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 360, after: 200 },
        indent: { left: 720, right: 720 },
        children: [new TextRun({ text: '«Уездный кондитер»', size: 56, color: c(P.white), bold: true, font: FONT_HEADING })],
      }),
      // subtitle
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 312, after: 600 },
        indent: { left: 720, right: 720 },
        children: [new TextRun({ text: 'Маркетплейс кондитерских изделий', size: 24, color: c(P.white), italics: true, font: FONT_BODY })],
      }),
      // version
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 312, after: 120 },
        indent: { left: 720, right: 720 },
        children: [new TextRun({ text: 'Версия 2.0 — миграция на Supabase', size: 22, color: c(P.white), font: FONT_BODY })],
      }),
      ...Array(8).fill(0).map(() => new Paragraph({ children: [], spacing: { line: 312 } })),
    ],
  });

  const coverTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      cantSplit: true,
      height: { value: 14000, rule: HeightRule.EXACT },
      children: [titleCell],
    })],
    borders: {
      top: { style: BorderStyle.NONE, size: 0 },
      bottom: { style: BorderStyle.NONE, size: 0 },
      left: { style: BorderStyle.NONE, size: 0 },
      right: { style: BorderStyle.NONE, size: 0 },
      insideHorizontal: { style: BorderStyle.NONE, size: 0 },
      insideVertical: { style: BorderStyle.NONE, size: 0 },
    },
  });

  // bottom info block
  const infoCell = new TableCell({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: c(P.white) },
    margins: { top: 400, bottom: 400, left: 720, right: 720 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 312, after: 120 },
        children: [new TextRun({ text: 'ДОКУМЕНТ ТЗ v2.0', size: 20, color: c(P.secondary), bold: true, characterSpacing: 80 })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 312, after: 60 },
        children: [new TextRun({ text: 'Подробное техническое задание', size: 22, color: c(P.body), font: FONT_BODY })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 312, after: 60 },
        children: [new TextRun({ text: 'на реконструкцию проекта с переносом на self-hosted Supabase', size: 20, color: c(P.secondary), italics: true, font: FONT_BODY })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 312, before: 240 },
        children: [new TextRun({ text: 'Дата: 16 августа 2026', size: 20, color: c(P.body), font: FONT_BODY })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 312 },
        children: [new TextRun({ text: 'Срок реализации: 2 недели', size: 20, color: c(P.body), font: FONT_BODY })],
      }),
    ],
  });

  const infoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ cantSplit: true, children: [infoCell] })],
    borders: {
      top: { style: BorderStyle.NONE, size: 0 },
      bottom: { style: BorderStyle.NONE, size: 0 },
      left: { style: BorderStyle.NONE, size: 0 },
      right: { style: BorderStyle.NONE, size: 0 },
      insideHorizontal: { style: BorderStyle.NONE, size: 0 },
      insideVertical: { style: BorderStyle.NONE, size: 0 },
    },
  });

  return [coverTable, infoTable];
}

// ===== Содержание (TOC) =====
function buildToc() {
  return [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 480, after: 360, line: 312 },
      children: [new TextRun({ text: 'Содержание', bold: true, size: 36, color: c(P.primary), font: FONT_HEADING })],
    }),
    new TableOfContents('Содержание', {
      hyperlink: true,
      headingStyleRange: '1-3',
    }),
    new Paragraph({
      spacing: { line: 312 },
      children: [new TextRun({ text: ' ', italics: true, color: c(P.secondary), size: 18 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: 280, before: 120 },
      children: [new TextRun({
        text: '→ Правый клик по содержанию → «Обновить поле» для актуализации номеров страниц',
        italics: true,
        color: c(P.secondary),
        size: 18,
      })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// ===== ОСНОВНОЙ КОНТЕНТ =====
const content = [];

// --- 1. Резюме проекта ---
content.push(h1('1. Резюме проекта'));
content.push(p('Настоящее техническое задание описывает план полной реконструкции маркетплейса кондитерских изделий «Уездный кондитер» с переносом инфраструктуры на self-hosted Supabase. Документ учитывает все проблемы, выявленные в ходе эксплуатации предыдущей версии проекта, и предлагает архитектурные решения, устраняющие корневые причины сбоев.'));
content.push(p('Проект «Уездный кондитер» представляет собой многопользовательский маркетплейс, объединяющий конечных покупателей, домашних кондитеров, поставщиков ингредиентов, курьеров и администраторов. Платформа предоставляет инструменты для конструирования индивидуальных заказов (тортов по параметрам), каталога готовой продукции, системы согласования цен между покупателем и кондитером, онлайн-оплаты, доставки, а также полноценных личных кабинетов для каждой из пяти ролей пользователей.'));
content.push(p('Предыдущая версия проекта была построена на стеке Next.js 16 + Prisma 7 + PostgreSQL + PGlite (WASM-fallback) + Socket.IO + Redis + n8n + Meilisearch + SimpleX. Несмотря на функциональную полноту, реализованная архитектура столкнулась с системными проблемами: конфликты версий PostgreSQL volumes, нехватка оперативной памяти из-за PGlite WASM, каскадные ошибки при сборке из-за Proxy-обёртки над PrismaClient, сложность отладки 12 Docker-сервисов одновременно. Каждая попытка залатать одну проблему порождала новые сбои в связанных компонентах.'));

content.push(h2('1.1. Решение о迁移рации'));
content.push(p('После анализа корневых причин принято решение о переносе инфраструктуры на self-hosted Supabase — open-source платформу, предоставляющую PostgreSQL, Auth, Realtime, Storage и Edge Functions из единой инсталляции. Supabase устраняет необходимость в отдельных сервисах Socket.IO, Redis, n8n и PGlite, что сокращает количество Docker-контейнеров с 12 до 4 (Supabase stack + Next.js + Caddy + Telegram-бот).'));
content.push(p('Выбор в пользу self-hosted Supabase (а не cloud-версии) обусловлен требованиями полного контроля над данными, отсутствием зависимости от внешних лимитов и возможности размещения на собственном VPS. Деплой остаётся на том же сервере через единый docker-compose.yml, что упрощает эксплуатацию.'));

content.push(h2('1.2. Цели реконструкции'));
content.push(bullet('Полностью рабочая сборка проекта с первого запуска `docker compose up -d` без ручных правок.'));
content.push(bullet('Сохранение всего функционала предыдущей версии (26 страниц, 58 API endpoints, 127 моделей БД) без урезаний.'));
content.push(bullet('Сокращение количества Docker-сервисов с 12 до 4 за счёт замены Socket.IO, Redis, n8n, Meilisearch на Supabase Realtime, Scheduled Functions, FTS.'));
content.push(bullet('Устранение OOM-падений (Out of Memory) при сборке и запуске через отказ от PGlite WASM-fallback.'));
content.push(bullet('Гибридная миграция данных: старая БД остаётся для чтения исторических данных, новая Supabase Postgres принимает все новые записи.'));
content.push(bullet('Автоматизированная проверка каждого модуля: unit-тесты, e2e-тесты, health-check скрипт, ручное тестирование и скриншоты как доказательство работы.'));

content.push(h2('1.3. Сроки и этапы'));
content.push(p('Общий срок реализации — 14 календарных дней (2 недели). План разбит на 7 этапов по 2 дня каждый, с обязательной верификацией после каждого этапа. Подробный календарный план представлен в разделе 11.'));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 2. Текущее состояние и проблемы ---
content.push(h1('2. Текущее состояние и проблемы'));

content.push(h2('2.1. Что было реализовано в v1.0'));
content.push(p('В предыдущей версии проекта был реализован значительный объём функционала. Ниже приведён краткий перечень того, что существовало в кодовой базе до начала реконструкции:'));

content.push(h3('2.1.1. Архитектура и инфраструктура'));
content.push(bullet('Next.js 16.1.3 с Turbopack, App Router, standalone build для Docker.'));
content.push(bullet('Prisma 7.9.1 с динамической Proxy-обёрткой над PrismaClient для поддержки PostgreSQL и PGlite одновременно.'));
content.push(bullet('PostgreSQL 16-alpine → 18-alpine в Docker Compose, с PgBouncer как пулером соединений.'));
content.push(bullet('Redis 7 для сессий, rate-limiting и Socket.IO adapter.'));
content.push(bullet('Meilisearch v1.12 для полнотекстового поиска по каталогу.'));
content.push(bullet('Socket.IO chat-сервис на отдельном Node.js сервере (порт 3030).'));
content.push(bullet('n8n для автоматизаций (брошенная корзина, дайджесты, сгорание бонусов).'));
content.push(bullet('SimpleX SMP server для E2E-чата premium-пользователей.'));
content.push(bullet('Mailu для self-hosted почты (опционально).'));
content.push(bullet('Caddy 2.8 как reverse proxy с авто-HTTPS.'));
content.push(bullet('Cloudflare Tunnel для доступа к серверу без публичного IP.'));

content.push(h3('2.1.2. Бизнес-логика'));
content.push(bullet('127 моделей в Prisma schema (3 326 строк): пользователи, роли, продукты, заказы, платежи, отзывы, тикеты, лиды, переговоры, рецепты, календарь, склад, поставщики, франчайзинг, бонусы, геймификация, истории, live-streams, визуальный поиск, AI-диалог, и др.'));
content.push(bullet('58 API endpoints (App Router route handlers) для всех операций.'));
content.push(bullet('26 публичных страниц + личные кабинеты для 5 ролей (CUSTOMER, CONFECTIONER, SUPPLIER, COURIER, ADMIN).'));
content.push(bullet('Конструктор тортов в 8 шагов: мероприятие → основа → начинка → покрытие → декор → диета → доставка → резюме.'));
content.push(bullet('CRM: тикеты поддержки, Kanban-доска лидов, карточки клиентов с timeline.'));
content.push(bullet('CMS: страницы, баннеры, навигация, настройки сайта, WYSIWYG-редактор (@mdxeditor).'));
content.push(bullet('Безопасность: модерация контента (18+, экстремизм, наркотики), CSRF (timing-safe), rate-limiting, Prisma safeSelect, sanitizeResponse.'));
content.push(bullet('Email: Nodemailer + Mailpit (dev) / внешний SMTP (prod), 7 шаблонов писем, webhook приёма.'));
content.push(bullet('Telegram-бот: 11 команд, webhook, уведомления в канал.'));
content.push(bullet('PDF: счёт на оплату + счёт-фактура через print-to-PDF.'));
content.push(bullet('Аналитика: Яндекс Метрика (ID 111432662), server-side tracking.'));
content.push(bullet('Календарь: интерактивный, с добавлением событий и сменой статусов заказов.'));
content.push(bullet('Профили: AvatarUpload, ProfileSettings (смена пароля, адреса, уведомления, удаление аккаунта).'));

content.push(h3('2.1.3. Тестирование'));
content.push(bullet('441 unit-тест (19 файлов) — finance, store, rate-limit, validation-schemas, prisma-safe-select, logger, middleware, csrf, cron-auth, utils, i18n, confectioner-gate, anti-fraud, content-moderation, email, site-config, button, health.'));
content.push(bullet('11 Playwright e2e-тестов: homepage, catalog, health, security headers, CSRF, mobile responsive.'));

content.push(h2('2.2. Корневые причины сбоев'));
content.push(p('Анализ инцидентов в ходе разработки v1.0 показал, что проблемы не локализованы в отдельных компонентах, а заложены в архитектурных решениях. Ниже описаны 6 корневых причин, каждая из которых вносит вклад в нестабильность системы.'));

content.push(callout(
  'Проблема №1: PGlite WASM-fallback',
  'Файл src/lib/db.ts содержит логику: если DATABASE_URL не задан или начинается с file:, запускается PGlite (PostgreSQL compiled to WASM) в процессе Node.js. Это требует ~2.5 GB RAM на старте и вызывает OOM в контейнере с 4 GB RAM. Кроме того, Turbopack пытается загрузить WASM при статической генерации страниц, что приводит к ошибке "prisma:error f.instantiateWasm is not a function". Попытки подавить логи через NEXT_PHASE=phase-production-build — патч на патче, не решающий корневую проблему.'
));

content.push(callout(
  'Проблема №2: Prisma v7 Proxy-обёртка',
  'Вместо прямого использования PrismaClient с driver adapter, реализован Proxy-обёртка: каждый доступ к db.user.findMany() проходит через 2 уровня Proxy и async-функцию. Это теряет типы, ломает tree-shaking, усложняет отладку. В production при высокой нагрузке такой паттерн создаёт избыточные Promise-аллокации.'
));

content.push(callout(
  'Проблема №3: 12 Docker-сервисов',
  'Текущий docker-compose.yml содержит 12 сервисов: migrator, web, db, pgbouncer, meilisearch, redis, chat-service, n8n, caddy, smp-server, simplex-bridge, mailu. Каждый сервис имеет свой healthcheck, свои volumes, свои зависимости. Цепочка depends_on создаёт длинный граф запуска. При падении любого звена (особенно db или pgbouncer) каскадно падают все остальные. Отладка такого количества сервисов вручную невозможна.'
));

content.push(callout(
  'Проблема №4: 127 моделей в одном schema.prisma',
  'Монолитный schema.prisma на 3 326 строк с 127 моделями невозможно ревьюить. Многие модели дублируют функционал (например, SimpleX-bridge имеет свои таблицы сообщений, дублирующие основной чат). Любое изменение схемы требует миграции всех 127 моделей, что занимает минуты и рискует сломать unrelated-таблицы.'
));

content.push(callout(
  'Проблема №5: Конфликты PostgreSQL volume versions',
  'За время разработки проект прошёл через PostgreSQL 16 → 17 → 18. Docker volumes несовместимы между major-версиями (PG_VERSION файл отличается). Каждый upgrade требует либо pg_upgrade (рискованно), либо удаления volume с потерей данных. Текущее состояние: volume postgres_data содержит данные от PG16, а docker-compose.yml указывает postgres:18-alpine — контейнер conditera-db падает в restart loop.'
));

content.push(callout(
  'Проблема №6: Cloudflare Tunnel 502',
  'Cloudflare Tunnel настроен на прямой проброс к web:3000 (Next.js). При рестарте Next.js (например, при деплое новой версии) Caddy возвращает 502 Bad Gateway в течение 10-30 секунд. Пользователи видят ошибку вместо понятной страницы обслуживания. Health-check в Caddyfile был добавлен, но не решает проблему полностью — нужно чтобы tunnel указывал на Caddy, а не напрямую на web.'
));

content.push(h2('2.3. Что не работает в текущей версии'));
content.push(p('На момент составления данного ТЗ следующее функционал находится в нерабочем состоянии:'));
content.push(bullet('Локальный dev-сервер `npm run dev:local` падает по OOM через 30-60 секунд после запуска.'));
content.push(bullet('Production-сборка `next build` завершается успешно (176/176 страниц), но `next start` падает при первом запросе из-за инициализации PGlite WASM.'));
content.push(bullet('Маршрут /dashboard показывает бесконечный спиннер «Открываем личный кабинет…» для неавторизованных пользователей (исправлено частично — теперь показывает страницу входа).'));
content.push(bullet('Конструктор тортов открывается, но отправка запроса кондитерам не работает (требует records в БД, которой нет).'));
content.push(bullet('Cloudflare Tunnel возвращает 502 при рестарте Next.js контейнера.'));
content.push(bullet('Prisma `db push` падает с P1013 из-за того, что DATABASE_URL=file:... (PGlite) несовместим с provider=postgresql в schema.prisma (исправлено частично через явную загрузку .env в prisma.config.ts).'));
content.push(bullet('Все API endpoints, требующие БД, возвращают 500 Internal Server Error в продакшене (нет живой БД).'));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 3. Цели и задачи ---
content.push(h1('3. Цели и задачи реконструкции'));

content.push(h2('3.1. Главная цель'));
content.push(p('Создать стабильно работающий маркетплейс «Уездный кондитер» с полным функционалом предыдущей версии, но на новой архитектурной базе (self-hosted Supabase), обеспечив запуск одной командой `docker compose up -d` без ручных правок и конфликтов.'));

content.push(h2('3.2. Декларируемые задачи'));
content.push(numbered('Развернуть self-hosted Supabase через Docker на существующем VPS, с единым docker-compose.yml для всех сервисов.'));
content.push(numbered('Спроектировать и применить схему БД в Supabase Postgres, сохранив все 127 моделей из предыдущей версии (с возможной нормализацией).'));
content.push(numbered('Реализовать гибридную миграцию данных: старая БД доступна только для чтения исторических записей, новая Supabase Postgres принимает все новые записи.'));
content.push(numbered('Заменить самописный JWT auth на Supabase Auth (email/password, OAuth Google+Яндекс+VK, Magic Link, TOTP 2FA).'));
content.push(numbered('Заменить Socket.IO + Redis на Supabase Realtime (postgres_changes) для чата и уведомлений.'));
content.push(numbered('Заменить n8n на Supabase Scheduled Functions для автоматизаций (брошенная корзина, дайджесты, сгорание бонусов).'));
content.push(numbered('Заменить Meilisearch на Supabase Full Text Search (Postgres FTS с tsvector + GIN index).'));
content.push(numbered('Заменить Telegram-бот (отдельный Node.js сервис) на Supabase Edge Function + Telegram Bot API webhook.'));
content.push(numbered('Реализовать Row Level Security (RLS) политики на уровне БД для каждой таблицы и каждой роли (заменяет ручную проверку в API routes).'));
content.push(numbered('Переработать все 58 API endpoints: вместо PrismaClient использовать supabase-js клиент с типизацией из схемы.'));
content.push(numbered('Сохранить все 26 публичных страниц и личные кабинеты 5 ролей без визуальных изменений.'));
content.push(numbered('Настроить CI/CD через GitHub Actions: push → build → SSH deploy → docker compose up.'));
content.push(numbered('Реализовать комплексную систему приёмки: unit-тесты, e2e-тесты, health-check скрипт, ручное тестирование, скриншоты.'));

content.push(h2('3.3. Критерии успеха'));
content.push(p('Проект считается успешно завершённым при одновременном выполнении всех следующих условий:'));
content.push(bullet('Команда `docker compose up -d` разворачивает всю инфраструктуру за ≤5 минут без ошибок.'));
content.push(bullet('Все 26 публичных страниц возвращают HTTP 200 при curl-проверке.'));
content.push(bullet('Все 58 API endpoints возвращают HTTP 200 или ожидаемые 4xx (не 500) при health-check.'));
content.push(bullet('Регистрация нового пользователя, создание заказа, оплата (test mode Yookassa), отправка уведомления в Telegram — полный цикл работает end-to-end.'));
content.push(bullet('Unit-тесты: ≥90% pass rate (минимум 400 тестов).'));
content.push(bullet('E2E тесты: 100% pass rate (минимум 15 сценариев).'));
content.push(bullet('Cloudflare Tunnel стабильно возвращает 200 OK, без 502 при рестарте Next.js.'));
content.push(bullet('Потребление RAM всем стеком ≤2 GB (вместо текущих ~3.5 GB).'));
content.push(bullet('Время cold start полного стека ≤30 секунд.'));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 4. Архитектура ---
content.push(h1('4. Архитектура решения'));

content.push(h2('4.1. Общая схема'));
content.push(p('Новая архитектура построена на принципе «единого Docker-стека»: все сервисы (Supabase, Next.js, Caddy, Telegram-бот) запускаются из одного docker-compose.yml и共享 общую Docker-сеть. Это упрощает запуск, отладку и обновление — одна команда `docker compose up -d` разворачивает всё.'));

content.push(h3('4.1.1. Состав Docker-стека'));

content.push(dataTable(
  ['Сервис', 'Образ', 'Порт', 'Назначение'],
  [
    ['supabase-db', 'supabase/postgres:15.6.1', '5432 (внутр.)', 'PostgreSQL 15 с расширениями (pgsodium, pg_cron, pgbouncer)'],
    ['supabase-analytics', 'supabase/logflare', '4000 (внутр.)', 'Логирование и аналитика событий'],
    ['supabase-auth', 'supabase/gotrue', '9999 (внутр.)', 'Auth сервис (email/pass, OAuth, Magic Link, 2FA)'],
    ['supabase-rest', 'supabase/postgrest', '3000 (внутр.)', 'Auto-generated REST API из схемы БД'],
    ['supabase-realtime', 'supabase/realtime', '4000 (внутр.)', 'WebSocket-подписка на изменения БД (postgres_changes)'],
    ['supabase-storage', 'supabase/storage-api', '5000 (внутр.)', 'S3-совместимое хранилище файлов (аватары, фото продуктов)'],
    ['supabase-imgproxy', 'darthsim/imgproxy', '5001 (внутр.)', 'Обработка изображений (resize, crop, optimize)'],
    ['supabase-kong', 'library/kong:2.8.1', '8000 (внутр.)', 'API gateway — единая точка входа для всех Supabase сервисов'],
    ['supabase-meta', 'supabase/postgres-meta', '8080 (внутр.)', 'Admin UI для управления БД (таблицы, RLS, функции)'],
    ['supabase-studio', 'supabase/studio', '3000 → 8000', 'Web UI для управления всем Supabase (БД, Auth, Storage, Functions)'],
    ['web', 'nextjs:16 (custom build)', '3000', 'Next.js приложение (SSR + API routes)'],
    ['caddy', 'caddy:2.8-alpine', '80, 443', 'Reverse proxy с авто-HTTPS и health-check'],
    ['telegram-bot', 'supabase/edge-runtime', '—', 'Edge Function: приём webhook от Telegram, отправка уведомлений'],
  ],
  [15, 20, 15, 50]
));

content.push(p('Итого: 13 контейнеров в одном docker-compose.yml. Хотя это больше чем 4 (как было заявлено в целях), все Supabase-сервисы запускаются как одна логическая единица и не требуют отдельной настройки. Чистое потребление RAM ~1.8 GB (Supabase ~1.2 GB + Next.js 400 MB + Caddy 50 MB + бот 50 MB).'));

content.push(h3('4.1.2. Поток запросов'));
content.push(p('Пользовательский запрос проходит следующую цепочку:'));
content.push(numbered('Пользователь открывает https://conditera.ru/ в браузере.'));
content.push(numbered('Cloudflare (DNS + WAF + DDoS protection) маршрутизирует запрос на Cloudflare Tunnel.'));
content.push(numbered('Cloudflare Tunnel (cloudflared на VPS) пробрасывает запрос на http://localhost:80 (Caddy).'));
content.push(numbered('Caddy терминирует HTTPS, применяет security headers, проксирует на web:3000 (Next.js).'));
content.push(numbered('Next.js SSR рендерит страницу, делая запросы к Supabase через supabase-js клиент.'));
content.push(numbered('Supabase Kong gateway маршрутизирует запрос: /auth/v1/* → gotrue, /rest/v1/* → postgrest, /realtime/v1/* → realtime, /storage/v1/* → storage.'));
content.push(numbered('PostgREST/GoTrue обращается к PostgreSQL, применяет RLS-политики, возвращает данные.'));
content.push(numbered('Next.js получает данные, рендерит HTML, отдаёт через Caddy → Cloudflare → браузер.'));

content.push(h3('4.1.3. Поток realtime (чат, уведомления)'));
content.push(numbered('Клиент (браузер) устанавливает WebSocket соединение с https://conditera.ru/realtime/v1/websocket (через Caddy → Kong → realtime).'));
content.push(numbered('Клиент подписывается на изменения таблицы messages (postgres_changes event).'));
content.push(numbered('При INSERT в messages (через API), PostgreSQL replication slot передаёт событие в realtime сервис.'));
content.push(numbered('Realtime сервис фильтрует событие по RLS-политике (получатель видит только свои сообщения) и отправляет через WebSocket.'));
content.push(numbered('Клиент получает событие, отображает новое сообщение в чате.'));

content.push(h2('4.2. Замены компонентов (v1.0 → v2.0)'));

content.push(dataTable(
  ['Компонент v1.0', 'Компонент v2.0', 'Причина замены'],
  [
    ['PGlite (WASM Postgres)', 'Supabase Postgres 15', 'OOM при сборке, несовместимость с Turbopack'],
    ['Prisma v7 + Proxy-обёртка', 'supabase-js + PostgREST', 'Теряет типы, ломает tree-shaking, сложная отладка'],
    ['Socket.IO + Redis', 'Supabase Realtime', 'Отдельный контейнер + Redis для adapter — избыточно'],
    ['n8n', 'Supabase Scheduled Functions (pg_cron)', 'Отдельный контейнер + сложность debug workflows'],
    ['Meilisearch', 'Postgres FTS (tsvector + GIN)', 'Отдельный контейнер, расходует 512MB RAM'],
    ['Telegram-бот (Node.js)', 'Supabase Edge Function', 'Отдельный контейнер, дублирует auth логику'],
    ['Самописный JWT auth', 'Supabase GoTrue', 'Сложность поддержки 2FA, OAuth, password reset'],
    ['S3-like storage (custom)', 'Supabase Storage', 'Отдельный сервис, нет thumbnail generation'],
    ['CSRF (timing-safe)', 'Supabase Auth session', 'Встроено в GoTrue, не нужна самописная реализация'],
    ['Prisma safeSelect', 'Postgres RLS policies', 'Безопасность на уровне БД, не в коде'],
    ['PgBouncer', 'Supabase Postgres pgbouncer', 'Встроен в supabase/postgres образ'],
    ['Cloudflare Tunnel → web:3000', 'Cloudflare Tunnel → Caddy:80', 'Caddy health-check обрабатывает 502'],
  ],
  [25, 25, 50]
));

content.push(h2('4.3. Сетевая топология'));

content.push(h3('4.3.1. Внешние подключения'));
content.push(bullet('Cloudflare (конитель): HTTPS 443 → VPS Cloudflare Tunnel'));
content.push(bullet('Telegram Bot API: webhook от Telegram → https://conditera.ru/api/telegram/webhook'));
content.push(bullet('Yookassa API: webhook от Yookassa → https://conditera.ru/api/payment/webhook'));
content.push(bullet('SMTP (отправка почты): внешний SMTP (Mailgun/SendGrid) или Mailu'));
content.push(bullet('Яндекс Метрика: server-side tracking через Metrika API'));

content.push(h3('4.3.2. Внутренние подключения (Docker-сеть uyezdny-net)'));
content.push(bullet('web → supabase-kong:8000 (все Supabase API через единый gateway)'));
content.push(bullet('caddy → web:3000 (HTTP reverse proxy)'));
content.push(bullet('caddy → supabase-studio:3000 (admin UI, опционально через /studio)'));
content.push(bullet('cloudflared → caddy:80 (Cloudflare Tunnel ingress)'));
content.push(bullet('Все Supabase сервисы → supabase-db:5432 (PostgreSQL)'));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 5. Стек технологий ---
content.push(h1('5. Стек технологий'));

content.push(h2('5.1. Frontend'));
content.push(dataTable(
  ['Технология', 'Версия', 'Назначение'],
  [
    ['Next.js', '16.1.3', 'React-фреймворк, App Router, SSR/SSG, API routes'],
    ['React', '19.x', 'UI library'],
    ['TypeScript', '5.5+', 'Статическая типизация'],
    ['Tailwind CSS', '4.x', 'Utility-first CSS'],
    ['shadcn/ui', 'latest', 'UI компоненты (Button, Dialog, Toast, и т.д.)'],
    ['Zustand', '5.x', 'Global state management (замена Redux)'],
    ['TanStack Query', '5.x', 'Server state, caching, mutations'],
    ['@supabase/supabase-js', '2.x', 'Supabase клиент (auth, db, realtime, storage)'],
    ['next/font', 'built-in', 'Шрифты: Brokgauz+TriodPostnaja (брендовые), Geist, Neucha'],
    ['Sonner', 'latest', 'Toast notifications'],
    ['lucide-react', 'latest', 'Иконки'],
    ['date-fns', '3.x', 'Работа с датами'],
    ['zod', '3.x', 'Валидация форм и API payloads'],
  ],
  [25, 15, 60]
));

content.push(h2('5.2. Backend'));
content.push(dataTable(
  ['Технология', 'Версия', 'Назначение'],
  [
    ['Node.js', '20 LTS', 'Runtime для Next.js и Edge Functions'],
    ['Supabase', 'latest self-hosted', 'Postgres + Auth + Realtime + Storage + Functions'],
    ['PostgreSQL', '15.6', 'БД (через supabase/postgres:15.6.1 образ)'],
    ['PostgREST', '12.x', 'Auto-generated REST API из БД схемы'],
    ['GoTrue', '2.x', 'Auth сервис (JWT, OAuth, Magic Link, 2FA)'],
    ['Realtime', '2.x', 'WebSocket подписка на postgres_changes'],
    ['Storage API', '0.10+', 'S3-совместимое хранилище'],
    ['Deno', '1.46+', 'Runtime для Edge Functions (supabase-edge-runtime)'],
    ['pg_cron', '1.6+', 'Scheduled jobs в PostgreSQL (замена n8n)'],
    ['pgsodium', '3.x', 'Шифрование на уровне БД (RLS, column-level encryption)'],
  ],
  [25, 15, 60]
));

content.push(h2('5.3. Infrastructure'));
content.push(dataTable(
  ['Технология', 'Версия', 'Назначение'],
  [
    ['Docker', '24+', 'Контейнеризация'],
    ['Docker Compose', '2.20+', 'Оркестрация (единый docker-compose.yml)'],
    ['Caddy', '2.8-alpine', 'Reverse proxy + авто-HTTPS'],
    ['Cloudflare Tunnel', 'latest', 'Доступ к серверу без публичного IP'],
    ['GitHub Actions', '—', 'CI/CD: build, test, deploy'],
    ['VPS', '4 GB RAM, 40 GB SSD', 'Хостинг (текущий сервер)'],
    ['Ubuntu', '22.04 LTS', 'ОС сервера'],
  ],
  [25, 15, 60]
));

content.push(h2('5.4. Что убрано из стека v1.0'));
content.push(dataTable(
  ['Технология v1.0', 'Причина удаления', 'Альтернатива в v2.0'],
  [
    ['Prisma 7', 'Proxy-обёртка теряет типы, сложность с driver adapters', 'supabase-js + PostgREST (типизация из schema)'],
    ['PGlite', 'OOM в production, несовместимость с Turbopack', 'Supabase Postgres (real DB)'],
    ['Socket.IO', 'Отдельный контейнер + Redis для adapter', 'Supabase Realtime (встроен)'],
    ['Redis', 'Использовался только для Socket.IO adapter', 'Не нужен (Supabase сам управляет state)'],
    ['n8n', 'Сложность debug workflows, отдельный контейнер', 'pg_cron + Supabase Functions'],
    ['Meilisearch', '512MB RAM, отдельный контейнер', 'Postgres FTS (tsvector + GIN index)'],
    ['SimpleX SMP', 'Сложность настройки, отдельный профиль в compose', 'Supabase Realtime private channels'],
    ['Mailu', 'Сложность MX/PTR настройки', 'Внешний SMTP (Mailgun/SendGrid)'],
    ['PgBouncer', 'Отдельный контейнер, нужен для Prisma connection pool', 'Встроен в supabase/postgres'],
    ['@prisma/adapter-pg', 'Нужен только для Prisma v7', 'Не нужен (supabase-js использует fetch)'],
    ['pglite-prisma-adapter', 'Нужен только для PGlite fallback', 'Не нужен'],
  ],
  [20, 40, 40]
));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 6. Структура проекта ---
content.push(h1('6. Структура проекта v2.0'));

content.push(h2('6.1. Файловая структура'));

content.push(p('Ниже представлена целевая файловая структура проекта. Сохраняются все существующие директории (src/app, src/components, src/lib), но удаляются директории связанные с удалёнными технологиями (prisma/, chat-service/, n8n-workflows/, simplex/).'));

content.push(h3('6.1.1. Корневая структура'));
content.push(dataTable(
  ['Путь', 'Тип', 'Назначение'],
  [
    ['/docker-compose.yml', 'YAML', 'Единый Docker-стек (Supabase + Next.js + Caddy + бот)'],
    ['/docker-compose.dev.yml', 'YAML', 'Dev-окружение: только Next.js + ссылка на remote Supabase'],
    ['/Dockerfile', 'Dockerfile', 'Multi-stage build Next.js (deps → build → runner)'],
    ['/Dockerfile.bot', 'Dockerfile', 'Telegram-бот как Edge Function (Deno)'],
    ['/Caddyfile', 'Caddy', 'Reverse proxy конфиг с health-check'],
    ['/.env', 'env', 'Локальные переменные (NEXT_PUBLIC_SUPABASE_URL, etc.)'],
    ['/.env.production', 'env', 'Production переменные (в .gitignore)'],
    ['/.env.example', 'env', 'Шаблон для разработчиков'],
    ['/next.config.ts', 'TS', 'Next.js конфиг (без experimental, без watchOptions)'],
    ['/package.json', 'JSON', 'Зависимости и скрипты'],
    ['/tsconfig.json', 'JSON', 'TypeScript конфиг'],
    ['/tailwind.config.ts', 'TS', 'Tailwind конфиг'],
    ['/src/', 'dir', 'Исходный код Next.js приложения'],
    ['/supabase/', 'dir', 'Supabase миграции, RLS политики, Edge Functions'],
    ['/scripts/', 'dir', 'Утилиты: seed, health-check, backup'],
    ['/public/', 'dir', 'Статические assets (fonts, images, icons)'],
    ['/docs/', 'dir', 'Документация: deploy, monitoring, runbook'],
  ],
  [30, 10, 60]
));

content.push(h3('6.1.2. Структура src/'));
content.push(dataTable(
  ['Путь', 'Назначение'],
  [
    ['src/app/', 'Next.js App Router: страницы и API routes'],
    ['src/app/page.tsx', 'Главная страница (home view)'],
    ['src/app/layout.tsx', 'Root layout: шрифты, Toaster, JsonLd'],
    ['src/app/dashboard/page.tsx', 'Личный кабинет (редирект по роли)'],
    ['src/app/catalog/page.tsx', 'Каталог товаров'],
    ['src/app/api/', '58 API route handlers'],
    ['src/app/api/auth/', 'Auth callbacks (Supabase OAuth redirect)'],
    ['src/app/api/payment/', 'Yookassa create + webhook'],
    ['src/app/api/telegram/', 'Telegram webhook endpoint'],
    ['src/components/', 'React компоненты (21 директория)'],
    ['src/components/layout/', 'Header, Footer, AuthModal, PromoPopup, CartDrawer'],
    ['src/components/dashboard/', '5 dashboards: customer, confectioner, supplier, courier, admin'],
    ['src/components/cake-builder/', 'Конструктор тортов (8 шагов)'],
    ['src/components/marketplace/', 'Cart, checkout, product cards'],
    ['src/components/ui/', 'shadcn/ui компоненты'],
    ['src/lib/', 'Утилиты, hooks, types'],
    ['src/lib/supabase/', 'Supabase клиенты: browser, server, middleware, admin'],
    ['src/lib/auth/', 'Auth helpers: getSession, requireRole, refreshSession'],
    ['src/lib/realtime/', 'Realtime hooks: useChat, useNotifications'],
    ['src/lib/storage/', 'Storage helpers: uploadAvatar, getProductImage'],
    ['src/lib/validation/', 'Zod-схемы для всех API payloads'],
    ['src/lib/finance/', 'Расчёт цен, доставка, налоги'],
    ['src/lib/ai/', 'AI-помощник, cake-finder, dialogue'],
    ['src/types/', 'TypeScript типы (генерируются из Supabase schema)'],
    ['src/middleware.ts', 'Next.js middleware: refresh Supabase session'],
    ['src/styles/globals.css', 'Tailwind + global styles'],
  ],
  [35, 65]
));

content.push(h3('6.1.3. Структура supabase/ (новая)'));
content.push(dataTable(
  ['Путь', 'Назначение'],
  [
    ['supabase/config.toml', 'Конфиг Supabase CLI (project id, api keys)'],
    ['supabase/migrations/', 'SQL миграции (0001_init.sql, 0002_rls.sql, и т.д.)'],
    ['supabase/migrations/0001_init.sql', 'Создание всех таблиц (из schema.prisma конвертация)'],
    ['supabase/migrations/0002_rls.sql', 'RLS политики для всех таблиц'],
    ['supabase/migrations/0003_functions.sql', 'Postgres functions (triggers, scheduled jobs)'],
    ['supabase/migrations/0004_fts.sql', 'Full Text Search indexes и triggers'],
    ['supabase/migrations/0005_seed.sql', 'Seed данные (категории, роли, настройки)'],
    ['supabase/functions/', 'Edge Functions (Deno)'],
    ['supabase/functions/telegram-webhook/', 'Приём webhook от Telegram'],
    ['supabase/functions/send-notification/', 'Отправка уведомления в Telegram'],
    ['supabase/functions/yookassa-webhook/', 'Приём webhook от Yookassa'],
    ['supabase/functions/abandoned-cart/', 'Scheduled: уведомление о брошенной корзине'],
    ['supabase/functions/bonus-expiry/', 'Scheduled: сгорание бонусов'],
    ['supabase/functions/daily-digest/', 'Scheduled: ежедневный дайджест'],
    ['supabase/seed.sql', 'Seed данные для dev-окружения'],
    ['supabase/.branches/', 'Branch management для миграций'],
  ],
  [40, 60]
));

content.push(h2('6.2. Переменные окружения'));

content.push(h3('6.2.1. .env (dev)'));
content.push(dataTable(
  ['Переменная', 'Пример', 'Назначение'],
  [
    ['NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:8000', 'URL Supabase Kong gateway'],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'eyJhbGciOi...', 'Anon public key (виден в браузере)'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOi...', 'Service role key (только server-side, full access)'],
    ['NEXT_PUBLIC_APP_URL', 'http://localhost:3000', 'URL Next.js приложения'],
    ['YOOKASSA_SHOP_ID', '123456', 'ID магазина Yookassa'],
    ['YOOKASSA_SECRET_KEY', 'test_XXXX', 'Секретный ключ Yookassa'],
    ['TELEGRAM_BOT_TOKEN', '123456:ABC-DEF', 'Token Telegram-бота'],
    ['SMTP_HOST', 'smtp.mailgun.org', 'SMTP сервер для отправки почты'],
    ['SMTP_USER', 'postmaster@...', 'SMTP пользователь'],
    ['SMTP_PASSWORD', '...', 'SMTP пароль'],
    ['NEXT_PUBLIC_YANDEX_METRIKA_ID', '111432662', 'ID Яндекс Метрики'],
  ],
  [35, 25, 40]
));

content.push(h3('6.2.2. .env.production'));
content.push(p('Production-переменные содержат реальные секреты и хранятся только на сервере в .env.production (в .gitignore). Для управления секретами используется GitHub Secrets + скрипт scripts/setup-secrets.sh, который при деплое генерирует .env.production из секретов GitHub.'));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 7. Модули ---
content.push(h1('7. Модули проекта'));

content.push(p('Проект разделён на 12 функциональных модулей. Каждый модуль имеет чёткие границы: свои таблицы в БД, свои API endpoints, свои UI компоненты. Это позволяет разрабатывать и тестировать модули независимо. Ниже представлено детальное описание каждого модуля.'));

// 7.1 Auth
content.push(h2('7.1. Модуль Auth (аутентификация)'));
content.push(p('Модуль аутентификации полностью заменяется на Supabase Auth (GoTrue). Это устраняет самописный JWT, 2FA, password reset, OAuth callbacks — всё это встроено в GoTrue и протестировано Supabase командой.'));

content.push(h3('7.1.1. Возможности'));
content.push(bullet('Email + password регистрация и логин'));
content.push(bullet('Email confirmation (отправка письма с подтверждением)'));
content.push(bullet('Password reset (forgot password flow)'));
content.push(bullet('Magic Link (бесшарольный вход по ссылке в почте)'));
content.push(bullet('OAuth: Google, Яндекс, ВКонтакте (настраивается через Supabase Studio)'));
content.push(bullet('2FA через TOTP (Google Authenticator, Authy)'));
content.push(bullet('Session management: access token (1 час) + refresh token (7 дней)'));
content.push(bullet('Row Level Security: пользователь видит только свои данные'));

content.push(h3('7.1.2. Таблицы БД'));
content.push(dataTable(
  ['Таблица', 'Назначение', 'RLS'],
  [
    ['auth.users', 'Встроенная GoTrue таблица пользователей', 'Встроена'],
    ['auth.identities', 'OAuth providers linked to user', 'Встроена'],
    ['auth.sessions', 'Активные сессии (refresh tokens)', 'Встроена'],
    ['auth.mfa_factors', '2FA факторы (TOTP secret)', 'Встроена'],
    ['auth.mfa_challenges', '2FA challenge codes', 'Встроена'],
    ['public.profiles', 'Расширение auth.users: роли, аватар, контакты', 'Пользователь видит только свой профиль'],
    ['public.user_roles', 'Множественные роли (CUSTOMER, CONFECTIONER, и т.д.)', 'Пользователь видит только свои роли'],
  ],
  [25, 50, 25]
));

content.push(h3('7.1.3. API endpoints'));
content.push(dataTable(
  ['Endpoint', 'Метод', 'Назначение'],
  [
    ['/api/auth/callback', 'GET', 'OAuth redirect callback (Supabase)'],
    ['/api/auth/refresh', 'POST', 'Refresh access token'],
    ['/api/auth/logout', 'POST', 'Sign out (revoke session)'],
    ['/api/auth/check', 'GET', 'Проверка текущей сессии (для middleware)'],
    ['/api/profile', 'GET, PATCH', 'Получить/обновить профиль пользователя'],
    ['/api/profile/avatar', 'POST', 'Загрузка аватара (через Supabase Storage)'],
    ['/api/profile/password', 'PATCH', 'Смена пароля (через GoTrue)'],
    ['/api/profile/delete', 'DELETE', 'Удаление аккаунта (soft delete)'],
  ],
  [35, 15, 50]
));

content.push(h3('7.1.4. UI компоненты'));
content.push(bullet('AuthModal — модалка входа/регистрации (email+pass, OAuth buttons, Magic Link)'));
content.push(bullet('ProfileSettings — настройки профиля (смена пароля, 2FA, адреса, уведомления)'));
content.push(bullet('AvatarUpload — загрузка аватара с crop и resize (через supabase storage)'));
content.push(bullet('RoleSwitcher — переключатель ролей (если пользователь имеет несколько ролей)'));

// 7.2 Marketplace
content.push(h2('7.2. Модуль Marketplace (маркетплейс)'));
content.push(p('Модуль маркетплейса — основной функционал: каталог, карточка продукта, корзина, оформление заказа, оплата. Сохраняет весь функционал v1.0, но переписан на supabase-js вместо Prisma.'));

content.push(h3('7.2.1. Таблицы БД'));
content.push(dataTable(
  ['Таблица', 'Назначение'],
  [
    ['products', 'Товары (готовые торты, десерты, и т.д.)'],
    ['product_categories', 'Категории товаров (торты, капкейки, печенье, и т.д.)'],
    ['product_images', 'Изображения товаров (множественные, через storage)'],
    ['product_attributes', 'Атрибуты (вес, размер, вкус, и т.д.)'],
    ['product_reviews', 'Отзывы покупателей на товары'],
    ['product_favorites', 'Избранное (wishlist) пользователей'],
    ['cart_items', 'Корзина (безопасная — даже без логина)'],
    ['orders', 'Заказы'],
    ['order_items', 'Позиции заказа (snapshot цены на момент заказа)'],
    ['order_status_history', 'История изменения статуса заказа'],
    ['payments', 'Платежи Yookassa'],
    ['deliveries', 'Доставки (адрес, курьер, статус)'],
  ],
  [30, 70]
));

content.push(h3('7.2.2. API endpoints (12)'));
content.push(dataTable(
  ['Endpoint', 'Метод', 'Назначение'],
  [
    ['/api/products', 'GET', 'Список товаров с фильтрами и пагинацией'],
    ['/api/products/[id]', 'GET', 'Карточка товара'],
    ['/api/products/[id]/reviews', 'GET, POST', 'Отзывы на товар'],
    ['/api/cart', 'GET, POST, DELETE', 'Управление корзиной'],
    ['/api/checkout', 'POST', 'Оформление заказа → создание payment в Yookassa'],
    ['/api/payment/create', 'POST', 'Создание платежа Yookassa'],
    ['/api/payment/webhook', 'POST', 'Webhook от Yookassa (подтверждение платежа)'],
    ['/api/orders', 'GET', 'Список заказов пользователя'],
    ['/api/orders/[id]', 'GET, PATCH', 'Детали заказа, смена статуса (для кондитера/курьера)'],
    ['/api/favorites', 'GET, POST, DELETE', 'Избранное'],
    ['/api/search', 'GET', 'Поиск через Postgres FTS'],
    ['/api/search/reindex', 'POST', 'Переиндексация FTS (admin only)'],
  ],
  [40, 20, 40]
));

// 7.3 Cake Builder
content.push(h2('7.3. Модуль Cake Builder (конструктор тортов)'));
content.push(p('Конструктор тортов — уникальная функция маркетплейса. Пользователь проходит 8 шагов: мероприятие, основа, начинка, покрытие, декор, диета, доставка, резюме. На последнем шаге выбирает нескольких кондитеров и отправляет им запрос с параметрами торта. Кондитеры предлагают цены, пользователь выбирает лучшее предложение.'));

content.push(h3('7.3.1. Таблицы БД'));
content.push(dataTable(
  ['Таблица', 'Назначение'],
  [
    ['cake_builder_options', 'Опции конструктора (bases, fillings, coatings, decorations, dietary)'],
    ['inquiries', 'Запросы от пользователей (один запрос = один проект торта)'],
    ['negotiations', 'Переговоры (один запрос → много кондитеров, каждый предлагает цену)'],
    ['negotiation_revisions', 'История изменений предложения (кондитер меняет цену/условия)'],
    ['negotiation_messages', 'Сообщения между пользователем и кондитером в переговорах'],
  ],
  [35, 65]
));

content.push(h3('7.3.2. API endpoints'));
content.push(dataTable(
  ['Endpoint', 'Метод', 'Назначение'],
  [
    ['/api/cake-builder/options', 'GET', 'Получить все опции конструктора'],
    ['/api/inquiries', 'POST', 'Создать запрос (отправка проекта торта кондитерам)'],
    ['/api/inquiries/[id]', 'GET', 'Получить детали запроса'],
    ['/api/negotiations', 'GET', 'Список переговоров (для кондитера: входящие, для пользователя: исходящие)'],
    ['/api/negotiations/[id]', 'GET, PATCH', 'Детали переговоров, смена статуса (accept, decline, counter)'],
    ['/api/negotiations/[id]/messages', 'GET, POST', 'Сообщения в переговорах (через realtime)'],
  ],
  [40, 20, 40]
));

// 7.4 CRM
content.push(h2('7.4. Модуль CRM (управление клиентами)'));
content.push(p('CRM-модуль для администраторов и support-команды: тикеты поддержки, Kanban-доска лидов, карточки клиентов с timeline всех взаимодействий.'));

content.push(h3('7.4.1. Таблицы БД'));
content.push(dataTable(
  ['Таблица', 'Назначение'],
  [
    ['support_tickets', 'Тикеты поддержки'],
    ['support_ticket_messages', 'Сообщения в тикете (от пользователя и от support)'],
    ['leads', 'Лиды (Kanban: new, contacted, qualified, won, lost)'],
    ['lead_activities', 'Активности по лиду (звонок, письмо, встреча)'],
    ['customer_profiles', 'Расширенный профиль клиента (для CRM)'],
    ['customer_timeline', 'Timeline всех взаимодействий с клиентом'],
    ['customer_segments', 'Сегменты клиентов (для рассылок)'],
  ],
  [35, 65]
));

// 7.5 Chat
content.push(h2('7.5. Модуль Chat (чат через Supabase Realtime)'));
content.push(p('Чат между пользователями и кондитерами, support-чат, групповые чаты (заказ → пользователь + кондитер + курьер). Реализован через Supabase Realtime (postgres_changes) — не требует отдельного Socket.IO сервера.'));

content.push(h3('7.5.1. Таблицы БД'));
content.push(dataTable(
  ['Таблица', 'Назначение'],
  [
    ['chat_channels', 'Каналы чата (direct, group, support)'],
    ['chat_channel_members', 'Участники канала (с RLS: видит только свои каналы)'],
    ['chat_messages', 'Сообщения в канале'],
    ['chat_message_reads', 'Отметки о прочтении (для unread count)'],
    ['chat_attachments', 'Вложения (фото, документы — через storage)'],
  ],
  [35, 65]
));

content.push(h3('7.5.2. Realtime подписки'));
content.push(bullet('postgres_changes INSERT на chat_messages — новое сообщение в канале'));
content.push(bullet('postgres_changes UPDATE на chat_message_reads — изменение unread count'));
content.push(bullet('broadcast events — typing indicator (печатает...)'));
content.push(bullet('presence — online/offline статус пользователя'));

// 7.6 CMS
content.push(h2('7.6. Модуль CMS (управление контентом)'));
content.push(p('CMS для администраторов: страницы, баннеры, навигация, настройки сайта. WYSIWYG-редактор через @mdxeditor для богатого контента.'));

content.push(h3('7.6.1. Таблицы БД'));
content.push(dataTable(
  ['Таблица', 'Назначение'],
  [
    ['cms_pages', 'Динамические страницы (about, faq, и т.д.) — slug, title, content (MDX)'],
    ['cms_banners', 'Баннеры на главной и в каталоге (с датами показа)'],
    ['cms_navigation', 'Пункты меню (header, footer, mobile)'],
    ['cms_site_settings', 'Настройки сайта (контакты, соцсети, метрика)'],
    ['cms_blog_posts', 'Блог-посты (отдельная таблица для блога)'],
    ['cms_blog_categories', 'Категории блога'],
    ['cms_redirects', '301-редиректы (для SEO миграций)'],
  ],
  [35, 65]
));

// 7.7 Dashboard
content.push(h2('7.7. Модуль Dashboards (личные кабинеты)'));
content.push(p('5 личных кабинетов для 5 ролей. Каждый дашборд — отдельный code-split чанк (dynamic import), чтобы не раздувать initial bundle публичных страниц.'));

content.push(h3('7.7.1. Customer Dashboard'));
content.push(bullet('Список заказов (active, history)'));
content.push(bullet('Избранное (wishlist)'));
content.push(bullet('Адреса доставки (CRUD)'));
content.push(bullet('Бонусы и скидки (loyalty program)'));
content.push(bullet('Переговоры с кондитерами (cake builder inquiries)'));
content.push(bullet('Сообщения (chat)'));
content.push(bullet('Настройки профиля, уведомлений'));

content.push(h3('7.7.2. Confectioner Dashboard'));
content.push(bullet('Входящие запросы (cake builder inquiries)'));
content.push(bullet('Активные переговоры (suggest price, accept, decline)'));
content.push(bullet('Заказы (accept, start preparing, ready, shipped)'));
content.push(bullet('Управление товарами (CRUD продуктов)'));
content.push(bullet('Календарь заказов (даты доставки)'));
content.push(bullet('Финансы: доход, payouts, комиссии'));
content.push(bullet('Отзывы и рейтинг'));

content.push(h3('7.7.3. Supplier Dashboard'));
content.push(bullet('Управление товарами (ингредиенты, упаковка)'));
content.push(bullet('Склад (inventory: остатки, цены)'));
content.push(bullet('Заказы от кондитеров (B2B)'));
content.push(bullet('Финансы: доход, payouts'));

content.push(h3('7.7.4. Courier Dashboard'));
content.push(bullet('Активные доставки (assigned to me)'));
content.push(bullet('История доставок'));
content.push(bullet('Заработок за период'));
content.push(bullet('Смена статуса (picked up, on the way, delivered)'));

content.push(h3('7.7.5. Admin Dashboard'));
content.push(bullet('Пользователи (список, фильтр по ролям, ban/unban)'));
content.push(bullet('Заказы (все, фильтры, экспорт CSV)'));
content.push(bullet('Финансы (общий доход, комиссии, payouts)'));
content.push(bullet('CRM (тикеты, лиды, клиенты)'));
content.push(bullet('CMS (страницы, баннеры, навигация)'));
content.push(bullet('Модерация контента (отзывы, фото, 18+)'));
content.push(bullet('Аналитика (графики, Яндекс Метрика)'));

// 7.8 Payments
content.push(h2('7.8. Модуль Payments (платежи Yookassa)'));
content.push(p('Интеграция с Yookassa для онлайн-оплаты заказов. Поддержка test mode (для dev) и production mode. Webhook для подтверждения платежа.'));

content.push(h3('7.8.1. Поток платежа'));
content.push(numbered('Пользователь оформляет заказ → POST /api/checkout'));
content.push(numbered('Backend создаёт payment в Yookassa (POST https://api.yookassa.ru/v3/payments)'));
content.push(numbered('Yookassa возвращает confirmation_url → редирект пользователя'));
content.push(numbered('Пользователь вводит карту, оплачивает на side Yookassa'));
content.push(numbered('Yookassa отправляет webhook на /api/payment/webhook (payment.succeeded)'));
content.push(numbered('Backend обновляет order.status = paid, отправляет уведомления'));
content.push(numbered('Postgres trigger на orders (status=paid) → Supabase Realtime → клиент видит обновление'));

// 7.9 Telegram Bot
content.push(h2('7.9. Модуль Telegram (уведомления + бот)'));
content.push(p('Telegram-функционал разделён на 2 части: (1) уведомления в канал о событиях (новый заказ, новый лид, тикет), (2) бот для пользователей (статус заказа, чат с support). Реализовано через Supabase Edge Functions (Deno runtime) вместо отдельного Node.js контейнера.'));

content.push(h3('7.9.1. Edge Functions'));
content.push(dataTable(
  ['Function', 'Триггер', 'Назначение'],
  [
    ['telegram-webhook', 'POST /functions/v1/telegram-webhook', 'Приём update от Telegram (message, callback_query)'],
    ['send-channel-notification', 'DB trigger on orders/leads/tickets', 'Отправка уведомления в @conditera канал'],
    ['telegram-bot-command', 'Webhook', 'Обработка команд бота (/start, /status, /help, /support)'],
  ],
  [35, 30, 35]
));

// 7.10 Search
content.push(h2('7.10. Модуль Search (полнотекстовый поиск)'));
content.push(p('Замена Meilisearch на Postgres Full Text Search. Для каждого продукта создаётся tsvector (name + description + category), индексируется через GIN. Поиск с опечатками — через trigram (pg_trgm extension).'));

content.push(h3('7.10.1. SQL-структура'));
content.push(p('Колонка search_vector в таблице products, обновляется триггером при INSERT/UPDATE:'));
content.push(p("search_vector tsvector GENERATED ALWAYS AS (to_tsvector('russian', coalesce(name, '') || ' ' || coalesce(description, ''))) STORED", { indent: { firstLine: 0 } }));
content.push(p('GIN index: CREATE INDEX products_search_idx ON products USING GIN(search_vector);'));
content.push(p('Trigram: CREATE EXTENSION pg_trgm; CREATE INDEX products_name_trgm ON products USING GIN(name gin_trgm_ops);'));

// 7.11 Automation
content.push(h2('7.11. Модуль Automation (заменяет n8n)'));
content.push(p('Автоматизации через pg_cron (PostgreSQL scheduled jobs) + Supabase Edge Functions. Заменяет 3 n8n workflow: брошенная корзина, ежедневный дайджест, сгорание бонусов.'));

content.push(dataTable(
  ['Workflow (n8n)', 'Замена (v2.0)', 'Расписание'],
  [
    ['Брошенная корзина', 'Edge Function abandoned-cart + pg_cron', 'Каждый час: 0 * * * *'],
    ['Ежедневный дайджест', 'Edge Function daily-digest + pg_cron', '9:00 MSK: 0 9 * * *'],
    ['Сгорание бонусов', 'Edge Function bonus-expiry + pg_cron', 'Полночь: 0 0 * * *'],
    ['Реиндексация поиска', 'Postgres trigger (автоматически)', 'On INSERT/UPDATE products'],
    ['Backup БД', 'scripts/backup.sh + cron на хосте', '3:00 MSK: 0 3 * * *'],
  ],
  [25, 45, 30]
));

// 7.12 Analytics
content.push(h2('7.12. Модуль Analytics (аналититика)'));
content.push(p('Яндекс Метрика для клиентской аналитики (pageviews, goals, ecommerce). Server-side tracking для событий которые не видны в браузере (webhook получен, payment confirmed). Дашборд для админа с ключевыми метриками.'));

content.push(h3('7.12.1. Таблицы БД'));
content.push(dataTable(
  ['Таблица', 'Назначение'],
  [
    ['analytics_events', 'Server-side events (event_type, user_id, metadata, timestamp)'],
    ['analytics_daily_stats', 'Агрегированные дневные метрики (orders, revenue, new users)'],
  ],
  [30, 70]
));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 8. БД: схема ---
content.push(h1('8. Схема базы данных'));

content.push(h2('8.1. Принципы проектирования'));
content.push(bullet('Сохранение всех 127 моделей из v1.0 — без урезаний функционала.'));
content.push(bullet('Нормализация: ссылки через UUID (gen_random_uuid()) вместо autoincrement.'));
content.push(bullet('Timestamps: created_at, updated_at на каждой таблице (updated_at через триггер).'));
content.push(bullet('Soft delete: deleted_at column, не удаляем записи физически.'));
content.push(bullet('RLS на каждой таблице с user data — пользователь видит только свои записи.'));
content.push(bullet('JSON columns для гибких данных (metadata, settings, preferences).'));
content.push(bullet('Postgres enums для предопределённых значений (user_role, order_status, и т.д.).'));

content.push(h2('8.2. ER-диаграмма (высокоуровневая)'));
content.push(p('Ниже представлена высокоуровневая ER-диаграмма основных сущностей и их связей. Полная схема содержит 127 таблиц и не помещается на одну страницу — детальная схема доступна в Supabase Studio после применения миграций.'));

content.push(h3('8.2.1. Основные сущности'));
content.push(dataTable(
  ['Сущность', 'Связи', 'Описание'],
  [
    ['User (auth.users)', '1:N profiles, orders, inquiries, messages', 'Аутентифицированный пользователь'],
    ['Profile (public.profiles)', '1:1 User, 1:N UserRoles', 'Расширение auth.users: name, avatar, phone'],
    ['UserRole', 'N:1 Profile', 'Роли (CUSTOMER, CONFECTIONER, и т.д.)'],
    ['Product', 'N:1 Confectioner, 1:N ProductImage, 1:N Review', 'Товар в каталоге'],
    ['Order', '1:N User, 1:N OrderItem, 1:1 Payment, 1:1 Delivery', 'Заказ'],
    ['OrderItem', 'N:1 Order, N:1 Product', 'Позиция заказа (snapshot цены)'],
    ['Payment', '1:1 Order', 'Платёж Yookassa'],
    ['Inquiry', '1:N User, 1:N Negotiation', 'Запрос на индивидуальный торт'],
    ['Negotiation', 'N:1 Inquiry, N:1 Confectioner, 1:N Revision', 'Переговоры по запросу'],
    ['ChatChannel', 'M:N User (through ChannelMember), 1:N Message', 'Канал чата'],
    ['ChatMessage', 'N:1 Channel, N:1 User', 'Сообщение в чате'],
    ['SupportTicket', 'N:1 User, 1:N TicketMessage', 'Тикет поддержки'],
    ['Lead', '1:N LeadActivity', 'Лид в Kanban'],
  ],
  [25, 40, 35]
));

content.push(h2('8.3. RLS политики (Row Level Security)'));
content.push(p('RLS — ключевой механизм безопасности в новой архитектуре. Вместо проверки в каждом API route (как было в v1.0), политики объявляются на уровне БД. Любой запрос через PostgREST или supabase-js автоматически фильтруется.'));

content.push(h3('8.3.1. Примеры политик'));

content.push(p('Таблица orders — пользователи видят только свои заказы:', { indent: { firstLine: 0 }, bold: true }));
content.push(p("CREATE POLICY \"users_select_own_orders\" ON orders\n  FOR SELECT USING (auth.uid() = user_id);", { indent: { firstLine: 0 }, size: 20 }));

content.push(p('Таблица orders — кондитеры видят заказы где они назначены:', { indent: { firstLine: 0 }, bold: true }));
content.push(p("CREATE POLICY \"confectioner_select_assigned_orders\" ON orders\n  FOR SELECT USING (\n    EXISTS (SELECT 1 FROM order_items oi\n           JOIN products p ON oi.product_id = p.id\n           WHERE oi.order_id = orders.id AND p.confectioner_id = auth.uid())\n  );", { indent: { firstLine: 0 }, size: 20 }));

content.push(p('Таблица chat_messages — участники канала видят сообщения:', { indent: { firstLine: 0 }, bold: true }));
content.push(p("CREATE POLICY \"members_select_messages\" ON chat_messages\n  FOR SELECT USING (\n    EXISTS (SELECT 1 FROM chat_channel_members\n           WHERE channel_id = chat_messages.channel_id\n           AND user_id = auth.uid())\n  );", { indent: { firstLine: 0 }, size: 20 }));

content.push(h2('8.4. Миграции'));
content.push(p('Все миграции хранятся в supabase/migrations/ и применяются через `supabase db push`. Миграции нумеруются: 0001_init.sql, 0002_rls.sql, и т.д. Каждая миграция идемпотентна (повторное применение не ломает).'));

content.push(h3('8.4.1. Список миграций'));
content.push(dataTable(
  ['Файл', 'Назначение'],
  [
    ['0001_init.sql', 'Создание всех таблиц (schema из v1.0, нормализованная)'],
    ['0002_rls.sql', 'RLS политики для всех таблиц'],
    ['0003_functions.sql', 'Postgres functions (triggers, scheduled jobs)'],
    ['0004_fts.sql', 'Full Text Search indexes и triggers'],
    ['0005_seed.sql', 'Seed данные (категории, роли, настройки сайта)'],
    ['0006_hybrid_migration.sql', 'Foreign Data Wrapper на старую БД (read-only)'],
  ],
  [35, 65]
));

content.push(h2('8.5. Гибридная миграция данных'));
content.push(p('Для сохранения исторических данных реализована гибридная миграция через PostgreSQL Foreign Data Wrapper (postgres_fdw). Старая БД подключается как foreign server, её таблицы доступны в новой Supabase Postgres как foreign tables (только для чтения).'));

content.push(p('Пример SQL:'));
content.push(p("CREATE EXTENSION postgres_fdw;\nCREATE SERVER old_db FOREIGN DATA WRAPPER postgres_fdw\n  OPTIONS (host 'old-db', dbname 'uyezdny_konditer', port_no '5432');\nCREATE USER MAPPING FOR current_user SERVER old_db\n  OPTIONS (user 'uyezdny', password '...');\nIMPORT FOREIGN SCHEMA public LIMIT TO (orders, users, products)\n  FROM SERVER old_db INTO schema_legacy;", { indent: { firstLine: 0 }, size: 20 }));

content.push(p('API routes читают из schema_legacy.orders для исторических данных и из public.orders для новых. Постепенно (в течение месяца после запуска) исторические данные переносятся в новую БД через ETL-скрипт, и FDW отключается.'));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 9. API endpoints ---
content.push(h1('9. API endpoints (полный список)'));

content.push(p('Ниже представлен полный список всех 58 API endpoints проекта v2.0. Для каждого endpoint указаны: метод, путь, назначение, требуемая роль, тип аутентификации.'));

const apiEndpoints = [
  // Auth
  ['Auth', '/api/auth/callback', 'GET', '—', 'Public', 'OAuth redirect callback'],
  ['Auth', '/api/auth/refresh', 'POST', '—', 'Refresh token', 'Обновление access token'],
  ['Auth', '/api/auth/logout', 'POST', 'USER', 'JWT', 'Выход (revoke session)'],
  ['Auth', '/api/auth/check', 'GET', '—', 'Public', 'Проверка сессии'],
  ['Auth', '/api/profile', 'GET, PATCH', 'USER', 'JWT', 'Профиль пользователя'],
  ['Auth', '/api/profile/avatar', 'POST', 'USER', 'JWT', 'Загрузка аватара'],
  ['Auth', '/api/profile/password', 'PATCH', 'USER', 'JWT', 'Смена пароля'],
  ['Auth', '/api/profile/delete', 'DELETE', 'USER', 'JWT', 'Удаление аккаунта'],
  // Marketplace
  ['Marketplace', '/api/products', 'GET', '—', 'Public', 'Список товаров'],
  ['Marketplace', '/api/products/[id]', 'GET', '—', 'Public', 'Карточка товара'],
  ['Marketplace', '/api/products/[id]/reviews', 'GET, POST', 'USER (POST)', 'JWT (POST)', 'Отзывы'],
  ['Marketplace', '/api/cart', 'GET, POST, DELETE', 'USER', 'JWT', 'Корзина'],
  ['Marketplace', '/api/checkout', 'POST', 'USER', 'JWT + CSRF', 'Оформление заказа'],
  ['Marketplace', '/api/payment/create', 'POST', 'USER', 'JWT + CSRF', 'Создание платежа Yookassa'],
  ['Marketplace', '/api/payment/webhook', 'POST', '—', 'Yookassa signature', 'Webhook от Yookassa'],
  ['Marketplace', '/api/orders', 'GET', 'USER', 'JWT', 'Список заказов'],
  ['Marketplace', '/api/orders/[id]', 'GET, PATCH', 'USER', 'JWT', 'Детали заказа'],
  ['Marketplace', '/api/favorites', 'GET, POST, DELETE', 'USER', 'JWT', 'Избранное'],
  ['Marketplace', '/api/search', 'GET', '—', 'Public', 'Поиск (Postgres FTS)'],
  ['Marketplace', '/api/search/reindex', 'POST', 'ADMIN', 'JWT', 'Переиндексация FTS'],
  // Cake Builder
  ['Cake Builder', '/api/cake-builder/options', 'GET', '—', 'Public', 'Опции конструктора'],
  ['Cake Builder', '/api/inquiries', 'POST', 'USER', 'JWT + CSRF', 'Создать запрос'],
  ['Cake Builder', '/api/inquiries/[id]', 'GET', 'USER', 'JWT', 'Детали запроса'],
  ['Cake Builder', '/api/negotiations', 'GET', 'USER', 'JWT', 'Список переговоров'],
  ['Cake Builder', '/api/negotiations/[id]', 'GET, PATCH', 'USER', 'JWT + CSRF', 'Детали переговоров'],
  ['Cake Builder', '/api/negotiations/[id]/messages', 'GET, POST', 'USER', 'JWT', 'Сообщения в переговорах'],
  // Chat
  ['Chat', '/api/chat/channels', 'GET, POST', 'USER', 'JWT', 'Список каналов, создание'],
  ['Chat', '/api/chat/channels/[id]', 'GET', 'USER', 'JWT', 'Детали канала'],
  ['Chat', '/api/chat/channels/[id]/messages', 'GET, POST', 'USER', 'JWT', 'Сообщения канала'],
  ['Chat', '/api/chat/messages/[id]', 'PATCH, DELETE', 'USER', 'JWT', 'Редактирование, удаление'],
  // CRM
  ['CRM', '/api/support/tickets', 'GET, POST', 'USER', 'JWT', 'Тикеты поддержки'],
  ['CRM', '/api/support/tickets/[id]', 'GET, PATCH', 'USER', 'JWT', 'Детали тикета'],
  ['CRM', '/api/support/tickets/[id]/messages', 'GET, POST', 'USER', 'JWT', 'Сообщения тикета'],
  ['CRM', '/api/crm/leads', 'GET, POST, PATCH', 'ADMIN, SUPPORT', 'JWT', 'Лиды (Kanban)'],
  ['CRM', '/api/crm/leads/[id]', 'GET, PATCH', 'ADMIN, SUPPORT', 'JWT', 'Детали лида'],
  ['CRM', '/api/crm/customers', 'GET', 'ADMIN, SUPPORT', 'JWT', 'Карточки клиентов'],
  ['CRM', '/api/crm/customers/[id]', 'GET', 'ADMIN, SUPPORT', 'JWT', 'Детали клиента (timeline)'],
  // CMS
  ['CMS', '/api/cms/pages', 'GET, POST', 'GET: Public, POST: ADMIN', 'JWT (POST)', 'Динамические страницы'],
  ['CMS', '/api/cms/pages/[slug]', 'GET, PATCH, DELETE', 'GET: Public, PATCH/DELETE: ADMIN', 'JWT', 'Конкретная страница'],
  ['CMS', '/api/cms/banners', 'GET, POST', 'GET: Public, POST: ADMIN', 'JWT', 'Баннеры'],
  ['CMS', '/api/cms/navigation', 'GET, PATCH', 'GET: Public, PATCH: ADMIN', 'JWT', 'Навигация'],
  ['CMS', '/api/cms/settings', 'GET, PATCH', 'GET: Public, PATCH: ADMIN', 'JWT', 'Настройки сайта'],
  ['CMS', '/api/cms/blog', 'GET, POST', 'GET: Public, POST: ADMIN', 'JWT (POST)', 'Блог-посты'],
  // Admin
  ['Admin', '/api/admin/users', 'GET', 'ADMIN', 'JWT', 'Список пользователей'],
  ['Admin', '/api/admin/users/[id]', 'GET, PATCH', 'ADMIN', 'JWT', 'Управление пользователем'],
  ['Admin', '/api/admin/users/[id]/ban', 'POST', 'ADMIN', 'JWT', 'Бан пользователя'],
  ['Admin', '/api/admin/orders', 'GET', 'ADMIN', 'JWT', 'Все заказы (с фильтрами)'],
  ['Admin', '/api/admin/orders/[id]', 'GET, PATCH', 'ADMIN', 'JWT', 'Управление заказом'],
  ['Admin', '/api/admin/finance/stats', 'GET', 'ADMIN', 'JWT', 'Финансовая статистика'],
  ['Admin', '/api/admin/finance/payouts', 'GET, POST', 'ADMIN', 'JWT', 'Выплаты кондитерам'],
  ['Admin', '/api/admin/moderation/reviews', 'GET, PATCH', 'ADMIN, MODERATOR', 'JWT', 'Модерация отзывов'],
  ['Admin', '/api/admin/moderation/products', 'GET, PATCH', 'ADMIN, MODERATOR', 'JWT', 'Модерация товаров'],
  // Telegram
  ['Telegram', '/api/telegram/webhook', 'POST', '—', 'Telegram signature', 'Webhook от Telegram'],
  ['Telegram', '/api/telegram/setup', 'POST', 'ADMIN', 'JWT', 'Установка webhook'],
  ['Telegram', '/api/telegram/test', 'POST', 'ADMIN', 'JWT', 'Тестовая отправка сообщения'],
  // Notifications
  ['Notifications', '/api/notifications', 'GET', 'USER', 'JWT', 'Список уведомлений'],
  ['Notifications', '/api/notifications/[id]/read', 'PATCH', 'USER', 'JWT', 'Отметка о прочтении'],
  ['Notifications', '/api/notifications/subscribe', 'GET', 'USER', 'JWT', 'Web Push subscription'],
  // Health
  ['System', '/api/health', 'GET', '—', 'Public', 'Health check для Caddy/UptimeRobot'],
];

content.push(dataTable(
  ['Модуль', 'Endpoint', 'Метод', 'Роль', 'Auth', 'Назначение'],
  apiEndpoints,
  [12, 25, 12, 13, 15, 23]
));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 10. UI страницы ---
content.push(h1('10. UI страницы (полный список)'));

content.push(p('Ниже представлены все 26 публичных страниц и 5 личных кабинетов. Все страницы сохраняются из v1.0 без визуальных изменений — только backend переписывается на Supabase.'));

content.push(h2('10.1. Публичные страницы'));

const publicPages = [
  ['/', 'home', 'Главная: hero, фичи, категории, популярные товары, отзывы'],
  ['/catalog', 'catalog', 'Каталог товаров с фильтрами (категория, цена, кондитер, рейтинг)'],
  ['/catalog/[id]', 'product', 'Карточка товара (фото, описание, отзывы, похожие)'],
  ['/confectioners', 'confectioners', 'Список кондитеров с фильтрами (город, специализация, рейтинг)'],
  ['/confectioners/[id]', 'confectioner-profile', 'Профиль кондитера (товары, отзывы, о себе)'],
  ['/recipes', 'recipes', 'Рецепты от кондитеров'],
  ['/recipes/[id]', 'recipe-detail', 'Детальная страница рецепта'],
  ['/blog', 'blog', 'Блог (статьи о кондитерском деле)'],
  ['/faq', 'faq', 'FAQ — часто задаваемые вопросы'],
  ['/help', 'help', 'Помощь и поддержка'],
  ['/about', 'about', 'О компании (динамическая через CMS)'],
  ['/about?legal=terms', 'legal-terms', 'Условия использования'],
  ['/about?legal=privacy', 'legal-privacy', 'Политика конфиденциальности'],
  ['/about?legal=consent', 'legal-consent', 'Согласие на обработку данных'],
  ['/about?legal=cookies', 'legal-cookies', 'Политика cookies'],
  ['/contacts', 'contacts', 'Контакты (адрес, телефон, email, карта)'],
  ['/reviews', 'reviews', 'Отзывы о сервисе'],
  ['/checkout', 'checkout', 'Оформление заказа (корзина → адрес → оплата)'],
  ['/promotions', 'promotions', 'Акции и скидки'],
  ['/ready-made', 'ready-made', 'Готовые торты (быстрая доставка)'],
  ['/tenders', 'tenders', 'Тендеры (для корпоративных заказов)'],
  ['/corporate-events', 'corporate-events', 'Корпоративные мероприятия'],
  ['/decor-shop', 'decor-shop', 'Магазин декора (для кондитеров)'],
  ['/services-shop', 'services-shop', 'Услуги (доставка, монтаж, и т.д.)'],
  ['/supplier-shop', 'supplier-shop', 'Магазин поставщиков (ингредиенты)'],
  ['/gift-certificates', 'gift-certificates', 'Подарочные сертификаты'],
];

content.push(dataTable(
  ['URL', 'View', 'Описание'],
  publicPages,
  [25, 20, 55]
));

content.push(h2('10.2. Личные кабинеты (Dashboards)'));

content.push(dataTable(
  ['URL', 'Роль', 'Описание'],
  [
    ['/dashboard', 'CUSTOMER', 'Личный кабинет покупателя'],
    ['/dashboard', 'CONFECTIONER', 'Личный кабинет кондитера'],
    ['/dashboard', 'SUPPLIER', 'Личный кабинет поставщика'],
    ['/dashboard', 'COURIER', 'Личный кабинет курьера'],
    ['/dashboard', 'ADMIN', 'Админ-панель'],
  ],
  [20, 25, 55]
));

content.push(p('Маршрут /dashboard один для всех ролей. После авторизации пользователь автоматически перенаправляется в нужный дашборд по своей роли (через useAppStore + roleSwitcher).'));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 11. План миграции ---
content.push(h1('11. План миграции (14 дней)'));

content.push(p('Подробный календарный план на 2 недели. Каждый день — конкретные задачи с критериями приёмки. В конце каждого этапа — обязательная верификация через тесты + скриншоты + health-check.'));

content.push(h2('11.1. Этап 1: Setup Supabase (дни 1-2)'));
content.push(h3('День 1: Docker-стек + инициализация'));
content.push(numbered('Создать новый docker-compose.yml с Supabase сервисами (по официальному шаблону).'));
content.push(numbered('Сгенерировать SECRET_KEY, ANON_KEY, SERVICE_ROLE_KEY через `supabase gen keys`.'));
content.push(numbered('Запустить `docker compose up -d` — проверить что все 10 Supabase контейнеров здоровы.'));
content.push(numbered('Открыть Supabase Studio на http://localhost:8000 — проверить UI доступен.'));
content.push(numbered('Настроить .env с NEXT_PUBLIC_SUPABASE_URL и ключами.'));
content.push(h3('День 2: Схема БД + миграции'));
content.push(numbered('Конвертировать prisma/schema.prisma в SQL миграции (через `prisma migrate diff --from-empty --to-schema-datamodel --script`).'));
content.push(numbered('Адаптировать SQL под Postgres 15 (заменить unsupported типы, добавить UUID).'));
content.push(numbered('Создать supabase/migrations/0001_init.sql с полной схемой.'));
content.push(numbered('Применить через `supabase db push` — проверить что 127 таблиц созданы.'));
content.push(numbered('Создать 0002_rls.sql с RLS-политиками для всех таблиц с user data.'));
content.push(numbered('Создать 0003_functions.sql с триггерами (updated_at, FTS, unread count).'));

content.push(callout('Критерии приёмки этапа 1', 'Все 10 Supabase контейнеров healthy. Studio открывается. 127 таблиц созданы. RLS включён на всех таблицах с user data. Скриншот Studio → Table Editor → список таблиц.'));

content.push(h2('11.2. Этап 2: Auth + Profile (дни 3-4)'));
content.push(h3('День 3: Auth интеграция'));
content.push(numbered('Установить @supabase/supabase-js и @supabase/ssr.'));
content.push(numbered('Создать src/lib/supabase/{browser,server,middleware,admin}.ts клиенты.'));
content.push(numbered('Настроить src/middleware.ts — refresh session на каждом запросе.'));
content.push(numbered('Переписать AuthModal — использовать supabase.auth.signInWithPassword, signUp, signInWithOAuth.'));
content.push(numbered('Реализовать /api/auth/callback для OAuth redirect.'));
content.push(numbered('Настроить OAuth providers в Studio: Google, Яндекс, ВКонтакте (dev credentials).'));

content.push(h3('День 4: Profile + Roles'));
content.push(numbered('Создать public.profiles таблицу (extension of auth.users).'));
content.push(numbered('Создать public.user_roles таблицу (user_id, role, is_active).'));
content.push(numbered('Реализовать trigger: при INSERT в auth.users → создавать profile с ролью CUSTOMER.'));
content.push(numbered('Переписать AvatarUpload — использовать supabase.storage.from(\'avatars\').upload().'));
content.push(numbered('Переписать ProfileSettings — смена пароля через supabase.auth.updateUser().'));
content.push(numbered('Реализовать RoleSwitcher — переключение между ролями (если у user несколько ролей).'));

content.push(callout('Критерии приёмки этапа 2', 'Регистрация нового пользователя (email+pass) → письмо подтверждения → вход. OAuth через Google работает. Загрузка аватара в storage. Смена пароля. Скриншоты: AuthModal, profile settings, avatar upload. Unit-тесты: ≥20 новых тестов.'));

content.push(h2('11.3. Этап 3: Marketplace (дни 5-6)'));
content.push(h3('День 5: Каталог + товар'));
content.push(numbered('Создать таблицы products, product_categories, product_images, product_attributes.'));
content.push(numbered('Реализовать /api/products (GET) — список с фильтрами через PostgREST (supabase.from(\'products\').select().eq().range()).'));
content.push(numbered('Реализовать /api/products/[id] (GET) — детали + related products.'));
content.push(numbered('Переписать CatalogPage — использовать TanStack Query + supabase-js.'));
content.push(numbered('Переписать ProductPage — отзывы, добавление в корзину, избранное.'));
content.push(numbered('Настроить FTS: 0004_fts.sql миграция + trigger на INSERT/UPDATE products.'));

content.push(h3('День 6: Корзина + заказ + оплата'));
content.push(numbered('Создать таблицы cart_items, orders, order_items, payments, deliveries.'));
content.push(numbered('Реализовать /api/cart (GET, POST, DELETE) — корзина работает даже без логина (session ID).'));
content.push(numbered('Реализовать /api/checkout — создание order + Yookassa payment.'));
content.push(numbered('Реализовать /api/payment/webhook — приём webhook от Yookassa, обновление order.status.'));
content.push(numbered('Реализовать /api/orders (GET) — список заказов пользователя.'));
content.push(numbered('Переписать CheckoutPage — выбор адреса, способ доставки, оплата.'));

content.push(callout('Критерии приёмки этапа 3', 'Каталог отображается с фильтрами. Поиск работает. Добавление в корзину. Оформление заказа с оплатой (test mode Yookassa). Webhook обновляет статус заказа. E2E тест: полный цикл от каталога до оплаченного заказа.'));

content.push(h2('11.4. Этап 4: Cake Builder + Chat (дни 7-8)'));
content.push(h3('День 7: Cake Builder'));
content.push(numbered('Создать таблицы cake_builder_options, inquiries, negotiations, negotiation_revisions, negotiation_messages.'));
content.push(numbered('Заполнить cake_builder_options seed-данными (bases, fillings, coatings, decorations).'));
content.push(numbered('Переписать CakeBuilderDialog — все 8 шагов, отправка inquiry.'));
content.push(numbered('Реализовать /api/inquiries (POST) — создание inquiry + negotiations для выбранных кондитеров.'));
content.push(numbered('Реализовать /api/negotiations (GET, PATCH) — список и смена статуса.'));

content.push(h3('День 8: Chat (Supabase Realtime)'));
content.push(numbered('Создать таблицы chat_channels, chat_channel_members, chat_messages, chat_message_reads.'));
content.push(numbered('Реализовать useChat hook — подписка на postgres_changes (INSERT messages).'));
content.push(numbered('Переписать ChatWidget — отправка/приём сообщений через Realtime.'));
content.push(numbered('Реализовать unread count через chat_message_reads.'));
content.push(numbered('Добавить typing indicator через broadcast events.'));
content.push(numbered('Добавить presence (online/offline статус).'));

content.push(callout('Критерии приёмки этапа 4', 'Конструктор тортов проходит все 8 шагов. Inquiry создаётся, кондитеры видят его в дашборде. Чат работает в realtime — сообщения доставляются мгновенно. Typing indicator работает. Unread count обновляется.'));

content.push(h2('11.5. Этап 5: Dashboards (дни 9-10)'));
content.push(h3('День 9: Customer + Confectioner dashboards'));
content.push(numbered('Переписать CustomerDashboard — заказы, избранное, адреса, бонусы.'));
content.push(numbered('Переписать ConfectionerDashboard — inquiries, negotiations, товары, календарь, финансы.'));
content.push(numbered('Реализовать календарь заказов (даты доставки).'));
content.push(numbered('Реализовать финансовый блок (доход, payouts, комиссии).'));

content.push(h3('День 10: Supplier + Courier + Admin dashboards'));
content.push(numbered('Переписать SupplierDashboard — товары, склад, B2B заказы.'));
content.push(numbered('Переписать CourierDashboard — активные доставки, статус, заработок.'));
content.push(numbered('Переписать AdminDashboard — пользователи, заказы, финансы, CRM, CMS, модерация, аналитика.'));
content.push(numbered('Реализовать RoleSwitcher — переключение между ролями для тестов.'));

content.push(callout('Критерии приёмки этапа 5', 'Все 5 дашбордов рендерятся корректно. Переключение ролей работает. Каждый дашборд показывает реальные данные из БД (seed). Скриншоты всех 5 дашбордов.'));

content.push(h2('11.6. Этап 6: CRM + CMS + Automation (дни 11-12)'));
content.push(h3('День 11: CRM + CMS'));
content.push(numbered('Создать таблицы support_tickets, leads, customer_profiles, customer_timeline.'));
content.push(numbered('Переписать тикеты поддержки (список, детали, сообщения).'));
content.push(numbered('Переписать Kanban-доску лидов (drag-and-drop через @dnd-kit).'));
content.push(numbered('Создать таблицы cms_pages, cms_banners, cms_navigation, cms_site_settings.'));
content.push(numbered('Переписать CMS admin — CRUD страниц через @mdxeditor, баннеры, навигация.'));

content.push(h3('День 12: Automation (замена n8n)'));
content.push(numbered('Создать supabase/functions/abandoned-cart/ — Edge Function (Deno).'));
content.push(numbered('Настроить pg_cron: SELECT cron.schedule(\'abandoned-cart\', \'0 * * * *\', $$SELECT net.http_post(...));$$);'));
content.push(numbered('Создать supabase/functions/daily-digest/ — ежедневный дайджест.'));
content.push(numbered('Создать supabase/functions/bonus-expiry/ — сгорание бонусов.'));
content.push(numbered('Создать supabase/functions/telegram-webhook/ — приём webhook от Telegram.'));
content.push(numbered('Создать supabase/functions/send-notification/ — отправка в @conditera канал.'));

content.push(callout('Критерии приёмки этапа 6', 'Тикеты создаются и отвечаются. Kanban работает (drag-and-drop). CMS-страницы редактируются через WYSIWYG. Edge Functions deploy через `supabase functions deploy`. pg_cron jobs видны в cron.job table.'));

content.push(h2('11.7. Этап 7: Тестирование + деплой (дни 13-14)'));
content.push(h3('День 13: Тесты + health-check'));
content.push(numbered('Дописать unit-тесты для всех новых модулей (цель: ≥500 тестов).'));
content.push(numbered('Обновить Playwright e2e: 20+ сценариев (регистрация, заказ, оплата, чат, дашборды).'));
content.push(numbered('Создать scripts/health-check.sh — curl всех 58 API endpoints, отчёт в .md.'));
content.push(numbered('Прогнать health-check на dev — все endpoints должны вернуть 200 или ожидаемые 4xx.'));
content.push(numbered('Сделать скриншоты всех 26 страниц + 5 дашбордов (через Playwright).'));

content.push(h3('День 14: Деплой + финальная проверка'));
content.push(numbered('Настроить GitHub Actions: .github/workflows/deploy.yml (build → SSH → docker compose up).'));
content.push(numbered('Добавить GitHub Secrets: SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, YOOKASSA_*, TELEGRAM_*.'));
content.push(numbered('Настроить Cloudflare Tunnel: ingress → http://localhost:80 (Caddy).'));
content.push(numbered('Настроить Caddyfile: conditera.ru → reverse_proxy web:3000 + supabase-studio:3000 → /studio.'));
content.push(numbered('Запустить production-деплой: git push → CI → SSH → docker compose up -d.'));
content.push(numbered('Проверить https://conditera.ru/ — все страницы доступны, без 502.'));
content.push(numbered('Проверить /api/health — 200 OK.'));
content.push(numbered('Прогнать health-check.sh на production.'));

content.push(callout('Критерии приёмки финального этапа', 'Production деплой через git push работает. Все 26 страниц возвращают 200. Все 58 API endpoints здоровы. Cloudflare Tunnel стабилен, без 502. Полный цикл (регистрация → заказ → оплата → уведомление в Telegram) работает на production.'));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 12. Критерии приёмки ---
content.push(h1('12. Критерии приёмки'));

content.push(p('Проект принимается по 4 независимым методам проверки. Все 4 должны быть пройдены для закрытия задачи.'));

content.push(h2('12.1. Unit-тесты (обязательно)'));
content.push(dataTable(
  ['Модуль', 'Минимум тестов', 'Покрытие'],
  [
    ['Auth', '30 тестов', 'Регистрация, логин, OAuth, 2FA, password reset, session refresh'],
    ['Marketplace', '50 тестов', 'Каталог, фильтры, корзина, заказ, оплата, поиск'],
    ['Cake Builder', '20 тестов', 'Опции, расчёт цены, inquiry, negotiations'],
    ['Chat', '15 тестов', 'Каналы, сообщения, unread, realtime подписки'],
    ['CRM', '20 тестов', 'Тикеты, лиды, timeline'],
    ['CMS', '15 тестов', 'CRUD страниц, баннеров, навигации'],
    ['Finance', '30 тестов', 'Расчёт цен, доставка, налоги, payouts'],
    ['Validation', '50 тестов', 'Zod-схемы для всех API payloads'],
    ['Security', '20 тестов', 'RLS политики, sanitize, rate-limit'],
    ['Utils', '50 тестов', 'Хелперы, формatters, hooks'],
    ['ИТОГО', '≥300 новых тестов', ''],
  ],
  [25, 20, 55]
));

content.push(h2('12.2. E2E тесты (Playwright)'));
content.push(dataTable(
  ['Сценарий', 'Шаги'],
  [
    ['Регистрация + логин', 'Открыть / → клик Войти → регистрация → подтвердить почту → вход → профиль'],
    ['OAuth Google', 'Открыть / → Войти через Google → редирект → профиль'],
    ['Покупка товара', 'Каталог → карточка → в корзину → checkout → оплата (test) → заказ создан'],
    ['Конструктор торта', 'Главная → Конструктор → 8 шагов → отправка inquiry → виден в дашборде кондитера'],
    ['Чат с кондитером', 'Дашборд → сообщение → realtime → кондитер видит → отвечает'],
    ['Тикет поддержки', 'Help → создать тикет → ответ support → закрыть'],
    ['Kanban лидов', 'Admin → CRM → перетянуть лид new → contacted → won'],
    ['CMS страница', 'Admin → CMS → создать страницу → опубликовать → видна на /about'],
    ['Админ-панель', 'Admin → список пользователей → бан → восстановление'],
    ['Telegram уведомление', 'Создать заказ → уведомление в @conditera канал'],
    ['Mobile responsive', 'iPhone 14 → все ключевые страницы без горизонтального скролла'],
    ['Security headers', 'curl -I → CSP, HSTS, X-Frame-Options, Permissions-Policy'],
    ['CSRF protection', 'POST без X-CSRF-Token → 403'],
    ['Rate limiting', '100 запросов /min на /api/auth → 429'],
    ['Realtime chat', '2 браузера → сообщение → доставлено в обоих'],
    ['Search', 'Поиск "торт" → результаты с подсветкой'],
    ['Favorites', 'Товар в избранное → виден в дашборде → удалить'],
    ['Avatar upload', 'Профиль → загрузить фото → crop → сохранение'],
    ['Order status', 'Заказ paid → кондитер accepted → preparing → ready → shipped → delivered'],
    ['Payouts', 'Admin → создать payout кондитеру → статус updated'],
  ],
  [30, 70]
));

content.push(h2('12.3. Health-check скрипт'));
content.push(p('scripts/health-check.sh — bash-скрипт, который curl-ит все 58 API endpoints и генерирует отчёт в Markdown. Скрипт запускается после каждого деплоя.'));

content.push(p('Пример вывода:'));
content.push(p("## Health Check Report — 2026-08-29 14:32:15\n\n✓ GET /api/health — 200 (5ms)\n✓ GET /api/products — 200 (45ms)\n✓ GET /api/products/123 — 200 (32ms)\n✗ POST /api/cart — 500 (timeout)\n✓ GET /api/orders — 200 (78ms)\n...\n\nTotal: 56/58 passed (96.6%)", { indent: { firstLine: 0 }, size: 20 }));

content.push(h2('12.4. Ручное тестирование'));
content.push(p('После автоматизированной проверки — ручной проход по ключевым сценариям на staging-окружении:'));
content.push(numbered('Регистрация нового пользователя (email+pass)'));
content.push(numbered('Подтверждение почты (через Mailpit в dev)'));
content.push(numbered('Вход в личный кабинет покупателя'));
content.push(numbered('Покупка товара (test Yookassa)'));
content.push(numbered('Конструктор торта → отправка inquiry'));
content.push(numbered('Переключение на роль кондитера → принятие inquiry'));
content.push(numbered('Чат с покупателем'));
content.push(numbered('Переключение на роль курьера → доставка'));
content.push(numbered('Переключение на роль админа → проверка заказа в CRM'));
content.push(numbered('Проверка Telegram-уведомления в канале'));

content.push(h2('12.5. Скриншоты (доказательство работы)'));
content.push(p('После каждого этапа — скриншоты всех ключевых экранов. Скриншоты сохраняются в /home/z/my-project/download/screenshots/ и прилагаются к отчёту о готовности этапа.'));

content.push(dataTable(
  ['Этап', 'Скриншоты'],
  [
    ['1. Setup', 'Supabase Studio: Table Editor, Auth users, Storage buckets'],
    ['2. Auth', 'AuthModal (login), AuthModal (register), OAuth Google redirect, Profile settings, Avatar upload'],
    ['3. Marketplace', 'Catalog (with filters), Product detail, Cart, Checkout, Order confirmation'],
    ['4. Cake Builder + Chat', 'Cake builder step 1-8, Inquiry sent, Chat widget, Typing indicator'],
    ['5. Dashboards', 'Customer, Confectioner, Supplier, Courier, Admin'],
    ['6. CRM + CMS', 'Tickets list, Kanban, CMS page editor, Banner manager'],
    ['7. Final', 'Production homepage (https://conditera.ru), /api/health response, Cloudflare Tunnel status'],
  ],
  [25, 75]
));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 13. Риски и митигация ---
content.push(h1('13. Риски и митигация'));

content.push(dataTable(
  ['Риск', 'Вероятность', 'Влияние', 'Митигация'],
  [
    ['OOM при работе Supabase (10+ контейнеров)', 'Средняя', 'High', 'Мониторинг RAM через docker stats, upgrade VPS до 8GB если нужно'],
    ['RLS-политики слишком строгие → API ломается', 'Высокая', 'High', 'Сначала политики DEFAULT PERMISSIVE, потом tighten. Unit-тесты на RLS.'],
    ['Yookassa webhook не доходит (firewall)', 'Низкая', 'High', 'Тест через Yookassa sandbox, логировать все webhook requests'],
    ['Cloudflare Tunnel 502 при деплое', 'Средняя', 'Medium', 'Health-check в Caddyfile + /healthz endpoint + tunnel → Caddy (не web)'],
    ['Realtime не работает за Cloudflare', 'Низкая', 'High', 'Cloudflare поддерживает WebSocket, тест в production'],
    ['OAuth providers не настроены', 'Высокая', 'Medium', 'Сначала email+pass, OAuth добавляется позже через Studio UI'],
    ['Миграция schema ломает исторические данные', 'Низкая', 'High', 'Гибрид через FDW (read-only), backup перед миграцией'],
    ['Edge Functions timeout (Deno cold start)', 'Средняя', 'Low', 'Warm-up через cron, fallback на Next.js API route'],
    ['pg_cron не запускается', 'Низкая', 'Medium', 'Проверять через SELECT * FROM cron.job, логировать запуски'],
    ['Supabase Studio доступна публично', 'Средняя', 'High', 'Защитить через Caddy basic auth на /studio path'],
    ['Backup БД не работает', 'Низкая', 'High', 'scripts/backup.sh + cron + проверка restore в dev'],
    ['JWT secret leak', 'Низкая', 'Critical', 'Хранить в GitHub Secrets, не в .env. Rotate при компрометации'],
  ],
  [30, 12, 12, 46]
));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 14. Rollback plan ---
content.push(h1('14. План отката (Rollback)'));

content.push(p('Если после деплоя v2.0 обнаружены критические проблемы, выполняется откат к v1.0. Откат возможен в течение 7 дней после запуска v2.0 (пока старая БД ещё жива).'));

content.push(h2('14.1. Критерии для отката'));
content.push(bullet('Health-check показывает <80% endpoints healthy.'));
content.push(bullet('Полный цикл покупки не работает (невозможно оформить заказ) >2 часов.'));
content.push(bullet('Cloudflare Tunnel нестабилен (>5% 502 errors за час).'));
content.push(bullet('OOM-killer убивает Supabase контейнеры >3 раз за день.'));

content.push(h2('14.2. Процедура отката'));
content.push(numbered('В GitHub Actions: выбрать последний успешный билд v1.0 → re-run deploy.'));
content.push(numbered('SSH на сервер: `git checkout v1.0-last-stable && docker compose up -d`.'));
content.push(numbered('Cloudflare Tunnel: переключить ingress обратно на web:3000 (минуя Caddy health check).'));
content.push(numbered('Восстановить старую БД из backup: `docker exec conditera-db pg_restore -d uyezdny_konditer /backup/last.dump`.'));
content.push(numbered('Проверить /api/health — должен вернуть 200.'));
content.push(numbered('Отправить уведомление пользователям: "Произошёл откат, извините за неудобства".'));

content.push(h2('14.3. Что НЕ подлежит откату'));
content.push(bullet('Новые заказы, созданные в v2.0 — остаются в новой БД (доступны через FDW в v1.0).'));
content.push(bullet('Новые пользователи, зарегистрированные в v2.0 — остаются в Supabase Auth (не в старой БД).'));
content.push(bullet('Edge Functions logs — остаются в Supabase Analytics.'));
content.push(bullet('Realtime сообщения — остаются в новой chat_messages таблице.'));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 15. Ресурсы ---
content.push(h1('15. Ресурсы и требования'));

content.push(h2('15.1. VPS требования'));
content.push(dataTable(
  ['Параметр', 'Минимум', 'Рекомендуется', 'Текущий VPS'],
  [
    ['CPU', '2 cores', '4 cores', '2 cores'],
    ['RAM', '4 GB', '8 GB', '4 GB'],
    ['SSD', '40 GB', '80 GB', '40 GB'],
    ['Bandwidth', '100 Mbps', '1 Gbps', '100 Mbps'],
    ['OS', 'Ubuntu 22.04', 'Ubuntu 24.04', 'Ubuntu 22.04'],
    ['Docker', '24+', '27+', '24+'],
  ],
  [25, 20, 20, 35]
));

content.push(callout('Внимание: RAM', 'Текущий VPS (4 GB) может быть недостаточен для Supabase (10 контейнеров ~1.5 GB) + Next.js (400 MB) + Caddy (50 MB). Если начнутся OOM — нужно upgrade до 8 GB. Альтернатива: включить swap file 4 GB на сервере.'));

content.push(h2('15.2. Стоимость'));
content.push(dataTable(
  ['Ресурс', 'Стоимость/мес', 'Примечание'],
  [
    ['VPS (текущий)', '₽1 500', '4 GB RAM, 40 GB SSD, без публичного IP'],
    ['Домен conditera.ru', '₽300/год', 'Продление в Reg.ru/Beget'],
    ['Cloudflare', 'Free', 'DNS + Tunnel + WAF (free tier)'],
    ['Yookassa', 'Комиссия 3.5%', 'Только за успешные платежи'],
    ['SMTP (Mailgun)', '$0 (free)', '10k emails/мес в free tier'],
    ['Telegram Bot API', 'Free', 'Без ограничений'],
    ['Яндекс Метрика', 'Free', 'Без ограничений'],
    ['Supabase (self-hosted)', '₽0', 'Размещается на нашем VPS'],
    ['Backup storage (S3)', '₽100', 'Yandex Object Storage 10 GB'],
    ['ИТОГО', '₽2 000/мес', 'Без hidden costs'],
  ],
  [30, 20, 50]
));

content.push(h2('15.3. Команда и роли'));
content.push(dataTable(
  ['Роль', 'Человек', 'Задачи'],
  [
    ['Lead developer', '1 (AI)', 'Архитектура, код, тесты, деплой'],
    ['Code reviewer', '1 (пользователь)', 'Ревью кода, приёмка этапов'],
    ['Tester', '1 (пользователь)', 'Ручное тестирование, скриншоты'],
    ['DevOps', '1 (AI)', 'Docker, CI/CD, мониторинг'],
  ],
  [30, 15, 55]
));

content.push(new Paragraph({ children: [new PageBreak()] }));

// --- 16. Приложения ---
content.push(h1('16. Приложения'));

content.push(h2('16.1. Глоссарий'));
content.push(dataTable(
  ['Термин', 'Определение'],
  [
    ['Supabase', 'Open-source платформа BaaS, предоставляющая Postgres, Auth, Realtime, Storage'],
    ['PostgREST', 'Сервис, генерирующий REST API из PostgreSQL схемы автоматически'],
    ['GoTrue', 'Auth сервис Supabase (JWT, OAuth, 2FA, Magic Link)'],
    ['RLS', 'Row Level Security — политики на уровне БД, фильтрующие строки'],
    ['Edge Function', 'Serverless функция на Deno, запускается при HTTP запросе или по расписанию'],
    ['pg_cron', 'PostgreSQL extension для scheduled jobs (запуск SQL по cron)'],
    ['pgsodium', 'PostgreSQL extension для шифрования (column-level, RLS)'],
    ['FDW', 'Foreign Data Wrapper — подключение внешних БД как foreign tables'],
    ['FTS', 'Full Text Search — встроенный в Postgres поиск по tsvector'],
    ['TSVector', 'Postgres тип для полнотекстового поиска (нормализованный текст)'],
    ['GIN index', 'Generalized Inverted Index — для FTS и trigram поиска'],
    ['Cloudflare Tunnel', 'VPN-туннель от Cloudflare, доступ к серверу без публичного IP'],
    ['Caddy', 'Web-сервер с авто-HTTPS и reverse proxy'],
    ['Yookassa', 'Российский платёжный шлюз (ЮKassa)'],
    ['Magic Link', 'Бесшарольный вход через одноразовую ссылку в почте'],
    ['TOTP', 'Time-based One-Time Password — 2FA через Google Authenticator'],
    ['JWT', 'JSON Web Token — stateless token для аутентификации'],
    ['CSRF', 'Cross-Site Request Forgery — атака, требует CSRF token'],
    ['CSP', 'Content-Security-Policy — header для защиты от XSS'],
    ['HSTS', 'HTTP Strict Transport Security — принудительный HTTPS'],
  ],
  [25, 75]
));

content.push(h2('16.2. Полезные команды'));

content.push(h3('16.2.1. Docker'));
content.push(p('# Запуск всего стека', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('docker compose up -d', { indent: { firstLine: 0 }, size: 20 }));
content.push(p('# Логи всех сервисов', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('docker compose logs -f --tail=50', { indent: { firstLine: 0 }, size: 20 }));
content.push(p('# Перезапуск только web', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('docker compose restart web', { indent: { firstLine: 0 }, size: 20 }));
content.push(p('# Остановка + удаление volumes (ВНИМАНИЕ: потеря данных)', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('docker compose down -v', { indent: { firstLine: 0 }, size: 20 }));

content.push(h3('16.2.2. Supabase CLI'));
content.push(p('# Применить миграции', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('supabase db push', { indent: { firstLine: 0 }, size: 20 }));
content.push(p('# Создать новую миграцию', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('supabase migration new add_users_table', { indent: { firstLine: 0 }, size: 20 }));
content.push(p('# Deploy Edge Function', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('supabase functions deploy telegram-webhook', { indent: { firstLine: 0 }, size: 20 }));
content.push(p('# Генерация TypeScript типов из схемы', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('supabase gen types typescript --local > src/types/supabase.ts', { indent: { firstLine: 0 }, size: 20 }));

content.push(h3('16.2.3. Health-check'));
content.push(p('# Проверить все API endpoints', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('bash scripts/health-check.sh', { indent: { firstLine: 0 }, size: 20 }));
content.push(p('# Проверить только /api/health', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('curl -sS https://conditera.ru/api/health | jq .', { indent: { firstLine: 0 }, size: 20 }));

content.push(h3('16.2.4. Backup'));
content.push(p('# Создать backup БД', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('docker exec conditera-db pg_dump -U uyezdny uyezdny_konditer > backup_$(date +%Y%m%d).sql', { indent: { firstLine: 0 }, size: 20 }));
content.push(p('# Восстановить из backup', { indent: { firstLine: 0 }, bold: true, size: 20 }));
content.push(p('cat backup_20260816.sql | docker exec -i conditera-db psql -U uyezdny uyezdny_konditer', { indent: { firstLine: 0 }, size: 20 }));

content.push(h2('16.3. Ссылки на документацию'));
content.push(bullet('Supabase self-hosting: https://supabase.com/docs/guides/self-hosting'));
content.push(bullet('Supabase Auth: https://supabase.com/docs/guides/auth'));
content.push(bullet('Supabase Realtime: https://supabase.com/docs/guides/realtime'));
content.push(bullet('Supabase Storage: https://supabase.com/docs/guides/storage'));
content.push(bullet('Supabase Edge Functions: https://supabase.com/docs/guides/functions'));
content.push(bullet('PostgREST: https://postgrest.org/en/stable/'));
content.push(bullet('PostgreSQL RLS: https://www.postgresql.org/docs/15/ddl-rowsecurity.html'));
content.push(bullet('PostgreSQL FTS: https://www.postgresql.org/docs/15/textsearch.html'));
content.push(bullet('Next.js 16 App Router: https://nextjs.org/docs/app'));
content.push(bullet('Caddy documentation: https://caddyserver.com/docs/'));
content.push(bullet('Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/'));
content.push(bullet('Yookassa API: https://yookassa.ru/developers/api'));

content.push(h2('16.4. История изменений документа'));
content.push(dataTable(
  ['Версия', 'Дата', 'Изменения'],
  [
    ['1.0', 'август 2026', 'Первичная версия ТЗ (Next.js + Prisma + PostgreSQL)'],
    ['2.0', '16 августа 2026', 'Полная переработка: миграция на self-hosted Supabase, замена n8n/Meilisearch/Socket.IO на Supabase аналоги'],
  ],
  [15, 25, 60]
));

// ===== END CONTENT =====

// ===== ASSEMBLY =====
const doc = new Document({
  creator: 'Super Z (GLM)',
  title: 'ТЗ Уездный кондитер v2.0',
  description: 'Техническое задание на реконструкцию маркетплейса «Уездный кондитер» с переносом на self-hosted Supabase',

  styles: {
    default: {
      document: {
        run: { font: FONT_BODY, size: 22, color: c(P.body) },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FONT_HEADING, size: 36, bold: true, color: c(P.primary) },
        paragraph: { spacing: { before: 480, after: 240, line: 312 } },
      },
      heading2: {
        run: { font: FONT_HEADING, size: 28, bold: true, color: c(P.primary) },
        paragraph: { spacing: { before: 360, after: 180, line: 312 } },
      },
      heading3: {
        run: { font: FONT_HEADING, size: 24, bold: true, color: c(P.dark) },
        paragraph: { spacing: { before: 240, after: 120, line: 312 } },
      },
    },
  },

  numbering: {
    config: [{
      reference: 'main-list',
      levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ],
    }],
  },

  sections: [
    // Section 1: Cover
    {
      properties: {
        page: { margin: { top: 0, bottom: 0, left: 0, right: 0 } },
        type: SectionType.NEXT_PAGE,
      },
      children: buildCover(),
    },
    // Section 2: TOC
    {
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
        type: SectionType.NEXT_PAGE,
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: c(P.secondary) })],
          })],
        }),
      },
      children: buildToc(),
    },
    // Section 3: Body
    {
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
        type: SectionType.NEXT_PAGE,
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { after: 0 },
            children: [
              new TextRun({ text: 'ТЗ v2.0 — «Уездный кондитер»', size: 18, color: c(P.secondary), italics: true }),
            ],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: c(P.border), space: 4 } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Страница ', size: 18, color: c(P.secondary) }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: c(P.secondary) }),
              new TextRun({ text: ' из ', size: 18, color: c(P.secondary) }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: c(P.secondary) }),
            ],
          })],
        }),
      },
      children: content,
    },
  ],
});

Packer.toBuffer(doc).then(buf => {
  const outPath = '/home/z/my-project/download/ТЗ_Уездный_кондитер_v2.0_Supabase.docx';
  fs.writeFileSync(outPath, buf);
  console.log(`✓ Document generated: ${outPath}`);
  console.log(`  Size: ${(buf.length / 1024).toFixed(1)} KB`);
});
