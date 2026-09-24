"use client";

/**
 * TfaSettings — компонент настройки 2FA (TOTP) в кабинете кондитера.
 *
 * Flow:
 *  1. Если 2FA выключена — кнопка «Включить 2FA»
 *  2. При клике → POST /api/auth/2fa/setup → получаем secret + QR
 *  3. Пользователь сканирует QR, вводит первый код → POST /api/auth/2fa/verify
 *  4. Показываем backup-коды (один раз!) с предупреждением сохранить
 *  5. Если 2FA включена — кнопка «Отключить» (требует TOTP или backup)
 *
 * Также: чекбокс «Требовать 2FA для выплат» — управляет tfaRequiredFor.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shield, ShieldCheck, ShieldAlert, Copy, Check, AlertTriangle, KeyRound } from "lucide-react";
import { toast } from "sonner";

type Step = "idle" | "setup" | "verify" | "backup" | "disable";

export function TfaSettings() {
  const [step, setStep] = useState<Step>("idle");
  const [loading, setLoading] = useState(false);

  // setup step
  const [qrUrl, setQrUrl] = useState("");
  const [secret, setSecret] = useState("");

  // verify step
  const [verifyCode, setVerifyCode] = useState("");

  // backup codes
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copiedAll, setCopiedAll] = useState(false);

  // disable step
  const [disableCode, setDisableCode] = useState("");
  const [disableBackup, setDisableBackup] = useState("");

  // status
  const [enabled, setEnabled] = useState(false); // заглушка: в реальном коде тянем с /api/auth/me

  // === SETUP ===
  async function handleSetup() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/setup", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Ошибка инициализации 2FA");
      }
      const data = await res.json();
      setQrUrl(data.qrCodeUrl);
      setSecret(data.secret);
      setStep("setup");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // === VERIFY ===
  async function handleVerify() {
    if (!/^\d{6}$/.test(verifyCode)) {
      toast.error("Код должен быть 6 цифр");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: verifyCode }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Неверный код");
      }
      const data = await res.json();
      setBackupCodes(data.backupCodes);
      setEnabled(true);
      setStep("backup");
      toast.success("2FA включена!");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // === DISABLE ===
  async function handleDisable() {
    if (!disableCode && !disableBackup) {
      toast.error("Введите TOTP-код или backup-код");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode || undefined, backupCode: disableBackup || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Неверный код");
      }
      setEnabled(false);
      setStep("idle");
      toast.success("2FA отключена");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function copyAllCodes() {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
    toast.success("Все коды скопированы");
  }

  // ===== RENDER =====
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-medium">Двухфакторная аутентификация</h3>
            {enabled ? (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                <ShieldCheck className="h-3 w-3 mr-1" />
                Включена
              </Badge>
            ) : (
              <Badge variant="outline">
                <ShieldAlert className="h-3 w-3 mr-1" />
                Выключена
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Дополнительная защита для операций с выплатами. После включения для запроса выплаты
            потребуется 6-значный код из приложения-аутентификатора (Google Authenticator, Authy, 1Password).
          </p>
        </div>
      </div>

      {!enabled && step === "idle" && (
        <Button onClick={handleSetup} disabled={loading} className="gap-2">
          <Shield className="h-4 w-4" />
          Включить 2FA
        </Button>
      )}

      {enabled && step === "idle" && (
        <div className="space-y-3">
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>2FA активна для выплат</AlertTitle>
            <AlertDescription>
              При запросе выплаты потребуется TOTP-код или backup-код.
            </AlertDescription>
          </Alert>
          <Button variant="outline" onClick={() => setStep("disable")} className="gap-2">
            <ShieldAlert className="h-4 w-4" />
            Отключить 2FA
          </Button>
        </div>
      )}

      {/* SETUP DIALOG */}
      <Dialog open={step === "setup"} onOpenChange={(o) => !o && setStep("idle")}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Настройка 2FA</DialogTitle>
            <DialogDescription>
              Отсканируйте QR-код в приложении-аутентификаторе (Google Authenticator, Authy).
              Если не можете сканировать — введите секрет вручную.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {qrUrl && (
              <div className="flex justify-center">
                <img src={qrUrl} alt="QR-код для 2FA" className="w-48 h-48 rounded-lg border" />
              </div>
            )}
            <div>
              <Label className="text-xs">Секрет (для ручного ввода)</Label>
              <div className="mt-1 flex gap-2">
                <Input value={secret} readOnly className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(secret);
                    toast.success("Секрет скопирован");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Введите 6-значный код из приложения</Label>
              <Input
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="text-center text-xl font-mono tracking-widest"
                maxLength={6}
              />
            </div>
            <Button onClick={handleVerify} disabled={loading || verifyCode.length !== 6} className="w-full">
              Подтвердить и включить 2FA
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* BACKUP CODES DIALOG */}
      <Dialog open={step === "backup"} onOpenChange={(o) => !o && setStep("idle")}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Backup-коды
            </DialogTitle>
            <DialogDescription>
              Сохраните эти коды в надёжном месте. Каждый код можно использовать один раз,
              если у вас нет доступа к телефону. После закрытия окна коды больше не будут показаны.
            </DialogDescription>
          </DialogHeader>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Внимание</AlertTitle>
            <AlertDescription>
              Эти коды отображаются только один раз. Если потеряете их — придётся отключать 2FA через поддержку.
            </AlertDescription>
          </Alert>
          <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg font-mono text-sm">
            {backupCodes.map((code, i) => (
              <div key={i} className="text-center">
                {code}
              </div>
            ))}
          </div>
          <Button onClick={copyAllCodes} variant="outline" className="w-full gap-2">
            {copiedAll ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiedAll ? "Скопировано!" : "Скопировать все"}
          </Button>
          <Button onClick={() => setStep("idle")} className="w-full">
            Я сохранил коды, закрыть
          </Button>
        </DialogContent>
      </Dialog>

      {/* DISABLE DIALOG */}
      <Dialog open={step === "disable"} onOpenChange={(o) => !o && setStep("idle")}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Отключение 2FA</DialogTitle>
            <DialogDescription>
              Для отключения введите TOTP-код из приложения или один из backup-кодов.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>TOTP-код из приложения</Label>
              <Input
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="font-mono"
                maxLength={6}
              />
            </div>
            <div className="text-center text-xs text-muted-foreground">или</div>
            <div>
              <Label>Backup-код</Label>
              <Input
                value={disableBackup}
                onChange={(e) => setDisableBackup(e.target.value.toUpperCase().slice(0, 9))}
                placeholder="XXXX-XXXX"
                className="font-mono"
                maxLength={9}
              />
            </div>
            <Button onClick={handleDisable} disabled={loading} variant="destructive" className="w-full">
              Отключить 2FA
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
