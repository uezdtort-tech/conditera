"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { getCsrfToken, setStoredAccessToken } from "@/lib/api-client";
import {
  Cake,
  User,
  Store,
  Truck,
  ShieldCheck,
  Sparkles,
  Building2,
  AlertCircle,
  MapPin,
  Users,
  Calendar,
  Heart,
  FileText,
  Award,
  Check,
  MessageCircle,
} from "lucide-react";
import { LEGAL_TYPES } from "@/lib/mock-data-corporate";
import type { Role, UserLegalInfo } from "@/lib/types";
import type { User as StoreUser } from "@/lib/types";

const DEMO_ACCOUNTS: {
  role: Role;
  label: string;
  email: string;
  password: string;
  icon: typeof Cake;
  description: string;
  color: string;
}[] = [
  {
    role: "CUSTOMER",
    label: "Покупатель (физлицо)",
    email: "customer@demo.ru",
    password: "Demo123!",
    icon: User,
    description: "Анна Соколова — Москва, уровень Gold, 1240 бонусов",
    color: "bg-amber-100 text-amber-800",
  },
  {
    role: "CONFECTIONER",
    label: "Кондитер",
    email: "confectioner@demo.ru",
    password: "Demo123!",
    icon: Cake,
    description: "Мария Уездная — Тула, мастер, тариф Premium",
    color: "bg-rose-100 text-rose-800",
  },
  {
    role: "SUPPLIER",
    label: "Поставщик",
    email: "supplier@demo.ru",
    password: "Demo123!",
    icon: Store,
    description: "Андрей Поляков — Москва, мука и крупы",
    color: "bg-emerald-100 text-emerald-800",
  },
  {
    role: "COURIER",
    label: "Курьер",
    email: "courier@demo.ru",
    password: "Demo123!",
    icon: Truck,
    description: "Иван Курьеров — Москва, 12 доставок сегодня",
    color: "bg-blue-100 text-blue-800",
  },
  {
    role: "ADMIN",
    label: "Администратор",
    email: "admin@demo.ru",
    password: "Demo123!",
    icon: ShieldCheck,
    description: "Полный доступ к управлению платформой",
    color: "bg-purple-100 text-purple-800",
  },
  {
    role: "CORPORATE_CLIENT",
    label: "Корпоративный клиент (юрлицо)",
    email: "events@technopolis.ru",
    password: "demo123",
    icon: Building2,
    description: "ООО «Технополис» — счета, НДС, тендеры",
    color: "bg-indigo-100 text-indigo-800",
  },
];

/**
 * Маппинг API-пользователя (POST /api/auth/login | /api/auth/register)
 * в store-модель User — единый писатель store.setSupabaseUser.
 */
interface ApiUser {
  id: string;
  email: string;
  name: string | null;
  phone?: string | null;
  roles?: string[];
  accountType?: string;
  city?: string | null;
  bonusBalance?: number;
  loyaltyLevel?: string;
}

function mapApiUserToStoreUser(user: ApiUser, fallbackRole?: Role): StoreUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name || user.email.split("@")[0],
    phone: user.phone || undefined,
    roles: (user.roles?.length ? user.roles : [fallbackRole || "CUSTOMER"]) as Role[],
    createdAt: new Date().toISOString(),
    city: user.city || undefined,
    bonusBalance: user.bonusBalance ?? 0,
    loyaltyLevel: (user.loyaltyLevel as StoreUser["loyaltyLevel"]) || "BRONZE",
    accountType: user.accountType === "legal" ? "legal" : "individual",
  };
}

