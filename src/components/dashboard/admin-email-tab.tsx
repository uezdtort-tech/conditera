"use client";

/**
 * Admin UI: Почтовый ящик — входящие и исходящие письма.
 * Просмотр журнала отправленных + приём входящих через webhook.
 */
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Mail,
  MailOpen,
  Send,
  Search,
  Inbox,
  ArrowUp as Outbox,
  Clock,
  CheckCircle2,
  XCircle,
  Plus,
  Paperclip,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/finance";

const STATUS_INFO: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: "В очереди", color: "bg-slate-100 text-slate-700", icon: Clock },
  sent: { label: "Отправлено", color: "bg-blue-100 text-blue-700", icon: CheckCircle2 },
  failed: { label: "Ошибка", color: "bg-red-100 text-red-700", icon: XCircle },
  delivered: { label: "Доставлено", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  bounced: { label: "Возврат", color: "bg-amber-100 text-amber-700", icon: XCircle },
  spam: { label: "Спам", color: "bg-red-200 text-red-800", icon: XCircle },
};

interface Email {
  id: string;
  direction: "sent" | "received";
  fromAddress: string;
  fromName?: string;
  toAddress: string;
  toName?: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  template?: string;
  status: string;
  errorMessage?: string;
  sentAt?: string;
  receivedAt?: string;
  createdAt: string;
  attachments?: { id: string; filename: string; size: number }[];
}

