/**
 * dev-auth.ts — серверный dev-fallback аутентификации.
 *
 * ЗАЧЕМ: при отсутствии Supabase (isAdminConfigured() === false — например,
 * локальная dev-среда/preview без запущенного стека) login-роут не может
 * прочитать profiles. Чтобы «реальная auth-сессия» была возможна и без
 * Supabase, /api/auth/login падает назад на этот список demo-пользователей
 * и выпускает НАСТОЯЩИЙ JWT (тот же механизм, тот же секрет, те же роли).
 *
 * ГВАРДЫ (все обязательны):
 *   • только когда isAdminConfigured() === false (Supabase не задан);
 *   • только при NODE_ENV !== "production";
 *   • каждый факт использования пишется в лог.
 * В production с настроенным Supabase этот код недостижим.
 *
 * Пароль всех demo-аккаунтов: demo123 (согласован с клиентскими
 * DEMO_ACCOUNTS в auth-modal.tsx и MOCK_USERS).
 */
import { timingSafeEqualStr } from "@/lib/secure-compare";

export const DEV_FALLBACK_PASSWORD = "demo123";

export interface DevFallbackUser {
  id: string;
  email: string;
  name: string;
  phone: string;
  roles: string[];
  accountType: string;
  city: string;
  bonusBalance: number;
  loyaltyLevel: string;
  isVerified: boolean;
}

export const DEV_FALLBACK_USERS: DevFallbackUser[] = [
  {
    id: "dev-u1-customer",
    email: "customer@demo.ru",
    name: "Анна Соколова",
    phone: "+7 (900) 000-00-01",
    roles: ["CUSTOMER"],
    accountType: "individual",
    city: "Москва",
    bonusBalance: 1240,
    loyaltyLevel: "GOLD",
    isVerified: true,
  },
  {
    id: "dev-u2-confectioner",
    email: "confectioner@demo.ru",
    name: "Мария Уездная",
    phone: "+7 (900) 000-00-02",
    roles: ["CONFECTIONER"],
    accountType: "individual",
    city: "Суздаль",
    bonusBalance: 300,
    loyaltyLevel: "SILVER",
    isVerified: true,
  },
  {
    id: "dev-u3-supplier",
    email: "supplier@demo.ru",
    name: "Пётр Поставщиков",
    phone: "+7 (900) 000-00-03",
    roles: ["SUPPLIER"],
    accountType: "legal",
    city: "Владимир",
    bonusBalance: 0,
    loyaltyLevel: "BRONZE",
    isVerified: true,
  },
  {
    id: "dev-u4-courier",
    email: "courier@demo.ru",
    name: "Иван Курьеров",
    phone: "+7 (900) 000-00-04",
    roles: ["COURIER"],
    accountType: "individual",
    city: "Москва",
    bonusBalance: 50,
    loyaltyLevel: "BRONZE",
    isVerified: true,
  },
  {
    id: "dev-u5-admin",
    email: "admin@demo.ru",
    name: "Ольга Админова",
    phone: "+7 (900) 000-00-05",
    roles: ["ADMIN", "SUPER_ADMIN"],
    accountType: "individual",
    city: "Москва",
    bonusBalance: 0,
    loyaltyLevel: "PLATINUM",
    isVerified: true,
  },
];

/**
 * Найти dev-пользователя по email+паролю (timing-safe по паролю).
 * Возвращает null, если fallback недоступен или данные не совпали.
 */
export function findDevFallbackUser(
  email: string,
  password: string
): DevFallbackUser | null {
  if (!isDevFallbackEnabled()) return null;
  const user = DEV_FALLBACK_USERS.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
  if (!user) return null;
  if (!timingSafeEqualStr(password, DEV_FALLBACK_PASSWORD)) return null;
  return user;
}

/** Виден ли dev-fallback (для логов и guard'ов). */
export function isDevFallbackEnabled(): boolean {
  return !process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NODE_ENV !== "production";
}
