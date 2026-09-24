"use client";

/**
 * CRM: Kanban-доска лидов.
 * Drag-and-drop перемещение лидов между стадиями (awareness → decision).
 * Реальная работа с БД через /api/crm/leads.
 */
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  TrendingUp,
  Plus,
  GripVertical,
  Mail,
  Phone,
  Building2,
  DollarSign,
  Search,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/finance";

// Стадии pipeline (kanban columns)
const STAGES = [
  { id: "awareness", label: "Осведомлён", color: "bg-slate-500" },
  { id: "interest", label: "Интерес", color: "bg-blue-500" },
  { id: "consideration", label: "Рассмотрение", color: "bg-amber-500" },
  { id: "intent", label: "Намерение", color: "bg-purple-500" },
  { id: "evaluation", label: "Оценка", color: "bg-orange-500" },
  { id: "decision", label: "Решение", color: "bg-emerald-500" },
] as const;

const STATUS_INFO: Record<string, { label: string; color: string }> = {
  new: { label: "Новый", color: "bg-blue-100 text-blue-700" },
  contacted: { label: "Контакт", color: "bg-amber-100 text-amber-700" },
  qualified: { label: "Квалифиц.", color: "bg-purple-100 text-purple-700" },
  converted: { label: "Конверт.", color: "bg-emerald-100 text-emerald-700" },
  lost: { label: "Потерян", color: "bg-red-100 text-red-700" },
  disqualified: { label: "Дисквал.", color: "bg-slate-100 text-slate-700" },
};

const SOURCE_LABELS: Record<string, string> = {
  website: "Сайт",
  phone: "Звонок",
  email: "Email",
  social_media: "Соцсети",
  referral: "Реферал",
  b2b_inquiry: "B2B запрос",
  event: "Мероприятие",
  advertising: "Реклама",
  other: "Другое",
};

interface Lead {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source: string;
  status: string;
  stage: string;
  need?: string;
  budget?: number;
  assignedTo?: string;
  assignedName?: string;
  score: number;
  customerId?: string;
  createdAt: string;
  contactedAt?: string;
  convertedAt?: string;
}

