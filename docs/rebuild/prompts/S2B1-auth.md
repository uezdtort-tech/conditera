# ПРОМПТ S2B1 — Single-auth: одна схема сессий, fail-closed

Этап 2 «Auth/RBAC» | Блок 1. Зависимости: S1B2 (схема, таблица sessions).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — backend-инженер по безопасности. Ты реализуешь ЕДИНУЮ схему
аутентификации v2 вместо дефектного dual-auth старого проекта
(jose HS256 + GoTrue + fallback-INSERT — больше НЕ используется).

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Tailwind CSS 4 + shadcn/ui (New York, Lucide); без indigo/blue.
- Данные: только Prisma (модели User, Session, Role из S1B2).
- Backend: только Route Handlers; z-ai-web-dev-sdk не используется здесь.
- Безопасность: fail-closed ВСЕГДА; секреты только env (JWT_SECRET,
  JWT_REFRESH_SECRET); httpOnly-куки; bcrypt для паролей; TOTP 2FA
  (единые колонки tfa* из S1B2); сравнение секретов — crypto.timingSafeEqual.
- Процесс: коммит `[S2B1] ...`; tsc→vitest→agent-browser; worklog.md.
- Запреты: не трогать прод/секреты; не печатать .env*; старый проект —
  только чтение.

## 3. ЦЕЛЬ БЛОКА
Полный auth-контур: регистрация (19 self-register ролей), вход, выход,
refresh-ротация, сессия-текущий пользователь, 2FA (TOTP), fail-closed
гварды — и НИКАКИХ внешних identity-провайдеров.

## 4. ШАГИ
1. src/lib/auth/session.ts: выпуск пары токенов (jose HS256):
   - access: cd_session, 15 мин, payload {sub, roles[], jti};
   - refresh: cd_refresh, 30 дней, payload {sub, jti}; хэш sha256(refresh)
     хранится в таблице sessions (tokenHash, expiresAt, revokedAt);
   - ротация refresh при каждом refresh (старый jti — revokedAt);
   - выход: revoke текущей пары + очистка кук.
2. Куки: httpOnly, secure (prod), sameSite=lax, path=/; имена cd_session,
   cd_refresh (совпадают со старыми — осознанная преемственность).
3. Route Handlers:
   - POST /api/auth/register: валидация (email lowercase-unique, пароль
     ≥8, имя, телефон опц., role из ALLOWED_SELF_REGISTER_ROLES: CUSTOMER,
     CONFECTIONER, STUDIO, SUPPLIER, WHOLESALER, COURIER, VENUE_OWNER,
     ANIMATOR_AGENCY, RECREATION_CENTER, KIDS_CLUB, FOOD_SERVICE,
     EVENT_ORGANIZER, PICKUP_POINT, BLOGGER, TASTER, NUTRITIONIST,
     COPYWRITER, CORPORATE_CLIENT, FRANCHISEE); роль по умолчанию CUSTOMER;
     запрос ADMIN-ролей → 403 «назначается администратором»;
     bcrypt-хэш; автологин после регистрации (выпуск сессии).
   - POST /api/auth/login: email+password → проверка is_blocked →
     bcrypt → если tfaEnabled → вернуть {tfaRequired:true} и ждать
     POST /api/auth/login/2fa с кодом → иначе выпуск сессии.
     Единая ошибка «Неверный email или пароль» (без перечисления деталей).
   - POST /api/auth/refresh: ротация (шаг 1), защита от reuse (revoked
     refresh → revoke ВСЕЙ цепочки пользователя и 401).
   - POST /api/auth/logout; GET /api/auth/session → {user, roles}
     (без чувствительных полей).
4. src/lib/auth/current.ts: getCurrentUser() — чтение cd_session,
   verify jose, подгрузка roles из БД; ОШИБКА = null (fail-closed) —
   НИКОГДА не возвращать пользователя при любой ошибке верификации
   (анти-паттерн старого auth.ts:293–296 D3).
5. requireRole(roles) / requireAdmin() — возвращают user|null (как в
   старом, но без GoTrue). Gвард-хелперы для Route Handlers с готовым
   401-ответом: guardAdmin(request) и т.п.
6. TOTP 2FA: подключить otplib; POST /api/auth/2fa/setup (admin-гвард)
   → QR-секрет; POST /api/auth/2fa/enable (подтверждение кодом);
   POST /api/auth/login/2fa (проверка в логине); оконное окно ±1.
7. Фронтенд: auth-modal (shadcn Dialog): вкладки Вход/Регистрация,
   выбор роли при регистрации (быстрые: покупатель, кондитер, поставщик,
   курьер, юрлицо + «другая»), состояния ошибок, тосты; после успеха —
   обновление сессии в клиентском сторе (Zustand, отдельный ключ user).
8. Миграция данных старого проекта НЕ входит в блок (решение S9B1).

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- src/app/api/auth/login/route.ts — валидационный контракт и sanitize
  ответа (без passwordHash/tfaSecret/lastLoginIp);
- src/components/layout/auth-modal.tsx — UX-паттерн вкладок и ролей;
- урок D2/D3: НИКАКОГО второго контура и fallback-INSERT.

## 6. ЗАПРЕТЫ
- Не подключать GoTrue/Supabase Auth, OAuth-провайдеров (OAuth-заглушки —
  отдельное решение владельца).
- Не хранить пароли/токены в открытом виде; не логировать секреты.
- Не писать тест-код; верификация — через живые вызовы API.

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] register → login → session → refresh → logout работают (curl-цикл);
- [ ] refresh-ротация: повторное использование старого cd_refresh → 401
      и вся цепочка отозвана;
- [ ] неверный пароль → 401 с единым сообщением; отсутствующий/битый
      cd_session → getCurrentUser() = null (fail-closed);
- [ ] 2FA: enable → вход требует код → вход с кодом ок;
- [ ] ADMIN-роль при self-register → 403;
- [ ] куки httpOnly/sameSite=lax; tsc 0; lint 0; коммит [S2B1]; worklog.

## 8. ВЕРИФИКАЦИЯ (curl + agent-browser)
- curl-цикл: register → cookie jar → session → refresh → logout →
  session (после logout → 401);
- agent-browser: открыть /, модалка входа, вход demo-пользователем
  (создать seed-юзера в этом блоке: admin@demo.ru / Demo123! и
  customer@demo.ru / Demo123!), тосты, выход.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S2B1]; worklog (контракты эндпоинтов, имена кук, TTL).
- Отчёт владельцу: схема сессий, как проверить fail-closed, отличия от
  dual-auth старого проекта.