export function AdminEmailTab() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const [search, setSearch] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [showCompose, setShowCompose] = useState(false);

  const loadEmails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("direction", filter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/email/list?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEmails(data.emails || []);
      }
    } catch (err) {
      console.error("Failed to load emails:", err);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  const stats = {
    total: emails.length,
    sent: emails.filter((e) => e.direction === "sent").length,
    received: emails.filter((e) => e.direction === "received").length,
    failed: emails.filter((e) => e.status === "failed").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Почта
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Входящие и исходящие письма — журнал отправок + приём через webhook
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={loadEmails}>
            <RefreshCw className="h-4 w-4 mr-1" /> Обновить
          </Button>
          <Button size="sm" onClick={() => setShowCompose(true)}>
            <Plus className="h-4 w-4 mr-1" /> Написать
          </Button>
        </div>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Всего</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Outbox className="h-3 w-3" />Отправлено
          </div>
          <div className="text-2xl font-bold text-blue-600">{stats.sent}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Inbox className="h-3 w-3" />Входящие
          </div>
          <div className="text-2xl font-bold text-emerald-600">{stats.received}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <XCircle className="h-3 w-3" />Ошибки
          </div>
          <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
        </Card>
      </div>

      {/* Фильтры */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по теме, email, имени..."
            className="pl-9"
          />
        </div>
        {[
          { id: "all", l: "Все", icon: Mail },
          { id: "received", l: "Входящие", icon: Inbox },
          { id: "sent", l: "Исходящие", icon: Outbox },
        ].map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            onClick={() => setFilter(f.id as any)}
          >
            <f.icon className="h-3.5 w-3.5 mr-1" />
            {f.l}
          </Button>
        ))}
      </div>

      {/* Список писем */}
      <div className="space-y-2">
        {loading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Загрузка писем...
          </Card>
        ) : emails.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Писем не найдено
          </Card>
        ) : (
          emails.map((email) => {
            const StatusIcon = STATUS_INFO[email.status]?.icon || Clock;
            const isIncoming = email.direction === "received";
            return (
              <Card
                key={email.id}
                className="p-3 flex flex-wrap items-center gap-3 cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => setSelectedEmail(email)}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                  isIncoming ? "bg-emerald-100" : "bg-blue-100"
                }`}>
                  {isIncoming ? <Inbox className="h-5 w-5 text-emerald-600" /> : <Outbox className="h-5 w-5 text-blue-600" />}
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{email.subject}</span>
                    {email.template && (
                      <Badge variant="outline" className="text-[10px]">{email.template}</Badge>
                    )}
                    {email.attachments && email.attachments.length > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        <Paperclip className="h-2.5 w-2.5 mr-0.5" />
                        {email.attachments.length}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {isIncoming ? (
                      <>От: <span className="font-medium">{email.fromName || email.fromAddress}</span></>
                    ) : (
                      <>Кому: <span className="font-medium">{email.toName || email.toAddress}</span></>
                    )}
                    <span className="mx-2">•</span>
                    {formatDateTime(email.sentAt || email.receivedAt || email.createdAt)}
                  </div>
                </div>
                <Badge className={`text-[10px] ${STATUS_INFO[email.status]?.color}`}>
                  <StatusIcon className="h-2.5 w-2.5 mr-0.5" />
                  {STATUS_INFO[email.status]?.label || email.status}
                </Badge>
              </Card>
            );
          })
        )}
      </div>

      {/* Просмотр письма */}
      {selectedEmail && (
        <EmailViewDialog email={selectedEmail} onClose={() => setSelectedEmail(null)} />
      )}

      {/* Написать письмо */}
      {showCompose && (
        <ComposeDialog
          onClose={() => setShowCompose(false)}
          onSent={() => {
            setShowCompose(false);
            loadEmails();
          }}
        />
      )}
    </div>
  );
}

// =================== Email View Dialog ===================
function EmailViewDialog({ email, onClose }: { email: Email; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <MailOpen className="h-5 w-5 text-primary" />
            {email.subject}
          </DialogTitle>
          <DialogDescription>
            {email.direction === "received" ? "Входящее" : "Исходящее"} • {formatDateTime(email.sentAt || email.receivedAt || email.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Информация об отправителе/получателе */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground">От</Label>
              <div className="font-medium">{email.fromName || email.fromAddress}</div>
              <div className="text-xs text-muted-foreground">{email.fromAddress}</div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Кому</Label>
              <div className="font-medium">{email.toName || email.toAddress}</div>
              <div className="text-xs text-muted-foreground">{email.toAddress}</div>
            </div>
          </div>

          {/* Статус */}
          <div className="flex items-center gap-2">
            <Badge className={STATUS_INFO[email.status]?.color}>
              {STATUS_INFO[email.status]?.label || email.status}
            </Badge>
            {email.errorMessage && (
              <span className="text-xs text-red-600">{email.errorMessage}</span>
            )}
          </div>

          {/* Тело письма */}
          <div>
            {email.htmlBody ? (
              <div
                className="border rounded-lg p-4 prose prose-sm max-w-none overflow-x-auto"
                dangerouslySetInnerHTML={{ __html: email.htmlBody }}
              />
            ) : (
              <div className="border rounded-lg p-4 whitespace-pre-wrap text-sm">
                {email.textBody || "(пусто)"}
              </div>
            )}
          </div>

          {/* Вложения */}
          {email.attachments && email.attachments.length > 0 && (
            <div>
              <Label className="text-xs font-semibold">Вложения</Label>
              <div className="flex gap-2 mt-2 flex-wrap">
                {email.attachments.map((att) => (
                  <Badge key={att.id} variant="outline" className="text-xs">
                    <Paperclip className="h-3 w-3 mr-1" />
                    {att.filename} ({Math.round(att.size / 1024)} КБ)
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =================== Compose Dialog ===================
function ComposeDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [form, setForm] = useState({
    to: "",
    toName: "",
    subject: "",
    text: "",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!form.to.trim() || !form.subject.trim() || !form.text.trim()) {
      toast.error("Заполните все поля");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/email/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: form.to,
          toName: form.toName || undefined,
          subject: form.subject,
          text: form.text,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          toast.success("Письмо отправлено");
          onSent();
        } else {
          toast.error(`Ошибка: ${data.error || "не удалось отправить"}`);
        }
      }
    } catch {
      toast.error("Ошибка отправки");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новое письмо</DialogTitle>
          <DialogDescription>Отправка email через SMTP</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Кому (email)</Label>
            <Input
              type="email"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
              placeholder="client@example.ru"
            />
          </div>
          <div>
            <Label>Имя получателя (опционально)</Label>
            <Input
              value={form.toName}
              onChange={(e) => setForm({ ...form, toName: e.target.value })}
              placeholder="Иван Иванов"
            />
          </div>
          <div>
            <Label>Тема</Label>
            <Input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Тема письма"
            />
          </div>
          <div>
            <Label>Текст</Label>
            <Textarea
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              rows={8}
              placeholder="Текст письма..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Отправка..." : (
              <>
                <Send className="h-4 w-4 mr-1" />Отправить
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