export function AuthModal() {
  const authModalOpen = useAppStore((s) => s.authModalOpen);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);
  const setSupabaseUser = useAppStore((s) => s.setSupabaseUser);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginMethod, setLoginMethod] = useState<"email" | "phone">("email");
  const [phone, setPhone] = useState("");
  // Регистрация
  const oauthLaunchRef = useRef(false);
  const [oauthStarting, setOauthStarting] = useState(false);
  const [oauthConsentPd, setOauthConsentPd] = useState(false);
  const [oauthConsentTerms, setOauthConsentTerms] = useState(false);
  const [consentPd, setConsentPd] = useState(false);
  const [consentTerms, setConsentTerms] = useState(false);
  const [consentOffer, setConsentOffer] = useState(false);
  const [consentNews, setConsentNews] = useState(false);
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerRole, setRegisterRole] = useState<Role>("CUSTOMER");
  const [accountType, setAccountType] = useState<"individual" | "legal">("individual");
  // Ошибка/загрузка реального API регистрации (inline-ошибка из {error})
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  // Юрлицо
  const [legalType, setLegalType] = useState<string>("OOO");
  const [companyName, setCompanyName] = useState("");
  const [inn, setInn] = useState("");
  const [kpp, setKpp] = useState("");
  const [ogrn, setOgrn] = useState("");
  const [legalAddress, setLegalAddress] = useState("");
  const [ceoName, setCeoName] = useState("");

  // Согласия не должны сохраняться между разными открытиями окна авторизации.
  useEffect(() => {
    if (!authModalOpen) {
      setOauthConsentPd(false);
      setOauthConsentTerms(false);
      oauthLaunchRef.current = false;
      setOauthStarting(false);
    }
  }, [authModalOpen]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const loginValue = loginMethod === "email" ? email : phone;
    try {
      // Единый поток входа: POST /api/auth/login — сервер проверяет пароль,
      // выпускает JWT и ставит httpOnly cookie-сессию (cd_session), которую
      // понимают ВСЕ API через getUserFromRequest() (единый auth-контракт).
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginValue, password }),
      });
      const data = (await res.json()) as {
        user?: ApiUser;
        accessToken?: string;
        tfaRequired?: boolean;
        message?: string;
        error?: string;
      };

      if (!res.ok || data.error) {
        toast.error("Ошибка входа", { description: data.error || "Неверный email или пароль" });
        return;
      }

      // 2FA-gate: пароль верный, нужен второй шаг (код из приложения)
      if (data.tfaRequired) {
        toast.info("Требуется 2FA", {
          description: data.message || "Введите код из приложения-аутентификатора.",
        });
        return;
      }

      if (!data.user) {
        toast.error("Ошибка входа", { description: "Сервер не вернул пользователя" });
        return;
      }

      // Токен для socket.io handshake чата и Bearer-канала api-client
      // (cookie остаётся каноничной для API)
      setStoredAccessToken(data.accessToken);

      // Маппим API-ответ в store-модель User и ставим как единого пользователя
      const storeUser = mapApiUserToStoreUser(data.user);
      setSupabaseUser(storeUser);
      // /login redirects only after the modal closes; keep the successful
      // authentication transition atomic so the server-rendered dashboard loads.
      setAuthModalOpen(false);

      toast.success("Добро пожаловать!", {
        description: `Вы вошли как ${storeUser.name}`,
      });
      setEmail("");
      setPhone("");
      setPassword("");
    } catch {
      toast.error("Ошибка входа", {
        description: "Сервер недоступен. Попробуйте ещё раз.",
      });
    }
  };

  // OAuth: серверный flow для Yandex ID, VK ID и Google.
  // Новая регистрация требует отдельного согласия на ПД и принятия условий.
  const handleOAuth = async (provider: "yandex" | "vk" | "google") => {
    // Для существующего OAuth-аккаунта согласия повторно не требуются.
    // Если провайдер впервые создаёт аккаунт, callback потребует оба согласия.

    if (oauthLaunchRef.current) return;
    oauthLaunchRef.current = true;
    setOauthStarting(true);
    try {
      const res = await fetch("/api/auth/oauth/" + provider + "?mode=check");
      const data = (await res.json()) as { configured?: boolean };
      if (!data.configured) {
        const label = provider === "yandex" ? "Яндекс" : provider === "vk" ? "ВКонтакте" : "Google";
        toast.error("Вход через " + label + " пока не настроен", {
          description: "Провайдер OAuth не сконфигурирован в окружении.",
        });
        oauthLaunchRef.current = false;
        setOauthStarting(false);
        return;
      }
      const queryReturnTo = new URLSearchParams(window.location.search).get("returnTo");
      const currentPath = window.location.pathname + window.location.search;
      const fallbackReturnTo = ["/login", "/register", "/auth/login"].includes(window.location.pathname)
        ? "/dashboard"
        : currentPath;
      const returnTo = queryReturnTo || fallbackReturnTo;
      const params = new URLSearchParams({ returnTo });
      if (oauthConsentPd) params.set("consentPd", "1");
      if (oauthConsentTerms) params.set("consentTerms", "1");
      window.location.href = window.location.origin + "/api/auth/oauth/" + provider + "?" + params.toString();
    } catch {
      oauthLaunchRef.current = false;
      setOauthStarting(false);
      toast.error("Не удалось запустить вход через соцсеть");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(null);
    if (!consentPd || !consentTerms || !consentOffer) {
      setRegisterError("Дайте согласие на обработку персональных данных, примите пользовательское соглашение и публичную оферту");
      return;
    }
    if (!registerName || !registerEmail || !registerPassword || !registerPhone) {
      setRegisterError("Заполните все обязательные поля: имя, телефон, email, пароль");
      return;
    }
    if (registerPassword.length < 8) {
      setRegisterError("Пароль должен быть не менее 8 символов");
      return;
    }
    if (accountType === "legal") {
      if (!companyName || !inn || !legalAddress) {
        setRegisterError("Заполните реквизиты организации");
        return;
      }
    }

    const legalInfo: UserLegalInfo | undefined =
      accountType === "legal"
        ? {
            type: legalType as UserLegalInfo["type"],
            companyName,
            inn,
            kpp: kpp || undefined,
            ogrn: ogrn || undefined,
            legalAddress,
            ceoName: ceoName || undefined,
          }
        : undefined;

    setRegistering(true);
    try {
      // Единый поток регистрации: POST /api/auth/register (реальный API —
      // уникальность email/телефона, чёрный список и роли проверяет сервер).
      // CSRF — double-submit cookie (см. getCsrfToken в api-client).
      const csrf = await getCsrfToken();
      const res = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
        body: JSON.stringify({
          name: registerName.trim(),
          phone: registerPhone.trim(),
          email: registerEmail.trim(),
          password: registerPassword,
          role: registerRole, // роль из UI уже совпадает с enum user_role (CUSTOMER, CONFECTIONER, SUPPLIER, ANIMATOR_AGENCY…)
          accountType,
          legalInfo,
          consentPd,
          consentTerms,
          consentOffer,
          consentMarketing: consentNews,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        user?: ApiUser;
        accessToken?: string;
        refreshToken?: string;
        error?: string;
      };

      if (!res.ok || data.error) {
        // Inline-ошибка от {error} ответа сервера (409 email/телефон занят, 403 блэклист, 400 валидация…)
        setRegisterError(data.error || `Не удалось зарегистрироваться (HTTP ${res.status})`);
        return;
      }

      // Автовход: register не ставит cookie-сессию — логинимся теми же
      // креденшелами через POST /api/auth/login (он выпускает cd_session/cd_refresh).
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: registerEmail.trim(), password: registerPassword }),
      });
      const loginData = (await loginRes.json().catch(() => ({}))) as {
        user?: ApiUser;
        accessToken?: string;
        error?: string;
      };

      if (loginRes.ok && loginData.user && !loginData.error) {
        setStoredAccessToken(loginData.accessToken);
        const storeUser = mapApiUserToStoreUser(loginData.user, registerRole);
        setSupabaseUser(storeUser); // также закрывает модалку (authModalOpen → false)
        toast.success("Регистрация успешна!", {
          description:
            accountType === "legal"
              ? `Организация ${companyName} зарегистрирована. Добро пожаловать, ${storeUser.name}!`
              : `Добро пожаловать, ${storeUser.name}!`,
        });
      } else {
        // Регистрация прошла, автовход не удался — не теряем успех,
        // закрываем модалку и просим войти вручную.
        setAuthModalOpen(false);
        toast.success("Регистрация успешна!", {
          description: "Войдите под своим email и паролем.",
        });
      }

      // Сброс формы
      setRegisterName("");
      setRegisterEmail("");
      setRegisterPhone("");
      setRegisterPassword("");
      setCompanyName("");
      setInn("");
      setKpp("");
      setOgrn("");
      setLegalAddress("");
      setCeoName("");
    } catch {
      setRegisterError("Сервер недоступен. Попробуйте ещё раз.");
    } finally {
      setRegistering(false);
    }
  };

  const quickLogin = async (account: (typeof DEMO_ACCOUNTS)[number]) => {
    // Единый поток: demo-кнопка => реальный POST /api/auth/login
    // (dev-fallback на сервере выпускает настоящую JWT-сессию)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, password: account.password }),
      });
      const data = (await res.json()) as {
        user?: ApiUser;
        accessToken?: string;
        tfaRequired?: boolean;
        error?: string;
      };
      if (!res.ok || data.error || !data.user) {
        toast.error("Ошибка входа", { description: data.error || "Сервер не вернул пользователя" });
        return;
      }
      if (data.tfaRequired) {
        toast.info("Требуется 2FA", { description: "Введите код из приложения-аутентификатора." });
        return;
      }
      setStoredAccessToken(data.accessToken);
      const storeUser = mapApiUserToStoreUser(data.user, account.role);
      setSupabaseUser(storeUser);
      setAuthModalOpen(false);
      toast.success(`Вход выполнен как ${account.label}`, {
        description: account.description,
      });
    } catch {
      toast.error("Ошибка входа", { description: "Сервер недоступен" });
    }
  };

  const legalTypeNeedsKpp = LEGAL_TYPES[legalType]?.needsKpp;

  return (
    <Dialog open={authModalOpen} onOpenChange={setAuthModalOpen}>
      <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <img src="/logo.png" alt="" className="h-10 w-10 rounded-full object-cover" />
            Уездный кондитер
          </DialogTitle>
          <DialogDescription>
            Войдите в личный кабинет или зарегистрируйтесь. Доступна регистрация
            как физлица, так и юридического лица.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Вход</TabsTrigger>
            <TabsTrigger value="register">Регистрация</TabsTrigger>
          </TabsList>

          {/* Login */}
          <TabsContent value="login" className="space-y-4">
            {/* Переключатель Email / Телефон */}
            <div className="flex gap-1 p-1 bg-muted rounded-lg">
              <button
                type="button"
                onClick={() => setLoginMethod("email")}
                className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${
                  loginMethod === "email"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                По email
              </button>
              <button
                type="button"
                onClick={() => setLoginMethod("phone")}
                className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${
                  loginMethod === "phone"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                По телефону
              </button>
            </div>

            <form onSubmit={handleLogin} className="space-y-3">
              {loginMethod === "email" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="your@email.ru"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="login-phone">Телефон</Label>
                  <Input
                    id="login-phone"
                    type="tel"
                    placeholder="+7 (900) 123-45-67"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="login-password">Пароль</Label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full">
                Войти
              </Button>
            </form>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  или войдите через
                </span>
              </div>
            </div>

            {/* OAuth согласия — отдельны от необязательной рекламной рассылки */}
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={oauthConsentPd}
                  onChange={(event) => setOauthConsentPd(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Даю отдельное <a href="/about?legal=consent" target="_blank" rel="noreferrer" className="font-medium text-primary underline">согласие на обработку персональных данных</a> для работы Conditera.
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={oauthConsentTerms}
                  onChange={(event) => setOauthConsentTerms(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Принимаю <a href="/about?legal=terms" target="_blank" rel="noreferrer" className="font-medium text-primary underline">пользовательское соглашение</a>.
                </span>
              </label>
            </div>

            {/* OAuth кнопки с официальными цветами брендов */}
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant="outline" onClick={() => handleOAuth("yandex")} disabled={oauthStarting} className="gap-1.5 px-2">
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#FC3F1D" d="M14.2 2.5h-2.1c-4.1 0-6.6 2.1-6.6 5.7 0 2.7 1.3 4.4 3.8 5.9L5 21.5h3.4l4.8-7.7-1.4-.9c-1.8-1.1-2.6-2.3-2.6-4.5 0-2.3 1.5-3.7 4-3.7h1v16.8h3.1V2.5h-3.1z"/>
                </svg>
                <span className="text-xs">Яндекс</span>
              </Button>
              <Button type="button" variant="outline" onClick={() => handleOAuth("vk")} disabled={oauthStarting} className="gap-1.5 px-2">
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#0077FF" d="M12.785 16.241s.288-.032.435-.193c.135-.148.131-.426.131-.426s-.019-1.302.582-1.495c.593-.19 1.354 1.27 2.16 1.83.61.42 1.075.328 1.075.328l2.154-.03s1.126-.07.592-.957c-.044-.072-.311-.654-1.6-1.844-1.35-1.255-1.169-1.052.458-3.22.99-1.319 1.387-2.124 1.262-2.466-.117-.327-.84-.24-.84-.24l-2.4.015s-.178-.024-.31.054c-.13.077-.213.256-.213.256s-.382 1.024-.892 1.895c-1.075 1.84-1.504 1.937-1.681 1.823-.413-.27-.31-1.067-.31-1.635 0-1.775.267-2.515-.519-2.706-.262-.064-.454-.106-1.123-.113-.858-.009-1.585.003-1.996.207-.274.135-.485.437-.356.454.159.021.519.099.71.36.246.337.237 1.094.237 1.094s.142 2.108-.33 2.37c-.325.18-.77-.187-1.731-1.838-.489-.842-.857-1.772-.857-1.772s-.07-.176-.198-.27c-.155-.114-.371-.15-.371-.15l-2.282.015s-.342.01-.467.158c-.112.132-.009.405-.009.405s1.786 4.179 3.807 6.286c1.854 1.932 3.962 1.805 3.962 1.805h.956z"/>
                </svg>
                <span className="text-xs">ВКонтакте</span>
              </Button>
              <Button type="button" variant="outline" onClick={() => handleOAuth("google")} disabled={oauthStarting} className="gap-1.5 px-2">
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11c-.5 2.5-2 4.6-4.3 6v5h7c4.1-3.8 6.4-9.3 6.4-14.7z"/>
                  <path fill="#34A853" d="M24 44c5.8 0 10.7-1.9 14.3-5.1l-7-5c-1.9 1.3-4.3 2.1-7.3 2.1-5.6 0-10.3-3.8-12-8.9H4.8v5.2C8.4 39.2 15.6 44 24 44z"/>
                  <path fill="#FBBC05" d="M12 27.1c-.4-1.3-.7-2.6-.7-4.1s.2-2.8.7-4.1v-5.2H4.8C3.3 16.7 2.5 19.8 2.5 23s.8 6.3 2.3 9.3l7.2-5.2z"/>
                  <path fill="#EA4335" d="M24 10c3.1 0 5.9 1.1 8.1 3.2l6.1-6.1C34.7 3.6 29.8 2 24 2 15.6 2 8.4 6.8 4.8 13.7l7.2 5.2c1.7-5.1 6.4-8.9 12-8.9z"/>
                </svg>
                <span className="text-xs">Google</span>
              </Button>
            </div>
          </TabsContent>

          {/* Register */}
          <TabsContent value="register" className="space-y-4">
            <form onSubmit={handleRegister} className="space-y-3">
              {/* Account type */}
              <div>
                <Label>Тип аккаунта</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setAccountType("individual")}
                    className={`flex items-center gap-2 p-3 border rounded-lg text-sm transition-colors ${
                      accountType === "individual"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:bg-accent/40"
                    }`}
                  >
                    <User className="h-4 w-4 shrink-0" />
                    <div className="text-left">
                      <div className="font-medium">Физлицо</div>
                      <div className="text-[10px] text-muted-foreground">Покупатель, кондитер, курьер</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType("legal")}
                    className={`flex items-center gap-2 p-3 border rounded-lg text-sm transition-colors ${
                      accountType === "legal"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:bg-accent/40"
                    }`}
                  >
                    <Building2 className="h-4 w-4 shrink-0" />
                    <div className="text-left">
                      <div className="font-medium">Юрлицо</div>
                      <div className="text-[10px] text-muted-foreground">ООО, ИП, ПАО — B2B</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Basic fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="reg-name">Имя / ФИО *</Label>
                  <Input
                    id="reg-name"
                    placeholder={accountType === "legal" ? "Имя контактного лица" : "Как к вам обращаться"}
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="reg-phone">Телефон *</Label>
                  <Input
                    id="reg-phone"
                    type="tel"
                    placeholder="+7 (___) ___-__-__"
                    value={registerPhone}
                    onChange={(e) => setRegisterPhone(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="reg-email">Email *</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    placeholder="your@email.ru"
                    value={registerEmail}
                    onChange={(e) => setRegisterEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="reg-password">Пароль *</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    placeholder="Минимум 8 символов"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Role */}
              <div>
                <Label>Я хочу:</Label>
                <div className="mt-2 max-h-72 overflow-y-auto space-y-3 border rounded-lg p-3">
                  {/* Базовые роли */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Основные</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { role: "CUSTOMER" as Role, label: "Покупать торты", icon: User },
                        { role: "CONFECTIONER" as Role, label: "Продавать торты", icon: Cake },
                        { role: "COURIER" as Role, label: "Доставлять заказы", icon: Truck },
                        { role: "SUPPLIER" as Role, label: "Поставлять сырьё", icon: Store },
                      ].map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.role}
                            type="button"
                            onClick={() => setRegisterRole(opt.role)}
                            className={`flex items-center gap-2 p-2.5 border rounded-lg text-sm transition-colors ${
                              registerRole === opt.role
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border hover:bg-accent/40"
                            }`}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="text-xs">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Услуги и площадки */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Услуги и площадки</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { role: "STUDIO" as Role, label: "Кондитерская студия", icon: Cake },
                        { role: "VENUE_OWNER" as Role, label: "Сдавать площадку", icon: Building2 },
                        { role: "ANIMATOR_AGENCY" as Role, label: "Аниматоры", icon: Sparkles },
                        { role: "RECREATION_CENTER" as Role, label: "База отдыха", icon: MapPin },
                        { role: "KIDS_CLUB" as Role, label: "Детский клуб", icon: Users },
                        { role: "FOOD_SERVICE" as Role, label: "Кейтеринг", icon: Truck },
                        { role: "EVENT_ORGANIZER" as Role, label: "Организатор событий", icon: Calendar },
                        { role: "PICKUP_POINT" as Role, label: "Пункт выдачи (франшиза)", icon: MapPin },
                      ].map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.role}
                            type="button"
                            onClick={() => setRegisterRole(opt.role)}
                            className={`flex items-center gap-2 p-2.5 border rounded-lg text-sm transition-colors ${
                              registerRole === opt.role
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border hover:bg-accent/40"
                            }`}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="text-xs">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* B2B / Корпоративные */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">B2B / Корпоративные</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { role: "CORPORATE_CLIENT" as Role, label: "Корпоративный заказчик", icon: Building2 },
                        { role: "WHOLESALER" as Role, label: "Оптовые поставки", icon: Store },
                        { role: "FRANCHISEE" as Role, label: "Франчайзи", icon: Building2 },
                      ].map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.role}
                            type="button"
                            onClick={() => setRegisterRole(opt.role)}
                            className={`flex items-center gap-2 p-2.5 border rounded-lg text-sm transition-colors ${
                              registerRole === opt.role
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border hover:bg-accent/40"
                            }`}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="text-xs">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Контент и эксперты */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Контент и эксперты</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { role: "BLOGGER" as Role, label: "Блогер", icon: MessageCircle },
                        { role: "TASTER" as Role, label: "Дегустатор", icon: Cake },
                        { role: "NUTRITIONIST" as Role, label: "Нутрициолог", icon: Heart },
                        { role: "COPYWRITER" as Role, label: "Копирайтер", icon: FileText },
                      ].map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.role}
                            type="button"
                            onClick={() => setRegisterRole(opt.role)}
                            className={`flex items-center gap-2 p-2.5 border rounded-lg text-sm transition-colors ${
                              registerRole === opt.role
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border hover:bg-accent/40"
                            }`}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="text-xs">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Администрация — скрыто для обычной регистрации */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Администрация (по приглашению)</div>
                    <div className="grid grid-cols-2 gap-2 opacity-50">
                      {[
                        { role: "MODERATOR" as Role, label: "Модератор", icon: ShieldCheck },
                        { role: "SUPPORT" as Role, label: "Поддержка", icon: MessageCircle },
                        { role: "QUALITY_INSPECTOR" as Role, label: "Инспектор качества", icon: Check },
                        { role: "CERTIFICATION_AGENT" as Role, label: "Сертификатор", icon: Award },
                      ].map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.role}
                            type="button"
                            disabled
                            title="Эта роль назначается администратором"
                            className="flex items-center gap-2 p-2.5 border rounded-lg text-sm cursor-not-allowed opacity-60"
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="text-xs">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Роли ADMIN, SUPER_ADMIN, MODERATOR, SUPPORT назначаются администратором после регистрации
                    </p>
                  </div>
                </div>
              </div>

              {/* Legal fields (если юрлицо) */}
              {accountType === "legal" && (
                <div className="p-3 border border-primary/30 rounded-lg bg-primary/5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold">Реквизиты организации</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">
                      Для счетов и чеков
                    </Badge>
                  </div>

                  <div>
                    <Label>Тип организации</Label>
                    <Select value={legalType} onValueChange={setLegalType}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(LEGAL_TYPES).map(([key, info]) => (
                          <SelectItem key={key} value={key}>
                            {info.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Название организации *</Label>
                    <Input
                      placeholder="ООО «Ромашка»"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>ИНН *</Label>
                      <Input
                        placeholder={legalTypeNeedsKpp ? "10 цифр" : "12 цифр"}
                        value={inn}
                        onChange={(e) => setInn(e.target.value.replace(/\D/g, ""))}
                        maxLength={legalTypeNeedsKpp ? 10 : 12}
                        required
                      />
                    </div>
                    {legalTypeNeedsKpp && (
                      <div>
                        <Label>КПП</Label>
                        <Input
                          placeholder="9 цифр"
                          value={kpp}
                          onChange={(e) => setKpp(e.target.value.replace(/\D/g, ""))}
                          maxLength={9}
                        />
                      </div>
                    )}
                    <div>
                      <Label>ОГРН / ОГРНИП</Label>
                      <Input
                        placeholder={legalTypeNeedsKpp ? "13 цифр" : "15 цифр"}
                        value={ogrn}
                        onChange={(e) => setOgrn(e.target.value.replace(/\D/g, ""))}
                        maxLength={legalTypeNeedsKpp ? 13 : 15}
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Юридический адрес *</Label>
                    <Input
                      placeholder="125009, г. Москва, ул. Тверская, д. 16"
                      value={legalAddress}
                      onChange={(e) => setLegalAddress(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <Label>ФИО руководителя</Label>
                    <Input
                      placeholder="Иванов Иван Иванович"
                      value={ceoName}
                      onChange={(e) => setCeoName(e.target.value)}
                    />
                  </div>

                  <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                    Реквизиты будут использоваться при формировании счетов на оплату,
                    актов и счетов-фактур для B2B-заказов
                  </p>
                </div>
              )}

              {/* ===== СОГЛАСИЕ НА ОБРАБОТКУ ПД ===== */}
              <div className="space-y-3 p-3 border border-border rounded-lg bg-muted/30">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    id="consent-pd"
                    required
                    checked={consentPd}
                    onChange={(event) => setConsentPd(event.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-primary shrink-0"
                  />
                  <span className="text-xs text-muted-foreground leading-relaxed">
                    Я даю <a href="/about?legal=consent" target="_blank" className="text-primary underline font-medium">согласие на обработку персональных данных</a> в соответствии с ФЗ-152 «О персональных данных», включая сбор, запись, систематизацию, хранение, использование и передачу третьим лицам (кондитерам, курьерам, YooKassa) в целях оказания услуг платформы.
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    id="consent-terms"
                    required
                    checked={consentTerms}
                    onChange={(event) => setConsentTerms(event.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-primary shrink-0"
                  />
                  <span className="text-xs text-muted-foreground leading-relaxed">
                    Я ознакомился и принимаю условия <a href="/about?legal=terms" target="_blank" className="text-primary underline font-medium">пользовательского соглашения</a>.
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" id="consent-offer" required checked={consentOffer} onChange={(event) => setConsentOffer(event.target.checked)} className="w-4 h-4 mt-0.5 accent-primary shrink-0" />
                  <span className="text-xs text-muted-foreground leading-relaxed">Принимаю условия <a href="/about?legal=offer" target="_blank" className="text-primary underline font-medium">публичной оферты</a>.</span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    id="consent-news"
                    checked={consentNews}
                    onChange={(event) => setConsentNews(event.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-primary shrink-0"
                  />
                  <span className="text-xs text-muted-foreground leading-relaxed">
                    Я согласен получать уведомления о заказах, акциях и новостях платформы (можно отключить в настройках).
                  </span>
                </label>
              </div>

              {/* Inline-ошибка от API регистрации (сервер — источник истины) */}
              {registerError && (
                <p
                  className="text-xs text-red-600 flex items-start gap-1.5 border border-red-200 bg-red-50 rounded-md p-2"
                  role="alert"
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{registerError}</span>
                </p>
              )}

              <Button type="submit" className="w-full" disabled={registering}>
                {registering
                  ? "Регистрация..."
                  : `Зарегистрироваться${accountType === "legal" ? " как юрлицо" : ""}`}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                Регистрируясь, вы подтверждаете, что предоставляете достоверную информацию.
                Один email и один телефон могут быть зарегистрированы только один раз.
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
