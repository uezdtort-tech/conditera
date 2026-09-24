"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ShieldCheck, QrCode, ExternalLink, Download } from "lucide-react";
import { toast } from "sonner";

interface SupportAddress {
  available: boolean;
  address?: string;
  displayName?: string;
  qrUrl?: string;
  deepLink?: string;
  instructions?: {
    step1: string;
    step2: string;
    step3: string;
    step4: string;
  };
}

/**
 * Виджет «Приватный канал SimpleX» — показывается в карточке кондитера
 * или на странице поддержки. Позволяет клиенту подключиться через QR-код.
 */
export function SimpleXConnectWidget({
  variant = "default",
  title = "Приватный канал",
  description,
}: {
  variant?: "default" | "compact" | "banner";
  title?: string;
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SupportAddress | null>(null);
  const [loading, setLoading] = useState(false);

  const loadAddress = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/simplex/support-address");
      if (res.ok) {
        const d = await res.json();
        setData(d);
        if (d.available) {
          setOpen(true);
        } else {
          toast.info("Приватный канал поддержки пока недоступен. Используйте обычный чат.");
        }
      }
    } catch (err) {
      toast.error("Не удалось получить адрес поддержки");
    } finally {
      setLoading(false);
    }
  };

  if (variant === "compact") {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          onClick={loadAddress}
          disabled={loading}
          className="gap-1.5"
        >
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          {loading ? "..." : "Приватный канал"}
        </Button>
        <SimpleXDialog open={open} onOpenChange={setOpen} data={data} title={title} description={description} />
      </>
    );
  }

  if (variant === "banner") {
    return (
      <>
        <Card className="p-4 bg-gradient-to-r from-emerald-50 to-primary/5 border-emerald-200">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm">{title}</span>
                <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">E2E</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                {description ||
                  "Обсудите заказ конфиденциально через SimpleX Chat — сквозное шифрование, без регистрации, без передачи телефона."}
              </p>
              <Button
                size="sm"
                onClick={loadAddress}
                disabled={loading}
                className="gap-1.5"
              >
                <QrCode className="h-3.5 w-3.5" />
                {loading ? "Загрузка..." : "Показать QR-код"}
              </Button>
            </div>
          </div>
        </Card>
        <SimpleXDialog open={open} onOpenChange={setOpen} data={data} title={title} description={description} />
      </>
    );
  }

  // default
  return (
    <>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-sm">{title}</span>
              <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-200">
                E2E шифрование
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {description ||
                "SimpleX Chat — самый приватный мессенджер. Без номера телефона, без email, без идентификаторов. Сквозное шифрование Double Ratchet + пост-квантовая защита."}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={loadAddress}
              disabled={loading}
              className="gap-1.5"
            >
              <QrCode className="h-3.5 w-3.5" />
              {loading ? "Загрузка..." : "Подключиться через QR"}
            </Button>
          </div>
        </div>
      </Card>
      <SimpleXDialog open={open} onOpenChange={setOpen} data={data} title={title} description={description} />
    </>
  );
}

function SimpleXDialog({
  open,
  onOpenChange,
  data,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: SupportAddress | null;
  title: string;
  description?: string;
}) {
  if (!data?.available) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {description ||
              "Отсканируйте QR-код в приложении SimpleX Chat, чтобы подключиться конфиденциально."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* QR-код */}
          <div className="flex justify-center">
            <div className="relative">
              <img
                src={data.qrUrl}
                alt="QR-код SimpleX"
                className="w-56 h-56 rounded-lg border-2 border-emerald-200"
              />
              <Badge
                className="absolute -top-2 -right-2 bg-emerald-500 text-white gap-1"
              >
                <ShieldCheck className="h-3 w-3" />
                E2E
              </Badge>
            </div>
          </div>

          {/* Инструкция */}
          <div className="bg-emerald-50/50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-emerald-900">Как подключиться:</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>{data.instructions?.step1 || "Установите SimpleX Chat с simplex.chat"}</li>
              <li>{data.instructions?.step2 || "Откройте приложение → «Добавить контакт»"}</li>
              <li>{data.instructions?.step3 || "Отсканируйте QR-код выше"}</li>
              <li>{data.instructions?.step4 || "Отправьте первое сообщение"}</li>
            </ol>
          </div>

          {/* Адрес (для ручного ввода) */}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Или скопировать адрес вручную
            </summary>
            <div className="mt-2 flex gap-2">
              <code className="flex-1 text-[10px] bg-muted px-2 py-1 rounded break-all">
                {data.address}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 h-7"
                onClick={() => {
                  navigator.clipboard?.writeText(data.address || "");
                  toast.success("Адрес скопирован");
                }}
              >
                Копировать
              </Button>
            </div>
          </details>

          {/* Кнопки действий */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => window.open(data.qrUrl, "_blank")}
            >
              <Download className="h-3.5 w-3.5" />
              Скачать QR
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => window.open("https://simplex.chat/downloads/", "_blank")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Установить SimpleX
            </Button>
          </div>

          {/* Предупреждение */}
          <div className="text-[10px] text-muted-foreground text-center border-t pt-2">
            ⚠️ Переписка E2E-шифрована. Маркетплейс не видит содержимое сообщений.
            Сохраняйте backup ключей — при потере устройства история не восстанавливается.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