export function AdminLeadsTab() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/crm/leads?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads || []);
      }
    } catch (err) {
      console.error("Failed to load leads:", err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  // Drag and drop
  const handleDragStart = (lead: Lead) => {
    setDraggedLead(lead);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (stageId: string) => {
    if (!draggedLead || draggedLead.stage === stageId) {
      setDraggedLead(null);
      return;
    }

    // Оптимистичное обновление UI
    setLeads((prev) =>
      prev.map((l) => (l.id === draggedLead.id ? { ...l, stage: stageId } : l))
    );

    try {
      const res = await fetch(`/api/crm/leads/${draggedLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: stageId }),
      });
      if (res.ok) {
        toast.success(`Лид перемещён в «${STAGES.find((s) => s.id === stageId)?.label}»`);
      } else {
        toast.error("Ошибка перемещения");
        loadLeads(); // откатываем
      }
    } catch {
      toast.error("Ошибка перемещения");
      loadLeads();
    } finally {
      setDraggedLead(null);
    }
  };

  // Группировка по стадиям
  const leadsByStage = STAGES.map((stage) => ({
    ...stage,
    leads: leads.filter((l) => l.stage === stage.id),
  }));

  // Статистика
  const stats = {
    total: leads.length,
    new: leads.filter((l) => l.status === "new").length,
    qualified: leads.filter((l) => l.status === "qualified").length,
    converted: leads.filter((l) => l.status === "converted").length,
    potentialValue: leads
      .filter((l) => l.budget && l.status !== "lost" && l.status !== "disqualified")
      .reduce((sum, l) => sum + (l.budget || 0), 0),
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Лиды — Kanban
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Перетаскивайте карточки между стадиями. Реальная работа с БД.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" /> Новый лид
        </Button>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Всего</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Новые</div>
          <div className="text-2xl font-bold text-blue-600">{stats.new}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Квалифицированные</div>
          <div className="text-2xl font-bold text-purple-600">{stats.qualified}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Конвертированные</div>
          <div className="text-2xl font-bold text-emerald-600">{stats.converted}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Потенциал</div>
          <div className="text-2xl font-bold text-amber-700">{formatCurrency(stats.potentialValue)}</div>
        </Card>
      </div>

      {/* Поиск */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по имени, email, телефону, компании..."
          className="pl-9 max-w-md"
        />
      </div>

      {/* Kanban-доска */}
      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Загрузка лидов...
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 overflow-x-auto">
          {leadsByStage.map((column) => (
            <div
              key={column.id}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(column.id)}
              className={`bg-muted/30 rounded-lg p-2 min-h-[400px] ${draggedLead ? "ring-2 ring-primary/40" : ""}`}
            >
              {/* Заголовок колонки */}
              <div className="flex items-center gap-2 mb-2 px-1">
                <div className={`w-2 h-2 rounded-full ${column.color}`} />
                <span className="text-xs font-semibold">{column.label}</span>
                <Badge variant="secondary" className="text-[10px] ml-auto">
                  {column.leads.length}
                </Badge>
              </div>

              {/* Карточки лидов */}
              <div className="space-y-2">
                {column.leads.map((lead) => (
                  <Card
                    key={lead.id}
                    draggable
                    onDragStart={() => handleDragStart(lead)}
                    onClick={() => setEditingLead(lead)}
                    className="p-2 cursor-move hover:shadow-md transition-shadow text-xs"
                  >
                    <div className="flex items-start gap-1">
                      <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{lead.name}</div>
                        {lead.company && (
                          <div className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Building2 className="h-2.5 w-2.5" />{lead.company}
                          </div>
                        )}
                        {lead.email && (
                          <div className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Mail className="h-2.5 w-2.5" />{lead.email}
                          </div>
                        )}
                        {lead.phone && (
                          <div className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Phone className="h-2.5 w-2.5" />{lead.phone}
                          </div>
                        )}
                        {lead.budget && (
                          <div className="text-[10px] font-medium text-emerald-700 flex items-center gap-0.5 mt-0.5">
                            <DollarSign className="h-2.5 w-2.5" />{formatCurrency(lead.budget)}
                          </div>
                        )}
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          <Badge
                            variant="outline"
                            className={`text-[9px] ${STATUS_INFO[lead.status]?.color}`}
                          >
                            {STATUS_INFO[lead.status]?.label}
                          </Badge>
                          <Badge variant="outline" className="text-[9px]">
                            {SOURCE_LABELS[lead.source] || lead.source}
                          </Badge>
                          {lead.score > 0 && (
                            <Badge className="text-[9px] bg-primary/10 text-primary">
                              ★ {lead.score}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-1">
                          {formatDate(lead.createdAt)}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
                {column.leads.length === 0 && (
                  <div className="text-center text-[10px] text-muted-foreground py-4">
                    Пусто
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Диалог редактирования лида */}
      {editingLead && (
        <LeadEditDialog
          lead={editingLead}
          onClose={() => setEditingLead(null)}
          onUpdate={loadLeads}
        />
      )}

      {/* Создание лида */}
      {showCreate && (
        <CreateLeadDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadLeads();
          }}
        />
      )}
    </div>
  );
}

// =================== Lead Edit Dialog ===================
function LeadEditDialog({
  lead,
  onClose,
  onUpdate,
}: {
  lead: Lead;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [form, setForm] = useState(lead);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          company: form.company || undefined,
          status: form.status,
          stage: form.stage,
          need: form.need || undefined,
          budget: form.budget || undefined,
          score: form.score,
          assignedName: form.assignedName || undefined,
        }),
      });
      if (res.ok) {
        toast.success("Лид обновлён");
        onUpdate();
        onClose();
      }
    } catch {
      toast.error("Ошибка обновления");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Удалить лид «${lead.name}»?`)) return;
    try {
      const res = await fetch(`/api/crm/leads/${lead.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Лид удалён");
        onUpdate();
        onClose();
      }
    } catch {
      toast.error("Ошибка удаления");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Редактирование лида</DialogTitle>
          <DialogDescription>
            Создан {formatDate(lead.createdAt)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Имя</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Email</Label>
              <Input value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>Телефон</Label>
              <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Компания</Label>
            <Input value={form.company || ""} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Статус</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_INFO).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Стадия</Label>
              <Select value={form.stage} onValueChange={(v) => setForm({ ...form, stage: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Бюджет, ₽</Label>
              <Input
                type="number"
                value={form.budget || ""}
                onChange={(e) => setForm({ ...form, budget: e.target.value ? Number(e.target.value) : undefined })}
              />
            </div>
            <div>
              <Label>Score (0-100)</Label>
              <Input
                type="number"
                value={form.score}
                onChange={(e) => setForm({ ...form, score: Number(e.target.value) })}
              />
            </div>
          </div>
          <div>
            <Label>Потребность</Label>
            <Textarea
              value={form.need || ""}
              onChange={(e) => setForm({ ...form, need: e.target.value })}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />Удалить
          </Button>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Сохранение..." : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================== Create Lead Dialog ===================
function CreateLeadDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    source: "website",
    need: "",
    budget: "",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Введите имя");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          email: form.email || undefined,
          phone: form.phone || undefined,
          company: form.company || undefined,
          need: form.need || undefined,
          budget: form.budget ? Number(form.budget) : undefined,
        }),
      });
      if (res.ok) {
        toast.success("Лид создан");
        onCreated();
      }
    } catch {
      toast.error("Ошибка создания");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новый лид</DialogTitle>
          <DialogDescription>Ручное добавление лида в CRM</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Имя *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Email</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>Телефон</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Компания</Label>
            <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </div>
          <div>
            <Label>Источник</Label>
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Бюджет, ₽</Label>
            <Input
              type="number"
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
            />
          </div>
          <div>
            <Label>Потребность</Label>
            <Textarea
              value={form.need}
              onChange={(e) => setForm({ ...form, need: e.target.value })}
              rows={3}
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
