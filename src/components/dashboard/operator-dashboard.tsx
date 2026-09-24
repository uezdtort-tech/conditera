"use client";

/**
 * OperatorDashboard — realtime-интерфейс для операторов поддержки.
 *
 * Показывает:
 *  - Сводку эскалаций (pending/assigned/resolved)
 *  - Список эскалаций с фильтром по статусу
 *  - Кнопки "Взять в работу" / "Закрыть"
 *  - Auto-refresh каждые 15 секунд
 *
 * Эскалации создаются автоматически:
 *  - reason: "manual_request" — пользователь написал "оператор"
 *  - reason: "bot_unknown" — бот не понял 3+ раза подряд
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, MessageSquare } from "lucide-react";
import { CANNED_RESPONSES, getCategories, fillTemplate, type CannedResponse } from "@/lib/canned-responses";
import {
  Headphones,
  Clock,
  CheckCircle2,
  UserCog,
  AlertCircle,
  RefreshCw,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";

interface Escalation {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  reason: string;
  message: string;
  status: string;
  assignedTo: string | null;
  assignedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
}

interface Summary {
  pending: number;
  assigned: number;
  resolved: number;
  total: number;
}

const REASON_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  manual_request: { label: "Запрос оператора", color: "bg-blue-100 text-blue-800", icon: "🙋" },
  bot_unknown: { label: "Бот не справился", color: "bg-amber-100 text-amber-800", icon: "🤖" },
  complaint: { label: "Жалоба", color: "bg-red-100 text-red-800", icon: "⚠️" },
  dispute: { label: "Спор", color: "bg-purple-100 text-purple-800", icon: "⚖️" },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Ожидает", color: "bg-amber-100 text-amber-800" },
  assigned: { label: "В работе", color: "bg-blue-100 text-blue-800" },
  resolved: { label: "Закрыта", color: "bg-emerald-100 text-emerald-800" },
};

function formatRelative(date: string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}с назад`;
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`;
  return `${Math.floor(diff / 86400)}д назад`;
}

export function OperatorDashboard() {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [summary, setSummary] = useState<Summary>({ pending: 0, assigned: 0, resolved: 0, total: 0 });
  const [filter, setFilter] = useState<string>("pending");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Чат с пользователем
  const [chatDialog, setChatDialog] = useState<Escalation | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Canned responses
  const [showCanned, setShowCanned] = useState(false);
  const [cannedCategory, setCannedCategory] = useState<string>("greeting");
  const categories = getCategories();

  async function handleOpenChat(esc: Escalation) {
    setChatDialog(esc);
    setChatLoading(true);
    try {
      const res = await fetch(`/api/operator/messages?escalationId=${esc.id}`);
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data.messages || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleSendMessage() {
    if (!chatDialog || !chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput("");
    // Оптимистично добавляем сообщение
    setChatMessages((prev) => [
      ...prev,
      {
        id: `temp_${Date.now()}`,
        senderId: "operator",
        text,
        isBot: false,
        isSystem: false,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const res = await fetch("/api/operator/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escalationId: chatDialog.id, text }),
      });
      if (res.ok) {
        // Авто-assign мог поменять статус — обновляем список
        load();
      } else {
        toast.error("Не удалось отправить");
      }
    } catch (e) {
      toast.error("Ошибка сети");
    }
  }

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages.length]);

  function handleInsertCanned(canned: CannedResponse) {
    const vars: Record<string, string> = {
      userName: chatDialog?.userName || "Пользователь",
      operatorName: "Оператор",
      orderNumber: chatDialog?.message?.match(/#([A-Z0-9-]+)/)?.[1] || "—",
      amount: "0",
      percent: "10",
      confectionerName: "Кондитер",
    };
    const filled = fillTemplate(canned.text, vars);
    setChatInput(filled);
    setShowCanned(false);
  }

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/operator/escalations?status=${filter}`);
      if (res.ok) {
        const data = await res.json();
        setEscalations(data.escalations || []);
        setSummary(data.summary || { pending: 0, assigned: 0, resolved: 0, total: 0 });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
    // Auto-refresh каждые 15 секунд
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleAssign(id: string) {
    try {
      const res = await fetch("/api/operator/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escalationId: id }),
      });
      if (res.ok) {
        toast.success("Эскалация взята в работу");
        load();
      } else {
        const err = await res.json();
        toast.error(err.error || "Не удалось взять в работу");
      }
    } catch (e) {
      toast.error("Ошибка сети");
    }
  }

  async function handleResolve(id: string, resolution: string) {
    try {
      const res = await fetch("/api/operator/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escalationId: id, resolution }),
      });
      if (res.ok) {
        toast.success("Эскалация закрыта");
        load();
      } else {
        const err = await res.json();
        toast.error(err.error || "Не удалось закрыть");
      }
    } catch (e) {
      toast.error("Ошибка сети");
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-medium flex items-center gap-2">
            <Headphones className="h-6 w-6 text-primary" />
            Оператор поддержки
          </h2>
          <p className="text-sm text-muted-foreground">
            Эскалации от авточата. Авто-refresh каждые 15 секунд.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={refreshing} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4 cursor-pointer hover:border-primary/40 transition-colors" onClick={() => setFilter("pending")}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 text-amber-500" />
            Ожидают
          </div>
          <div className={`text-2xl font-bold mt-1 ${filter === "pending" ? "text-amber-600" : ""}`}>
            {summary.pending}
          </div>
        </Card>
        <Card className="p-4 cursor-pointer hover:border-primary/40 transition-colors" onClick={() => setFilter("assigned")}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserCog className="h-4 w-4 text-blue-500" />
            В работе
          </div>
          <div className={`text-2xl font-bold mt-1 ${filter === "assigned" ? "text-blue-600" : ""}`}>
            {summary.assigned}
          </div>
        </Card>
        <Card className="p-4 cursor-pointer hover:border-primary/40 transition-colors" onClick={() => setFilter("resolved")}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Закрыто
          </div>
          <div className={`text-2xl font-bold mt-1 ${filter === "resolved" ? "text-emerald-600" : ""}`}>
            {summary.resolved}
          </div>
        </Card>
        <Card className="p-4 cursor-pointer hover:border-primary/40 transition-colors" onClick={() => setFilter("all")}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Inbox className="h-4 w-4" />
            Всего
          </div>
          <div className={`text-2xl font-bold mt-1 ${filter === "all" ? "text-primary" : ""}`}>
            {summary.total}
          </div>
        </Card>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {["pending", "assigned", "resolved", "all"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
              filter === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-accent border-border"
            }`}
          >
            {STATUS_LABELS[s === "all" ? "pending" : s]?.label || "Все"}
            {s === "all" && ` (${summary.total})`}
            {s === "pending" && ` (${summary.pending})`}
            {s === "assigned" && ` (${summary.assigned})`}
            {s === "resolved" && ` (${summary.resolved})`}
          </button>
        ))}
      </div>

      {/* Escalations list */}
      {loading ? (
        <Card className="p-6">
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-muted/50 rounded" />
            ))}
          </div>
        </Card>
      ) : escalations.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-emerald-500" />
          <h3 className="font-display text-lg">Нет эскалаций</h3>
          <p className="text-sm mt-1">
            {filter === "pending" && "Все обращения обработаны авточатом"}
            {filter === "assigned" && "Нет активных назначений"}
            {filter === "resolved" && "Нет закрытых эскалаций"}
            {filter === "all" && "Эскалаций пока не было"}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {escalations.map((esc) => {
            const reason = REASON_LABELS[esc.reason] || REASON_LABELS.manual_request;
            const status = STATUS_LABELS[esc.status] || STATUS_LABELS.pending;
            return (
              <Card key={esc.id} className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="text-xs">
                      {esc.userName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{esc.userName}</span>
                      <Badge className={reason.color + " text-[10px]"}>
                        {reason.icon} {reason.label}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${status.color}`}>
                        {status.label}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {formatRelative(esc.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm mt-1 text-muted-foreground line-clamp-2">
                      {esc.message}
                    </p>
                    {esc.assignedAt && (
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Назначена: {formatRelative(esc.assignedAt)}
                        {esc.resolvedAt && ` • Закрыта: ${formatRelative(esc.resolvedAt)}`}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 pl-12 flex-wrap">
                  {esc.status === "pending" && (
                    <>
                      <Button size="sm" onClick={() => handleAssign(esc.id)} className="gap-1.5">
                        <UserCog className="h-3.5 w-3.5" />
                        Взять в работу
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleOpenChat(esc)} className="gap-1.5">
                        <Headphones className="h-3.5 w-3.5" />
                        Открыть чат
                      </Button>
                    </>
                  )}
                  {esc.status === "assigned" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenChat(esc)}
                        className="gap-1.5"
                      >
                        <Headphones className="h-3.5 w-3.5" />
                        Открыть чат
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResolve(esc.id, "answered")}
                        className="gap-1.5"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Отвечено
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResolve(esc.id, "redirected")}
                      >
                        Перенаправлено
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleResolve(esc.id, "no_action")}
                      >
                        Без действий
                      </Button>
                    </>
                  )}
                  {esc.status === "resolved" && esc.resolution && (
                    <Badge variant="outline" className="text-[10px]">
                      {esc.resolution === "answered" && "✓ Отвечено"}
                      {esc.resolution === "redirected" && "↗ Перенаправлено"}
                      {esc.resolution === "no_action" && "— Без действий"}
                    </Badge>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Диалог прямого чата с пользователем */}
      <Dialog open={!!chatDialog} onOpenChange={(o) => !o && setChatDialog(null)}>
        <DialogContent className="max-w-lg p-0 flex flex-col" style={{ height: "70vh" }}>
          <DialogHeader className="p-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Headphones className="h-4 w-4 text-primary" />
              Чат с пользователем
            </DialogTitle>
            <DialogDescription>
              {chatDialog?.userName} • {REASON_LABELS[chatDialog?.reason || ""]?.label}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 bg-muted/30">
            <div className="p-3 space-y-2">
              {chatLoading ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  Загрузка сообщений...
                </div>
              ) : chatMessages.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  Сообщений пока нет. Начните диалог.
                </div>
              ) : (
                chatMessages.map((msg) => {
                  const isOperator = msg.senderId === "operator" || (!msg.isBot && !msg.isSystem && msg.senderId !== chatDialog?.userId);
                  const isBot = msg.isBot;
                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-2 ${isOperator ? "flex-row-reverse" : ""}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                          isOperator
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : isBot
                            ? "bg-gradient-to-br from-primary/5 to-accent/30 border border-primary/20 rounded-bl-md"
                            : "bg-card border border-border rounded-bl-md"
                        }`}
                      >
                        {isBot && (
                          <div className="text-[10px] text-primary font-medium mb-1">
                            🤖 Бот
                          </div>
                        )}
                        <div className="text-xs leading-relaxed whitespace-pre-wrap">
                          {msg.text}
                        </div>
                        <div
                          className={`text-[9px] mt-1 ${
                            isOperator ? "text-primary-foreground/70" : "text-muted-foreground"
                          }`}
                        >
                          {new Date(msg.createdAt).toLocaleTimeString("ru-RU", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>

          {/* Canned responses panel */}
          {showCanned && (
            <div className="border-t bg-muted/30 max-h-48 overflow-y-auto">
              <div className="flex gap-1 p-2 border-b overflow-x-auto">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCannedCategory(c.id)}
                    className={`px-2.5 py-1 text-[11px] rounded-full border whitespace-nowrap transition-colors ${
                      cannedCategory === c.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-accent border-border"
                    }`}
                  >
                    {c.label} ({c.count})
                  </button>
                ))}
              </div>
              <div className="p-2 space-y-1">
                {CANNED_RESPONSES.filter((r) => r.category === cannedCategory).map((canned) => (
                  <button
                    key={canned.id}
                    onClick={() => handleInsertCanned(canned)}
                    className="w-full text-left p-2 rounded border hover:border-primary/40 hover:bg-accent/50 transition-colors"
                  >
                    <div className="text-xs font-medium text-primary">{canned.label}</div>
                    <div className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                      {canned.text}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="p-3 border-t flex items-center gap-2 shrink-0"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowCanned(!showCanned)}
              className="h-10 w-10 shrink-0 text-muted-foreground hover:text-primary"
              title="Шаблоны ответов"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Сообщение пользователю..."
              className="flex-1"
            />
            <Button type="submit" size="icon" disabled={!chatInput.trim()} className="h-10 w-10 shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
