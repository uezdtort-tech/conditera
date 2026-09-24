"use client";

/**
 * Admin UI: Служба безопасности — модерация контента.
 * 3 подтаба: Очередь, Правила, Жалобы.
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Flag,
  Search,
  Check,
  X,
  Plus,
  Trash2,
  AlertTriangle,
  Clock,
  FileWarning,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/finance";

const VIOLATION_LABELS: Record<string, { label: string; color: string }> = {
  "18+": { label: "18+", color: "bg-red-500 text-white" },
  extremism: { label: "Экстремизм", color: "bg-red-700 text-white" },
  drugs: { label: "Наркотики", color: "bg-red-700 text-white" },
  weapons: { label: "Оружие", color: "bg-red-700 text-white" },
  illegal_goods: { label: "Незаконное", color: "bg-red-700 text-white" },
  spam: { label: "Спам", color: "bg-amber-500 text-white" },
  insult: { label: "Оскорбление", color: "bg-orange-500 text-white" },
  hate_speech: { label: "Разжигание", color: "bg-red-600 text-white" },
  external_contacts: { label: "Контакты", color: "bg-blue-500 text-white" },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "В очереди", color: "bg-slate-100 text-slate-700" },
  approved: { label: "Одобрено", color: "bg-emerald-100 text-emerald-700" },
  flagged: { label: "Помечено", color: "bg-amber-100 text-amber-700" },
  rejected: { label: "Отклонено", color: "bg-red-100 text-red-700" },
};

export function AdminSecurityTab() {
  const [subtab, setSubtab] = useState<"queue" | "rules" | "reports">("queue");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Служба безопасности
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Модерация контента: защита от 18+, экстремизма, наркотиков, спама
        </p>
      </div>

      {/* Подтабы */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={subtab === "queue" ? "default" : "outline"}
          onClick={() => setSubtab("queue")}
        >
          <ListChecks className="h-4 w-4 mr-1" /> Очередь
        </Button>
        <Button
          size="sm"
          variant={subtab === "rules" ? "default" : "outline"}
          onClick={() => setSubtab("rules")}
        >
          <ShieldCheck className="h-4 w-4 mr-1" /> Правила
        </Button>
        <Button
          size="sm"
          variant={subtab === "reports" ? "default" : "outline"}
          onClick={() => setSubtab("reports")}
        >
          <FileWarning className="h-4 w-4 mr-1" /> Жалобы
        </Button>
      </div>

      {subtab === "queue" && <ModerationQueuePanel />}
      {subtab === "rules" && <ModerationRulesPanel />}
      {subtab === "reports" && <ReportsPanel />}
    </div>
  );
}

