"use client";

/**
 * AuthModal — модальное окно входа/регистрации (v2.0 на Supabase GoTrue).
 *
 * Возможности:
 *   - Email + password (вход и регистрация)
 *   - OAuth: Google, Яндекс, ВК (через supabase.auth.signInWithOAuth)
 *   - Magic Link (вход по ссылке на почту)
 *   - Forgot password (reset password email)
 *   - Loading + error states через TanStack Query mutations
 *
 * ВАЖНО: этот компонент не зависит от useAppStore — использует только Supabase.
 * В v2.0 после окончания миграции useAppStore будет убран полностью.
 *
 * Для обратной совместимости: если useAppStore имеет authModalOpen/setAuthModalOpen,
 * то модалка слушает их (через render в layout). Иначе можно использовать state из useAuth.
 */

import * as React from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Cake,
  Mail,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  Loader2,
  Sparkles,
  ShieldCheck,
  MailOpen,
  Zap,
} from "lucide-react";
import {
  useSignIn,
  useSignUp,
  useOAuth,
  useResetPassword,
  useMagicLink,
} from "@/lib/supabase/use-auth";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultMode?: "login" | "register";
}

export function SupabaseAuthModal({
  open,
  onOpenChange,
  defaultMode = "login",
}: AuthModalProps): React.JSX.Element {
  const [mode, setMode] = React.useState<"login" | "register" | "forgot" | "magic">(defaultMode);
  const [showPassword, setShowPassword] = React.useState(false);
  const [agreeToTerms, setAgreeToTerms] = React.useState(false);
  const [magicEmailSent, setMagicEmailSent] = React.useState(false);

  // Form state
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");

  // Mutations
  const signIn = useSignIn();
  const signUp = useSignUp();
  const oauth = useOAuth();
  const resetPassword = useResetPassword();
  const magicLink = useMagicLink();

  // Reset form on close
  React.useEffect(() => {
    if (!open) {
      setEmail("");
      setPassword("");
      setName("");
      setPhone("");
      setAgreeToTerms(false);
      setShowPassword(false);
      setMagicEmailSent(false);
      setMode(defaultMode);
    }
  }, [open, defaultMode]);

  const handleMagicLink = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!email) {
      toast.error("Введите email");
      return;
    }
    magicLink.mutate(email, {
      onSuccess: () => {
        setMagicEmailSent(true);
      },
    });
  };

  const handleSignIn = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Заполните все поля");
      return;
    }
    signIn.mutate({ email, password }, {
      onSuccess: () => {
        onOpenChange(false);
      },
    });
  };

  const handleSignUp = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!email || !password || !name) {
      toast.error("Заполните все обязательные поля");
      return;
    }
    if (password.length < 8) {
      toast.error("Пароль должен быть не менее 8 символов");
      return;
    }
    if (!agreeToTerms) {
      toast.error("Подтвердите согласие с условиями");
      return;
    }
    signUp.mutate(
      { email, password, name, phone: phone || undefined },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  const handleOAuth = (provider: "google" | "yandex" | "vk"): void => {
    oauth.mutate(provider);
  };

  const handleResetPassword = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!email) {
      toast.error("Введите email");
      return;
    }
    resetPassword.mutate(email, {
      onSuccess: () => {
        setMode("login");
      },
    });
  };

  const isProcessing =
    signIn.isPending || signUp.isPending || oauth.isPending || resetPassword.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" showCloseButton={false}>
        <DialogHeader>
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-amber-500 flex items-center justify-center text-white mx-auto mb-3">
            <Cake className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center font-display text-xl font-bold">
            {mode === "login" && "Вход в личный кабинет"}
            {mode === "register" && "Регистрация"}
            {mode === "forgot" && "Восстановление пароля"}
          </DialogTitle>
          <DialogDescription className="text-center text-sm">
            {mode === "login" && "Войдите чтобы заказывать торты и пользоваться личным кабинетом"}
            {mode === "register" && "Создайте аккаунт за 30 секунд"}
            {mode === "forgot" && "Введите email — мы отправим ссылку для сброса пароля"}
          </DialogDescription>
        </DialogHeader>

        {mode !== "forgot" && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as "login" | "register")}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">Вход</TabsTrigger>
              <TabsTrigger value="register">Регистрация</TabsTrigger>
            </TabsList>

            {/* === LOGIN === */}
            <TabsContent value="login" className="space-y-4 mt-4">
              <form onSubmit={handleSignIn} className="space-y-3">
                <div>
                  <Label htmlFor="auth-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="auth-email"
                      type="email"
                      placeholder="you@example.com"
                      className="pl-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="auth-password">Пароль</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className="pl-10 pr-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox id="remember" />
                    <span>Запомнить меня</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="text-primary hover:underline"
                  >
                    Забыли пароль?
                  </button>
                </div>

                <Button type="submit" className="w-full" disabled={isProcessing}>
                  {signIn.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Вход...
                    </>
                  ) : (
                    "Войти"
                  )}
                </Button>
              </form>

              {/* OAuth */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">или через</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOAuth("google")}
                  disabled={isProcessing}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOAuth("yandex")}
                  disabled={isProcessing}
                  title="Яндекс"
                >
                  <span className="font-bold text-red-500 text-sm">Я</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOAuth("vk")}
                  disabled={isProcessing}
                  title="ВКонтакте"
                >
                  <span className="font-bold text-blue-500 text-sm">VK</span>
                </Button>
              </div>

              {/* Magic Link */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setMode("magic")}
                  className="text-xs text-primary hover:underline"
                >
                  Войти по магической ссылке (без пароля)
                </button>
              </div>
            </TabsContent>

            {/* === REGISTER === */}
            <TabsContent value="register" className="space-y-4 mt-4">
              <form onSubmit={handleSignUp} className="space-y-3">
                <div>
                  <Label htmlFor="reg-name">Имя *</Label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="reg-name"
                      placeholder="Как вас зовут"
                      className="pl-10"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoComplete="name"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="reg-email">Email *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="reg-email"
                      type="email"
                      placeholder="you@example.com"
                      className="pl-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="reg-phone">Телефон</Label>
                  <Input
                    id="reg-phone"
                    type="tel"
                    placeholder="+7 (000) 000-00-00"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                  />
                </div>

                <div>
                  <Label htmlFor="reg-password">Пароль *</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="reg-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Минимум 8 символов"
                      className="pl-10 pr-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <label className="flex items-start gap-2 cursor-pointer text-xs">
                  <Checkbox
                    id="terms"
                    checked={agreeToTerms}
                    onCheckedChange={(v: boolean) => setAgreeToTerms(v)}
                  />
                  <span className="text-muted-foreground">
                    Я согласен с{" "}
                    <a href="/about?legal=terms" className="text-primary hover:underline">условиями</a>{" "}
                    и{" "}
                    <a href="/about?legal=privacy" className="text-primary hover:underline">политикой конфиденциальности</a>
                  </span>
                </label>

                <Button type="submit" className="w-full" disabled={isProcessing || !agreeToTerms}>
                  {signUp.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Регистрация...
                    </>
                  ) : (
                    "Зарегистрироваться"
                  )}
                </Button>

                <p className="text-[10px] text-muted-foreground text-center">
                  После регистрации вы получите роль CUSTOMER по умолчанию.
                  Роли CONFECTIONER, COURIER, SUPPLIER и другие назначаются через админ-панель.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        )}

        {/* === FORGOT PASSWORD === */}
        {mode === "forgot" && (
          <form onSubmit={handleResetPassword} className="space-y-4 mt-4">
            <div>
              <Label htmlFor="reset-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="you@example.com"
                  className="pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isProcessing}>
              {resetPassword.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Отправка...
                </>
              ) : (
                "Отправить ссылку"
              )}
            </Button>

            <button
              type="button"
              onClick={() => setMode("login")}
              className="w-full text-center text-xs text-primary hover:underline"
            >
              ← Вернуться к входу
            </button>
          </form>
        )}

        {/* === MAGIC LINK === */}
        {mode === "magic" && (
          <div className="space-y-4 mt-4">
            {magicEmailSent ? (
              <div className="text-center space-y-4 py-8">
                <MailOpen className="h-16 w-16 text-primary mx-auto" />
                <div>
                  <h3 className="font-display text-xl font-bold mb-2">Проверьте почту!</h3>
                  <p className="text-sm text-muted-foreground">
                    Мы отправили магическую ссылку на <strong>{email}</strong>.
                    Нажмите на ссылку в письме, чтобы войти без пароля.
                  </p>
                </div>
                <Button variant="outline" onClick={() => setMode("login")}>
                  ← Вернуться к входу
                </Button>
              </div>
            ) : (
              <form onSubmit={handleMagicLink} className="space-y-3">
                <div className="text-center mb-2">
                  <Zap className="h-10 w-10 text-primary mx-auto mb-2" />
                  <h3 className="font-display text-lg font-bold">Вход без пароля</h3>
                  <p className="text-sm text-muted-foreground">
                    Введите email — мы отправим ссылку для мгновенного входа
                  </p>
                </div>
                <div>
                  <Label htmlFor="magic-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="magic-email"
                      type="email"
                      placeholder="you@example.com"
                      className="pl-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={magicLink.isPending}>
                  {magicLink.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Отправка...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      Отправить магическую ссылку
                    </>
                  )}
                </Button>
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="w-full text-center text-xs text-primary hover:underline"
                >
                  ← Вернуться к входу
                </button>
              </form>
            )}
          </div>
        )}

        {/* Footer */}
        {mode !== "forgot" && mode !== "magic" && (
          <div className="text-center text-[10px] text-muted-foreground pt-2 border-t">
            <ShieldCheck className="inline h-3 w-3 mr-1" />
            Защищено Supabase Auth · 256-bit SSL
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
