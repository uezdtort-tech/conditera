"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Lock, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function ResetPasswordPage(): React.JSX.Element {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSuccess, setIsSuccess] = React.useState(false);

  React.useEffect(() => {
    // Проверяем, что у нас есть access_token от reset password ссылки
    const checkSession = async (): Promise<void> => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        // Нет сессии — значит пользователь не кликнул по ссылке из email
        toast.error("Ссылка недействительна", {
          description: "Запросите новую ссылку для сброса пароля",
        });
        router.push("/login");
      }
    };
    checkSession();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Пароли не совпадают");
      return;
    }
    if (password.length < 8) {
      toast.error("Пароль должен быть не менее 8 символов");
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabaseBrowser.auth.updateUser({
        password,
      });
      if (error) throw error;

      setIsSuccess(true);
      toast.success("Пароль изменён", {
        description: "Теперь вы можете войти с новым паролем.",
      });

      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);
    } catch (error) {
      toast.error("Ошибка смены пароля", {
        description: (error as Error).message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <Card className="p-8 max-w-md w-full">
          {isSuccess ? (
            <div className="text-center space-y-3">
              <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto" />
              <h1 className="font-display text-2xl font-bold">Пароль изменён</h1>
              <p className="text-sm text-muted-foreground">
                Через 2 секунды вы будете перенаправлены в личный кабинет.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="text-center mb-4">
                <Lock className="h-12 w-12 text-primary mx-auto mb-2" />
                <h1 className="font-display text-2xl font-bold">Новый пароль</h1>
                <p className="text-sm text-muted-foreground">
                  Введите новый пароль для вашего аккаунта
                </p>
              </div>

              <div>
                <Label htmlFor="new-password">Новый пароль</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="Минимум 8 символов"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoFocus
                />
              </div>

              <div>
                <Label htmlFor="confirm-password">Повторите пароль</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Изменение...
                  </>
                ) : (
                  "Изменить пароль"
                )}
              </Button>
            </form>
          )}
        </Card>
      </main>
      <Footer />
    </div>
  );
}
