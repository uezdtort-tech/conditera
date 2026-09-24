"use client";

import { useState, useMemo } from "react";
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
import {
  Cake,
  User,
  Store,
  Truck,
  ShieldCheck,
  Sparkles,
  Building2,
  CheckCircle2,
  AlertCircle,
  XCircle,
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
    password: "demo123",
    icon: User,
    description: "Анна Соколова — Москва, уровень Gold, 1240 бонусов",
    color: "bg-amber-100 text-amber-800",
  },
  {
    role: "CONFECTIONER",
    label: "Кондитер",
    email: "confectioner@demo.ru",
    password: "demo123",
    icon: Cake,
    description: "Мария Уездная — Тула, мастер, тариф Premium",
    color: "bg-rose-100 text-rose-800",
  },
  {
    role: "SUPPLIER",
    label: "Поставщик",
    email: "supplier@demo.ru",
    password: "demo123",
    icon: Store,
    description: "Андрей Поляков — Москва, мука и крупы",
    color: "bg-emerald-100 text-emerald-800",
  },
  {
    role: "COURIER",
    label: "Курьер",
    email: "courier@demo.ru",
    password: "demo123",
    icon: Truck,
    description: "Иван Курьеров — Москва, 12 доставок сегодня",
    color: "bg-blue-100 text-blue-800",
  },
  {
    role: "ADMIN",
    label: "Администратор",
    email: "admin@demo.ru",
    password: "admin123",
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

export function AuthModal() {
  const authModalOpen = useAppStore((s) => s.authModalOpen);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);
  const login = useAppStore((s) => s.login);
  const loginAs = useAppStore((s) => s.loginAs);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginMethod, setLoginMethod] = useState<"email" | "phone">("email");
  const [phone, setPhone] = useState("");
  // Регистрация
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerRole, setRegisterRole] = useState<Role>("CUSTOMER");
  const [accountType, setAccountType] = useState<"individual" | "legal">("individual");
  // Юрлицо
  const [legalType, setLegalType] = useState<string>("OOO");
  const [companyName, setCompanyName] = useState("");
  const [inn, setInn] = useState("");
  const [kpp, setKpp] = useState("");
  const [ogrn, setOgrn] = useState("");
  const [legalAddress, setLegalAddress] = useState("");
  const [ceoName, setCeoName] = useState("");

  // Семафор — проверка уникальности через useMemo (без effect)
  const checkSemaphore = useAppStore((s) => s.checkSemaphore);
  const checkBlacklist = useAppStore((s) => s.checkBlacklist);
  const registerUser = useAppStore((s) => s.registerUser);

  const emailCheck = useMemo<{ available: boolean; reason?: string } | null>(() => {
    if (!registerEmail || !registerEmail.includes("@")) return null;
    const semaphore = checkSemaphore("email", registerEmail);
    if (!semaphore.available) {
      return { available: false, reason: "Email уже зарегистрирован" };
    }
    const blacklist = checkBlacklist(registerEmail, "email");
    if (blacklist) {
      return { available: false, reason: `Email в чёрном списке: ${blacklist.reason}` };
    }
    return { available: true };
  }, [registerEmail, checkSemaphore, checkBlacklist]);

  const phoneCheck = useMemo<{ available: boolean; reason?: string } | null>(() => {
    if (!registerPhone || registerPhone.length < 10) return null;
    const semaphore = checkSemaphore("phone", registerPhone);
    if (!semaphore.available) {
      return { available: false, reason: "Телефон уже зарегистрирован" };
    }
    const blacklist = checkBlacklist(registerPhone, "phone");
    if (blacklist) {
      return { available: false, reason: `Телефон в чёрном списке: ${blacklist.reason}` };
    }
    return { available: true };
  }, [registerPhone, checkSemaphore, checkBlacklist]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const loginValue = loginMethod === "email" ? email : phone;
    const result = login(loginValue, password);
    if (result.success) {
      toast.success("Добро пожаловать!", {
        description: "Вы успешно вошли в систему.",
      });
      setEmail("");
      setPhone("");
      setPassword("");
    } else {
      toast.error("Ошибка входа", {
        description: result.error,
      });
    }
  };

  // OAuth через Яндекс и ВК: сначала проверяем, настроен ли провайдер
  // (иначе навигация показала бы JSON-заглушку), потом редирект на initiation,
  // который 302-ит на страницу провайдера.
  const handleOAuth = async (provider: "yandex" | "vk") => {
    try {
      const res = await fetch(`/api/auth/oauth/${provider}?mode=check`);
      const data = (await res.json()) as { configured?: boolean };
      if (!data.configured) {
        toast.error(`Вход через ${provider === "yandex" ? "Яндекс" : "ВКонтакте"} пока не настроен`, {
          description: "Провайдер OAuth не сконфигурирован в окружении.",
        });
        return;
      }
      window.location.href = `${window.location.origin}/api/auth/oauth/${provider}`;
    } catch {
      toast.error("Не удалось запустить вход через соцсеть");
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerName || !registerEmail || !registerPassword || !registerPhone) {
      toast.error("Заполните все обязательные поля");
      return;
    }
    if (emailCheck && !emailCheck.available) {
      toast.error("Email недоступен", { description: emailCheck.reason });
      return;
    }
    if (phoneCheck && !phoneCheck.available) {
      toast.error("Телефон недоступен", { description: phoneCheck.reason });
      return;
    }
    if (accountType === "legal") {
      if (!companyName || !inn || !legalAddress) {
        toast.error("Заполните реквизиты организации");
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

    const result = registerUser({
      email: registerEmail,
      password: registerPassword,
      name: registerName,
      phone: registerPhone,
      role: registerRole,
      accountType,
      legalInfo,
    });

    if (result.success) {
      toast.success("Регистрация успешна!", {
        description:
          accountType === "legal"
            ? `Организация ${companyName} зарегистрирована`
            : `Добро пожаловать, ${registerName}!`,
      });
      // Сброс
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
    } else {
      toast.error("Ошибка регистрации", { description: result.error });
    }
  };

  const quickLogin = (account: (typeof DEMO_ACCOUNTS)[number]) => {
    login(account.email, account.password);
    toast.success(`Вход выполнен как ${account.label}`, {
      description: account.description,
    });
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

            {/* OAuth кнопки */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOAuth("yandex")}
                className="gap-2"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                  <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="bold" fill="currentColor">Я</text>
                </svg>
                Яндекс
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOAuth("vk")}
                className="gap-2"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.785 16.241s.288-.032.435-.193c.135-.148.131-.426.131-.426s-.019-1.302.582-1.495c.593-.19 1.354 1.27 2.16 1.83.61.42 1.075.328 1.075.328l2.154-.03s1.126-.07.592-.957c-.044-.072-.311-.654-1.6-1.844-1.35-1.255-1.169-1.052.458-3.22.99-1.319 1.387-2.124 1.262-2.466-.117-.327-.84-.24-.84-.24l-2.4.015s-.178-.024-.31.054c-.13.077-.213.256-.213.256s-.382 1.024-.892 1.895c-1.075 1.84-1.504 1.937-1.681 1.823-.413-.27-.31-1.067-.31-1.635 0-1.775.267-2.515-.519-2.706-.262-.064-.454-.106-1.123-.113-.858-.009-1.585.003-1.996.207-.274.135-.485.437-.356.454.159.021.519.099.71.36.246.337.237 1.094.237 1.094s.142 2.108-.33 2.37c-.325.18-.77-.187-1.731-1.838-.489-.842-.857-1.772-.857-1.772s-.07-.176-.198-.27c-.155-.114-.371-.15-.371-.15l-2.282.015s-.342.01-.467.158c-.112.132-.009.405-.009.405s1.786 4.179 3.807 6.286c1.854 1.932 3.962 1.805 3.962 1.805h.956z"/>
                </svg>
                ВКонтакте
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
                  <div className="relative">
                    <Input
                      id="reg-phone"
                      type="tel"
                      placeholder="+7 (___) ___-__-__"
                      value={registerPhone}
                      onChange={(e) => setRegisterPhone(e.target.value)}
                      required
                      className={phoneCheck?.available === false ? "border-red-500" : phoneCheck?.available === true ? "border-emerald-500" : ""}
                    />
                    {phoneCheck && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        {phoneCheck.available ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                    )}
                  </div>
                  {phoneCheck && !phoneCheck.available && (
                    <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {phoneCheck.reason}
                    </p>
                  )}
                  {phoneCheck?.available && (
                    <p className="text-xs text-emerald-600 mt-1">Телефон свободен</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="reg-email">Email *</Label>
                  <div className="relative">
                    <Input
                      id="reg-email"
                      type="email"
                      placeholder="your@email.ru"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      required
                      className={emailCheck?.available === false ? "border-red-500" : emailCheck?.available === true ? "border-emerald-500" : ""}
                    />
                    {emailCheck && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        {emailCheck.available ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                    )}
                  </div>
                  {emailCheck && !emailCheck.available && (
                    <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {emailCheck.reason}
                    </p>
                  )}
                  {emailCheck?.available && (
                    <p className="text-xs text-emerald-600 mt-1">Email свободен</p>
                  )}
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
                    className="w-4 h-4 mt-0.5 accent-primary shrink-0"
                  />
                  <span className="text-xs text-muted-foreground leading-relaxed">
                    Я ознакомился и принимаю условия <a href="/about?legal=terms" target="_blank" className="text-primary underline font-medium">пользовательского соглашения</a> и <a href="/about?legal=offer" target="_blank" className="text-primary underline font-medium">договора-оферты</a>.
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    id="consent-news"
                    className="w-4 h-4 mt-0.5 accent-primary shrink-0"
                  />
                  <span className="text-xs text-muted-foreground leading-relaxed">
                    Я согласен получать уведомления о заказах, акциях и новостях платформы (можно отключить в настройках).
                  </span>
                </label>
              </div>

              <Button type="submit" className="w-full">
                Зарегистрироваться{accountType === "legal" ? " как юрлицо" : ""}
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