// =================== Moderation Queue Panel ===================
function ModerationQueuePanel() {
  const [items, setItems] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, queueRes] = await Promise.all([
        fetch("/api/moderation/stats"),
        fetch(`/api/moderation/queue?status=${filter}${search ? `&search=${search}` : ""}`),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (queueRes.ok) {
        const data = await queueRes.json();
        setItems(data.items || []);
      }
    } catch (err) {
      console.error("Failed to load moderation:", err);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAction = async (id: string, action: string, comment?: string) => {
    try {
      const res = await fetch(`/api/moderation/queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualStatus: action, moderatorComment: comment }),
      });
      if (res.ok) {
        toast.success(action === "approved" ? "Контент одобрен" : action === "rejected" ? "Контент отклонён" : "Эскалировано");
        loadData();
        setSelectedItem(null);
      }
    } catch {
      toast.error("Ошибка");
    }
  };

  return (
    <div className="space-y-4">
      {/* Статистика */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">В очереди</div>
            <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Помечено</div>
            <div className="text-2xl font-bold text-orange-600">{stats.flagged}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Одобрено</div>
            <div className="text-2xl font-bold text-emerald-600">{stats.approved}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Отклонено</div>
            <div className="text-2xl font-bold text-red-600">{stats.rejected}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">За сегодня</div>
            <div className="text-2xl font-bold">{stats.totalToday}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Жалобы</div>
            <div className="text-2xl font-bold text-red-600">{stats.reportsOpen}</div>
          </Card>
        </div>
      )}

      {/* Фильтры */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по контенту..."
            className="pl-9"
          />
        </div>
        {[
          { id: "pending", l: "В очереди" },
          { id: "flagged", l: "Помечено" },
          { id: "approved", l: "Одобрено" },
          { id: "rejected", l: "Отклонено" },
        ].map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            onClick={() => setFilter(f.id)}
          >
            {f.l}
          </Button>
        ))}
      </div>

      {/* Список */}
      <div className="space-y-2">
        {loading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Загрузка...
          </Card>
        ) : items.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Нет контента для модерации
          </Card>
        ) : (
          items.map((item) => (
            <Card
              key={item.id}
              className="p-3 flex flex-wrap items-center gap-3 cursor-pointer hover:border-primary/40"
              onClick={() => setSelectedItem(item)}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                item.autoStatus === "rejected" ? "bg-red-100" :
                item.autoStatus === "flagged" ? "bg-amber-100" : "bg-emerald-100"
              }`}>
                {item.autoStatus === "rejected" ? <ShieldAlert className="h-5 w-5 text-red-600" /> :
                 item.autoStatus === "flagged" ? <Flag className="h-5 w-5 text-amber-600" /> :
                 <ShieldCheck className="h-5 w-5 text-emerald-600" />}
              </div>
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{item.title || item.contentType}</span>
                  <Badge variant="outline" className="text-[10px]">{item.contentType}</Badge>
                  {item.violations.map((v: string, i: number) => (
                    <Badge key={i} className={`text-[9px] ${VIOLATION_LABELS[v]?.color || "bg-slate-500"}`}>
                      {VIOLATION_LABELS[v]?.label || v}
                    </Badge>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
                  {item.content?.slice(0, 100)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {item.authorName || item.authorId} • {formatDateTime(item.createdAt)} • Score: {item.autoScore.toFixed(2)}
                </div>
              </div>
              <Badge className={`text-[10px] ${STATUS_LABELS[item.autoStatus]?.color}`}>
                {STATUS_LABELS[item.autoStatus]?.label || item.autoStatus}
              </Badge>
            </Card>
          ))
        )}
      </div>

      {/* Диалог просмотра */}
      {selectedItem && (
        <Dialog open onOpenChange={(o) => !o && setSelectedItem(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Модерация контента
              </DialogTitle>
              <DialogDescription>
                {selectedItem.contentType} • {formatDateTime(selectedItem.createdAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div>
                <Label className="text-xs">Автор</Label>
                <div className="text-sm">{selectedItem.authorName || selectedItem.authorId}</div>
              </div>

              {selectedItem.title && (
                <div>
                  <Label className="text-xs">Заголовок</Label>
                  <div className="text-sm font-medium">{selectedItem.title}</div>
                </div>
              )}

              <div>
                <Label className="text-xs">Содержимое</Label>
                <div className="border rounded p-3 text-sm whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                  {selectedItem.content}
                </div>
              </div>

              <div>
                <Label className="text-xs">Результат автоматической проверки</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={STATUS_LABELS[selectedItem.autoStatus]?.color}>
                    {STATUS_LABELS[selectedItem.autoStatus]?.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">Score: {selectedItem.autoScore.toFixed(2)}</span>
                  {selectedItem.violations.map((v: string, i: number) => (
                    <Badge key={i} className={`text-[9px] ${VIOLATION_LABELS[v]?.color}`}>
                      {VIOLATION_LABELS[v]?.label || v}
                    </Badge>
                  ))}
                </div>
                {selectedItem.autoReason && (
                  <div className="text-xs text-muted-foreground mt-1 p-2 bg-muted rounded">
                    {selectedItem.autoReason}
                  </div>
                )}
              </div>

              {selectedItem.images && selectedItem.images.length > 0 && (
                <div>
                  <Label className="text-xs">Изображения</Label>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {selectedItem.images.map((img: string, i: number) => (
                      <img key={i} src={img} alt="" className="w-20 h-20 rounded object-cover" loading="lazy" />
                    ))}
                  </div>
                </div>
              )}

              {selectedItem.reports && selectedItem.reports.length > 0 && (
                <div>
                  <Label className="text-xs">Жалобы ({selectedItem.reports.length})</Label>
                  <div className="space-y-1 mt-1">
                    {selectedItem.reports.map((r: any) => (
                      <div key={r.id} className="text-xs p-2 border rounded">
                        <strong>{r.reporterName}</strong>: {r.reason}
                        <span className="text-muted-foreground ml-2">{formatDateTime(r.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Действия модератора */}
              {selectedItem.manualStatus === "pending" && (
                <div className="flex gap-2 pt-3 border-t">
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => handleAction(selectedItem.id, "approved")}
                  >
                    <Check className="h-4 w-4 mr-1" /> Одобрить
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleAction(selectedItem.id, "rejected", "Нарушение правил платформы")}
                  >
                    <X className="h-4 w-4 mr-1" /> Отклонить
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAction(selectedItem.id, "escalated")}
                  >
                    <AlertTriangle className="h-4 w-4 mr-1" /> Эскалировать
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// =================== Moderation Rules Panel ===================
function ModerationRulesPanel() {
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/moderation/rules");
      if (res.ok) {
        const d = await res.json();
        setRules(d.rules || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const handleToggle = async (id: string, isActive: boolean) => {
    await fetch(`/api/moderation/rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    loadRules();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить правило?")) return;
    await fetch(`/api/moderation/rules/${id}`, { method: "DELETE" });
    toast.success("Правило удалено");
    loadRules();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Правила автоматической модерации. Каждое правило проверяет контент на совпадение.
        </p>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" /> Добавить правило
        </Button>
      </div>

      <div className="space-y-2">
        {loading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Загрузка...</Card>
        ) : rules.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Правил нет. Создайте первое правило.
          </Card>
        ) : (
          rules.map((rule) => (
            <Card key={rule.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{rule.name}</span>
                    <Badge variant="outline" className="text-[10px]">{rule.ruleType}</Badge>
                    <Badge className={`text-[9px] ${VIOLATION_LABELS[rule.violation]?.color || "bg-slate-500"}`}>
                      {VIOLATION_LABELS[rule.violation]?.label || rule.violation}
                    </Badge>
                    <Badge variant={rule.action === "reject" ? "destructive" : rule.action === "flag" ? "default" : "secondary"} className="text-[9px]">
                      {rule.action === "reject" ? "Отклонить" : rule.action === "flag" ? "Пометить" : "Предупредить"}
                    </Badge>
                    <Badge variant={rule.isActive ? "default" : "secondary"} className="text-[9px]">
                      {rule.isActive ? "Активно" : "Отключено"}
                    </Badge>
                  </div>
                  {rule.description && (
                    <div className="text-xs text-muted-foreground mt-1">{rule.description}</div>
                  )}
                  <div className="text-xs font-mono mt-1 p-2 bg-muted rounded">
                    {rule.pattern}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Срабатываний: {rule.hitsCount} • {formatDateTime(rule.createdAt)}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleToggle(rule.id, rule.isActive)}
                  >
                    {rule.isActive ? "Отключить" : "Включить"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => handleDelete(rule.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {showCreate && (
        <CreateRuleDialog onClose={() => setShowCreate(false)} onCreated={loadRules} />
      )}
    </div>
  );
}

function CreateRuleDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    ruleType: "keywords",
    pattern: "",
    violation: "spam",
    action: "flag",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/moderation/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast.success("Правило создано");
        onCreated();
        onClose();
      }
    } catch {
      toast.error("Ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новое правило модерации</DialogTitle>
          <DialogDescription>
            Правило будет автоматически проверять весь новый контент
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Название</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Описание</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Тип правила</Label>
              <Select value={form.ruleType} onValueChange={(v) => setForm({ ...form, ruleType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keywords">Ключевые слова (через запятую)</SelectItem>
                  <SelectItem value="regex">Регулярное выражение</SelectItem>
                  <SelectItem value="url_pattern">Паттерн URL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Категория</Label>
              <Select value={form.violation} onValueChange={(v) => setForm({ ...form, violation: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(VIOLATION_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Действие</Label>
            <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="reject">Отклонить автоматически</SelectItem>
                <SelectItem value="flag">Пометить для проверки</SelectItem>
                <SelectItem value="warn">Предупредить (опубликовать)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Шаблон (слова через запятую или regex)</Label>
            <Textarea
              value={form.pattern}
              onChange={(e) => setForm({ ...form, pattern: e.target.value })}
              rows={3}
              placeholder="нарко, спам, мошенничество"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Создание..." : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================== Reports Panel ===================
function ReportsPanel() {
  return (
    <Card className="p-8 text-center text-sm text-muted-foreground">
      <FileWarning className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
      Жалобы пользователей отображаются в очереди модерации.
      <br />
      Каждая жалоба создаёт запись в ModerationQueue с типом нарушения.
    </Card>
  );
}
