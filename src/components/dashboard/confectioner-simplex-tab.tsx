"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ShieldCheck, QrCode, MessageSquare, Users, Send,
  Trash2, RefreshCw, Plus, CheckCircle2, AlertCircle, Info,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/finance";

interface SimpleXContact {
  id: string;
  simplexAddress: string | null;
  simplexName: string | null;
  profileType: string;
  active: boolean;
  connectionsCount: number;
  createdAt: string;
}

interface SimpleXMessage {
  id: string;
  simplexChatId: string;
  simplexMsgId: string;
  fromName: string | null;
  text: string | null;
  metadata: Record<string, unknown>;
  direction: string;
  readByOperator: boolean;
  receivedAt: string;
}

interface SimpleXState {
  contact: SimpleXContact | null;
  recentMessages: SimpleXMessage[];
  stats: { total: number; unread: number };
  tariff: { current: string; allowed: boolean; required: string[] } | null;
  connectInstructions: {
    address: string;
    qrUrl: string;
    deepLink: string;
  } | null;
}

export function ConfectionerSimpleXTab() {
  const user = useAppStore((s) => s.user);
  const navigate = useAppStore((s) => s.navigate);
  const [state, setState] = useState<SimpleXState | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [replyTo, setReplyTo] = useState<{ chatId: string; fromName: string } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const prevUnreadRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/simplex/contacts");
      if (res.ok) {
        const data: SimpleXState = await res.json();
        setState(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!state?.contact?.active) return;
    const interval = window.setInterval(() => {
      fetch("/api/simplex/contacts")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: SimpleXState | null) => {
          if (!data) return;
          const newUnread = data.stats?.unread || 0;
          if (prevUnreadRef.current !== null && newUnread > prevUnreadRef.current) {
            const diff = newUnread - prevUnreadRef.current;
            toast.info("Новых SimpleX-сообщений: " + diff, {
              description: "Откройте вкладку SimpleX, чтобы прочитать",
            });
          }
          prevUnreadRef.current = newUnread;
          setState(data);
        })
        .catch(() => {});
    }, 20000);
    return () => window.clearInterval(interval);
  }, [state?.contact?.active]);

  useEffect(() => {
    if (state?.stats && prevUnreadRef.current === null) {
      prevUnreadRef.current = state.stats.unread;
    }
  }, [state?.stats]);

  const handleCreateProfile = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/simplex/contacts", { method: "POST" });
      if (res.ok) {
        toast.success("SimpleX-профиль создан!");
        await load();
        setShowQR(true);
      } else {
        const err = await res.json().catch(() => ({}));
        if (err.contact) {
          toast.info("Профиль уже существует");
          await load();
        } else if (err.code === "TARIFF_UPGRADE_REQUIRED") {
          toast.error("Требуется тариф PREMIUM или BUSINESS", {
            description: "Ваш тариф: " + (err.currentTariff || "START") + ". Перейдите в Настройки для апгрейда.",
          });
        } else {
          toast.error(err.error || "Ошибка создания профиля");
        }
      }
    } catch {
      toast.error("Ошибка сети");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!confirm("Деактивировать SimpleX-профиль? Существующие клиенты не смогут отправлять новые сообщения.")) {
      return;
    }
    try {
      const res = await fetch("/api/simplex/contacts", { method: "DELETE" });
      if (res.ok) {
        toast.success("Профиль деактивирован");
        await load();
      }
    } catch {
      toast.error("Ошибка");
    }
  };

  const handleSendReply = async () => {
    if (!replyTo || !replyText.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/simplex/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName: replyTo.fromName,
          text: replyText.trim(),
          chatId: replyTo.chatId,
        }),
      });
      if (res.ok) {
        toast.success("Ответ отправлен");
        setReplyText("");
        setReplyTo(null);
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Ошибка отправки");
      }
    } catch {
      toast.error("Ошибка сети");
    } finally {
      setSending(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/simplex/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      await load();
    } catch {}
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold">Приватный канал SimpleX</h1>
        <Card className="p-8 text-center text-muted-foreground">
          Загрузка...
        </Card>
      </div>
    );
  }

  const contact = state?.contact ?? null;
  const messages = state?.recentMessages || [];
  const stats = state?.stats || { total: 0, unread: 0 };
  const hasProfile = !!contact?.active;
  const tariff = state?.tariff;
  const tariffAllowed = !tariff || tariff.allowed;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-emerald-600" />
          Приватный канал SimpleX
        </h1>
        {hasProfile && (
          <Button variant="outline" size="sm" onClick={load} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" />
            Обновить
          </Button>
        )}
      </div>

      <Card className="p-4 bg-emerald-50/50 border-emerald-200">
        <div className="flex gap-3">
          <Info className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">E2E-шифрованный канал для премиум-клиентов</p>
            <p className="text-muted-foreground">
              SimpleX Chat обеспечивает сквозное шифрование (Double Ratchet + пост-квантовый CRYSTALS-Kyber).
              Клиенты подключаются через QR-код, переписка не видна серверам маркетплейса.
              Идеально для конфиденциальных B2B-переговоров и корпоративных заказов.
            </p>
          </div>
        </div>
      </Card>

      {!hasProfile ? (
        <Card className="p-8 text-center">
          <ShieldCheck className="h-16 w-16 mx-auto mb-4 text-emerald-600 opacity-70" />
          <h2 className="font-display text-xl font-bold mb-2">Создать приватный канал</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            После создания вы получите уникальный #simplex-адрес и QR-код.
            Разместите его в профиле или отправляйте клиентам напрямую — они подключатся
            через приложение SimpleX Chat и смогут общаться с вами конфиденциально.
          </p>

          {tariffAllowed ? (
            <Button onClick={handleCreateProfile} disabled={creating} className="gap-2">
              <Plus className="h-4 w-4" />
              {creating ? "Создание..." : "Создать SimpleX-профиль"}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
                <p className="font-semibold text-amber-800 mb-1">
                  Доступно на тарифах PREMIUM и BUSINESS
                </p>
                <p className="text-amber-700 text-xs">
                  Ваш текущий тариф: <b>{tariff?.current}</b>.
                  Приватный E2E-канал SimpleX — премиум-функция для B2B-клиентов
                  и конфиденциальных переговоров. Повысьте тариф, чтобы активировать.
                </p>
              </div>
              <Button onClick={() => navigate("dashboard-extra")} className="gap-2">
                <ShieldCheck className="h-4 w-4" />
                Повысить тариф
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4 text-center">
              <Users className="h-5 w-5 mx-auto mb-1 text-primary" />
              <div className="text-xs text-muted-foreground">Подключений</div>
              <div className="font-display text-2xl font-bold">{contact?.connectionsCount || 0}</div>
            </Card>
            <Card className="p-4 text-center">
              <MessageSquare className="h-5 w-5 mx-auto mb-1 text-emerald-600" />
              <div className="text-xs text-muted-foreground">Всего сообщений</div>
              <div className="font-display text-2xl font-bold">{stats.total}</div>
            </Card>
            <Card className="p-4 text-center">
              <AlertCircle className="h-5 w-5 mx-auto mb-1 text-amber-600" />
              <div className="text-xs text-muted-foreground">Непрочитано</div>
              <div className="font-display text-2xl font-bold text-amber-700">{stats.unread}</div>
            </Card>
          </div>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <QrCode className="h-4 w-4 text-primary" />
                Ваш #simplex-адрес
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setShowQR(!showQR)}>
                {showQR ? "Скрыть QR" : "Показать QR"}
              </Button>
            </div>
            {showQR && state?.connectInstructions && (
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <img
                  src={state.connectInstructions.qrUrl}
                  alt="QR-код для подключения"
                  className="rounded-lg border w-48 h-48"
                />
                <div className="flex-1 space-y-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Адрес:</div>
                    <code className="text-xs break-all bg-muted px-2 py-1 rounded block">
                      {state.connectInstructions.address}
                    </code>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">Как подключиться:</p>
                    <ol className="list-decimal list-inside space-y-0.5 text-xs">
                      <li>Установите SimpleX Chat (iOS / Android / desktop)</li>
                      <li>Откройте приложение → «Добавить контакт»</li>
                      <li>Сканируйте QR-код или вставьте адрес</li>
                      <li>Отправьте первое сообщение</li>
                    </ol>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard?.writeText(state.connectInstructions!.address);
                        toast.success("Адрес скопирован");
                      }}
                    >
                      Копировать адрес
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(state.connectInstructions!.qrUrl, "_blank")}
                    >
                      Открыть QR
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {!showQR && (
              <p className="text-sm text-muted-foreground">
                Адрес скрыт. Нажмите «Показать QR», чтобы увидеть QR-код для клиентов.
              </p>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                Входящие сообщения
                {stats.unread > 0 && (
                  <Badge className="bg-amber-100 text-amber-800 text-[10px]">{stats.unread} нов.</Badge>
                )}
              </h3>
              {stats.unread > 0 && (
                <Button size="sm" variant="ghost" onClick={handleMarkAllRead} className="gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Отметить прочитанными
                </Button>
              )}
            </div>

            {messages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Пока нет сообщений</p>
                <p className="text-xs mt-1">Поделитесь QR-кодом с клиентами</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {messages.map((msg) => {
                  const isOutgoing = msg.direction === "outgoing";
                  const files = (msg.metadata?.files as Array<{ fileName: string; fileSize: number }>) || [];
                  return (
                    <div
                      key={msg.id}
                      className={`p-3 rounded-lg border ${
                        isOutgoing
                          ? "bg-primary/5 border-primary/20 ml-8"
                          : msg.readByOperator
                          ? "bg-card"
                          : "bg-amber-50/50 border-amber-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-medium">
                            {isOutgoing ? "Вы" : msg.fromName || "Клиент"}
                          </span>
                          <span className="text-muted-foreground">
                            {formatDateTime(msg.receivedAt)}
                          </span>
                          {!msg.readByOperator && !isOutgoing && (
                            <Badge className="bg-amber-500 text-white text-[10px]">новое</Badge>
                          )}
                          {files.length > 0 && (
                            <Badge variant="outline" className="text-[10px]">
                              {files.length} файл(ов)
                            </Badge>
                          )}
                        </div>
                        {!isOutgoing && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] gap-1"
                            onClick={() => {
                              setReplyTo({ chatId: msg.simplexChatId, fromName: msg.fromName || "" });
                              setReplyText("");
                            }}
                          >
                            <Send className="h-3 w-3" />
                            Ответить
                          </Button>
                        )}
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {msg.text || "[" + (msg.metadata?.messageType as string || "media") + "]"}
                      </p>
                      {files.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {files.map((f, i) => (
                            <li key={i} className="text-xs text-muted-foreground">
                              {"\u{1F4CE}"} {f.fileName} ({Math.round((f.fileSize || 0) / 1024)} КБ)
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {replyTo && (
              <div className="mt-3 p-3 border-2 border-primary/30 rounded-lg bg-primary/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">
                    Ответ для: <span className="text-primary">{replyTo.fromName}</span>
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setReplyTo(null)}>
                    Отмена
                  </Button>
                </div>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Введите ответ..."
                  className="w-full min-h-[80px] p-2 border rounded bg-background text-sm"
                  maxLength={16000}
                />
                <div className="flex justify-between items-center mt-2">
                  <span className="text-[10px] text-muted-foreground">
                    {replyText.length} / 16000 символов
                  </span>
                  <Button size="sm" onClick={handleSendReply} disabled={sending || !replyText.trim()} className="gap-1">
                    <Send className="h-3.5 w-3.5" />
                    {sending ? "Отправка..." : "Отправить"}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-4 border-red-200">
            <h3 className="font-semibold text-red-700 mb-2 flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Деактивация профиля
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              После деактивации клиенты не смогут отправлять новые сообщения.
              Существующая переписка сохранится в дашборде.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDeleteProfile}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              Деактивировать SimpleX-профиль
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}
