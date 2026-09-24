"use client";

import { useState, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Shield, ShieldAlert, ShieldCheck, Flag, AlertTriangle, Eye, Check,
  X, Clock, Search, Filter, UserX, Ban, Zap, TrendingUp, TrendingDown,
  AlertCircle, FileText, ChevronRight, Users,
} from "lucide-react";
import { formatDate } from "@/lib/finance";
import { toast } from "sonner";
import type { ReportType, ReportStatus } from "@/lib/types";

const REPORT_TYPES: { value: ReportType; label: string; color: string }[] = [
  { value: "fraud", label: "Мошенничество", color: "bg-rose-500 text-white" },
  { value: "scam", label: "Обман", color: "bg-rose-400 text-white" },
  { value: "fake_product", label: "Несоответствие товара", color: "bg-amber-500 text-white" },
  { value: "non_delivery", label: "Не доставил", color: "bg-orange-500 text-white" },
  { value: "non_payment", label: "Не оплатил", color: "bg-orange-400 text-white" },
  { value: "spam", label: "Спам", color: "bg-blue-400 text-white" },
  { value: "abuse", label: "Оскорбления", color: "bg-purple-400 text-white" },
  { value: "threats", label: "Угрозы", color: "bg-rose-600 text-white" },
  { value: "fake_reviews", label: "Накрутка отзывов", color: "bg-amber-400 text-white" },
  { value: "duplicate", label: "Дубль-аккаунт", color: "bg-indigo-400 text-white" },
  { value: "suspicious", label: "Подозрительная активность", color: "bg-yellow-500 text-white" },
  { value: "copyright", label: "Авторские права", color: "bg-teal-500 text-white" },
  { value: "other", label: "Другое", color: "bg-slate-400 text-white" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  new: { label: "Новая", color: "bg-blue-100 text-blue-700", icon: Clock },
  reviewing: { label: "На рассмотрении", color: "bg-amber-100 text-amber-700", icon: Eye },
  resolved: { label: "Решена", color: "bg-emerald-100 text-emerald-700", icon: Check },
  rejected: { label: "Отклонена", color: "bg-slate-100 text-slate-700", icon: X },
  escalated: { label: "Эскалирована", color: "bg-rose-100 text-rose-700", icon: AlertTriangle },
};

const URGENCY_CONFIG: Record<string, { label: string; color: string }> = {
  low: { label: "Низкая", color: "bg-slate-100 text-slate-600" },
  medium: { label: "Средняя", color: "bg-amber-100 text-amber-700" },
  high: { label: "Высокая", color: "bg-orange-100 text-orange-700" },
  critical: { label: "Критическая", color: "bg-rose-500 text-white" },
};

const RISK_COLORS = {
  low: "text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30",
  medium: "text-amber-500 bg-amber-100 dark:bg-amber-900/30",
  high: "text-orange-500 bg-orange-100 dark:bg-orange-900/30",
  critical: "text-rose-500 bg-rose-100 dark:bg-rose-900/30",
};

export function AdminAntifraudTab() {
  const fraudReports = useAppStore((s) => s.fraudReports);
  const riskScores = useAppStore((s) => s.riskScores);
  const fraudRules = useAppStore((s) => s.fraudRules);
  const resolveReport = useAppStore((s) => s.resolveFraudReport);
  const assignReport = useAppStore((s) => s.assignFraudReport);
  const toggleRule = useAppStore((s) => s.toggleFraudRule);
  const calculateRisk = useAppStore((s) => s.calculateRiskScore);
  const blacklist = useAppStore((s) => s.blacklist);

  const [tab, setTab] = useState<"reports" | "rules" | "risk">("reports");
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");

  const filteredReports = fraudReports.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return r?.targetName || "".toLowerCase().includes(q) || r?.reporterName || "".toLowerCase().includes(q) || r?.description || "".toLowerCase().includes(q);
    }
    return true;
  });

  const newCount = fraudReports.filter((r) => r.status === "new").length;
  const reviewingCount = fraudReports.filter((r) => r.status === "reviewing").length;
  const highRiskCount = Object.values(riskScores).filter((r) => r >= 75).length;
  const autoBlockedCount = Object.values(riskScores).filter((r) => r >= 90).length;
  const activeRules = fraudRules.filter((r) => r.enabled).length;
  const totalTriggers = fraudRules.reduce((s, r) => s + (r?.triggered ? 1 : 0), 0);

  const handleResolve = (id: string, resolution: string) => {
    resolveReport(id, resolution);
    toast.success(resolution === "resolved" ? "Жалоба решена" : "Жалоба отклонена");
    setSelectedReport(null);
    setResolutionText("");
    setResolutionNote("");
  };

  const selectedReportData = fraudReports.find((r) => r.id === selectedReport);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-rose-500" />
          Антифрод и безопасность
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Жалобы пользователей, скоринг риска, правила авто-блокировки
        </p>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3 border-l-4 border-l-blue-400">
          <Clock className="h-5 w-5 text-blue-500 mb-1" />
          <div className="text-2xl font-bold">{newCount}</div>
          <div className="text-xs text-muted-foreground">Новых жалоб</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-amber-400">
          <Eye className="h-5 w-5 text-amber-500 mb-1" />
          <div className="text-2xl font-bold">{reviewingCount}</div>
          <div className="text-xs text-muted-foreground">На рассмотрении</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-rose-400">
          <AlertTriangle className="h-5 w-5 text-rose-500 mb-1" />
          <div className="text-2xl font-bold text-rose-600">{highRiskCount}</div>
          <div className="text-xs text-muted-foreground">Высокий риск</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-purple-400">
          <Ban className="h-5 w-5 text-purple-500 mb-1" />
          <div className="text-2xl font-bold">{autoBlockedCount}</div>
          <div className="text-xs text-muted-foreground">Авто-блокировки</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-emerald-400">
          <Zap className="h-5 w-5 text-emerald-500 mb-1" />
          <div className="text-2xl font-bold">{totalTriggers}</div>
          <div className="text-xs text-muted-foreground">Срабатываний правил</div>
        </Card>
      </div>

      {/* Вкладки */}
      <div className="flex gap-1 border-b">
        {[
          { id: "reports", l: "Жалобы", icon: Flag, badge: newCount },
          { id: "rules", l: "Правила", icon: Zap, badge: activeRules },
          { id: "risk", l: "Скоринг", icon: Shield, badge: highRiskCount },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center gap-1.5 ${
              tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.l}
            {t.badge > 0 && <Badge variant="secondary" className="text-[10px] ml-1">{t.badge}</Badge>}
          </button>
        ))}
      </div>

      {/* ===== ЖАЛОБЫ ===== */}
      {tab === "reports" && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени, описанию..." className="pl-9" />
            </div>
            {[
              { id: "all", l: "Все" },
              { id: "new", l: "Новые" },
              { id: "reviewing", l: "На рассмотрении" },
              { id: "resolved", l: "Решённые" },
            ].map((f) => (
              <Button key={f.id} size="sm" variant={filter === f.id ? "default" : "outline"} onClick={() => setFilter(f.id)}>
                {f.l}
              </Button>
            ))}
          </div>

          <div className="space-y-2">
            {filteredReports.map((r) => {
              const typeInfo = REPORT_TYPES.find((t) => t.value === r.type) || REPORT_TYPES[REPORT_TYPES.length - 1];
              const statusInfo = STATUS_CONFIG[r.status] || STATUS_CONFIG["new"] || { label: r.status, color: "bg-slate-100", icon: Clock };
              const urgencyInfo = URGENCY_CONFIG[r?.urgency || ""];
              const StatusIcon = statusInfo.icon;
              return (
                <Card key={r.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${typeInfo.color}`}>
                      <Flag className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-sm">{r?.targetName || ""}</span>
                        <Badge className={typeInfo.color + " text-[10px]"}>{typeInfo.label}</Badge>
                        <Badge className={statusInfo.color + " text-[10px]"}>
                          <StatusIcon className="h-2.5 w-2.5 mr-0.5" />{statusInfo.label}
                        </Badge>
                        <Badge className={urgencyInfo.color + " text-[10px]"}>
                          {urgencyInfo.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{r?.description || ""}</p>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>👤 от: {r?.reporterName || ""}</span>
                        <span>📅 {formatDate(r?.createdAt || r.reportedAt)}</span>
                        {r.assignedTo && <span>👁 назначен: {r.assignedTo}</span>}
                        {(r?.autoFlags || 0) > 0 && (
                          <span className="text-amber-600">⚠ Авто-флаги: {r?.autoFlags || 0}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {r.status === "new" && (
                        <Button size="sm" variant="outline" onClick={() => { assignReport(r.id, "admin"); toast.success("Взято в работу"); }}>
                          <Eye className="h-3.5 w-3.5 mr-1" />Взять
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => { setSelectedReport(r.id); setResolutionText(""); setResolutionNote(""); }}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== ПРАВИЛА ===== */}
      {tab === "rules" && (
        <div className="space-y-3">
          <Card className="p-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900">
            <div className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
              <span>Правила срабатывают автоматически. При достижении скоринга 75+ — авто-блокировка на 30 дней.</span>
            </div>
          </Card>

          <div className="space-y-2">
            {fraudRules.map((rule) => (
              <Card key={rule.id} className="p-3">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    rule.action === "block" ? "bg-rose-100 dark:bg-rose-900/30" :
                    rule.action === "require_verification" ? "bg-amber-100 dark:bg-amber-900/30" :
                    "bg-blue-100 dark:bg-blue-900/30"
                  }`}>
                    {rule.action === "block" ? <Ban className="h-5 w-5 text-rose-500" /> :
                     rule.action === "require_verification" ? <ShieldCheck className="h-5 w-5 text-amber-500" /> :
                     <Flag className="h-5 w-5 text-blue-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-sm">{rule.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {rule.action === "block" ? "Блокировка" : rule.action === "require_verification" ? "Верификация" : "Флаг"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">+{rule.points} pts</Badge>
                      <Badge variant={rule.enabled ? "default" : "secondary"} className="text-[10px]">
                        {rule.enabled ? "Включено" : "Выключено"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">{rule.description}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>⚡ Срабатываний: <b className="text-foreground">{rule.triggered}</b></span>
                      {rule.lastTriggered && <span>🕐 Последнее: {formatDate(rule.lastTriggered)}</span>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={rule.enabled ? "outline" : "default"}
                    onClick={() => { toggleRule(rule.id); toast.success(rule.enabled ? "Правило выключено" : "Правило включено"); }}
                  >
                    {rule.enabled ? <X className="h-3.5 w-3.5 mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                    {rule.enabled ? "Выключить" : "Включить"}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ===== СКОРИНГ ===== */}
      {tab === "risk" && (
        <div className="space-y-3">
          {riskScores.length === 0 ? (
            <Card className="p-8 text-center">
              <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Нет данных о скоринге. Жалобы и правила автоматически формируют скоринг.</p>
            </Card>
          ) : (
            Object.entries(riskScores).map(([userId, score]) => {
              const rs: any = { userId, score, level: score >= 90 ? "critical" : score >= 75 ? "high" : score >= 50 ? "medium" : "low", autoBlocked: score >= 90, factors: [] };
              const userReports = fraudReports.filter((r) => r.targetUserId === userId);
              const userBlacklist = blacklist.filter((b) => b.userId === userId && b.status === "active");
              return (
                <Card key={rs.userId} className="p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${RISK_COLORS[rs.level]}`}>
                      <Shield className="h-6 w-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium">Пользователь: {rs.userId}</span>
                        <Badge className={`${RISK_COLORS[rs.level]} text-[10px]`}>
                          {rs.level === "critical" ? "Критический" : rs.level === "high" ? "Высокий" : rs.level === "medium" ? "Средний" : "Низкий"}
                        </Badge>
                        {rs.autoBlocked && <Badge className="bg-rose-500 text-white text-[10px]"><Ban className="h-2.5 w-2.5 mr-0.5" />Авто-блок</Badge>}
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden max-w-xs">
                          <div
                            className={`h-full transition-all ${
                              rs.level === "critical" ? "bg-rose-500" :
                              rs.level === "high" ? "bg-orange-500" :
                              rs.level === "medium" ? "bg-amber-500" : "bg-emerald-500"
                            }`}
                            style={{ width: `${rs.score}%` }}
                          />
                        </div>
                        <span className="font-bold text-lg">{rs.score}/100</span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => { calculateRisk(rs.userId); toast.success("Скоринг пересчитан"); }}>
                      <TrendingUp className="h-3.5 w-3.5 mr-1" />Пересчитать
                    </Button>
                  </div>

                  {/* Факторы риска */}
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Факторы риска</div>
                    {rs.factors.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/40 text-sm">
                        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                        <span className="flex-1">{f.description}</span>
                        <Badge variant="outline" className="text-[10px]">+{f.points} pts</Badge>
                      </div>
                    ))}
                  </div>

                  {/* Связанные данные */}
                  <div className="grid grid-cols-3 gap-2 mt-3 text-center text-sm">
                    <div className="p-2 rounded-lg bg-muted/40">
                      <div className="text-lg font-bold">{userReports.length}</div>
                      <div className="text-xs text-muted-foreground">Жалоб</div>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/40">
                      <div className="text-lg font-bold">{userBlacklist.length}</div>
                      <div className="text-xs text-muted-foreground">В чёрном списке</div>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/40">
                      <div className="text-lg font-bold">{rs.factors.length}</div>
                      <div className="text-xs text-muted-foreground">Факторов</div>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* ===== ДИАЛОГ РЕШЕНИЯ ===== */}
      <Dialog open={!!selectedReport} onOpenChange={(open) => { if (!open) setSelectedReport(null); }}>
        <DialogContent className="max-w-xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Жалоба: {selectedReportData?.targetName}</DialogTitle>
            <DialogDescription>Рассмотрение жалобы</DialogDescription>
          </DialogHeader>

          {selectedReportData && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <Label>Тип</Label>
                  <Badge className={REPORT_TYPES.find((t) => t.value === selectedReportData.type)?.color + " text-[10px]"}>
                    {REPORT_TYPES.find((t) => t.value === selectedReportData.type)?.label}
                  </Badge>
                </div>
                <div>
                  <Label>Срочность</Label>
                  <Badge className={URGENCY_CONFIG[selectedReportData?.urgency || "medium"].color + " text-[10px]"}>
                    {URGENCY_CONFIG[selectedReportData?.urgency || "medium"].label}
                  </Badge>
                </div>
                <div>
                  <Label>Жалобщик</Label>
                  <div className="text-sm">{selectedReportData.reporterName}</div>
                </div>
                <div>
                  <Label>Дата</Label>
                  <div className="text-sm">{formatDate(selectedReportData?.createdAt || selectedReportData.reportedAt)}</div>
                </div>
              </div>

              <div>
                <Label>Описание жалобы</Label>
                <p className="text-sm text-muted-foreground mt-1">{selectedReportData.description}</p>
              </div>

              {(selectedReportData?.autoFlags as any) && (selectedReportData?.autoFlags as any).length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900">
                  <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">⚠ Автоматические флаги:</div>
                  <div className="flex flex-wrap gap-1">
                    {((selectedReportData?.autoFlags as any) || []).map((f: string) => (
                      <Badge key={f} variant="outline" className="text-[10px] text-amber-600 border-amber-300">{f}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <Label>Решение</Label>
                <Textarea
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  rows={3}
                  placeholder="Опишите решение: заблокирован / предупреждение / отклонено..."
                />
              </div>

              <div className="flex gap-2">
                <Button className="flex-1 bg-emerald-500 hover:bg-emerald-600" onClick={() => handleResolve(selectedReportData.id, "resolved")}>
                  <Check className="h-4 w-4 mr-1" />Решить (блок/предупреждение)
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => handleResolve(selectedReportData.id, "rejected")}>
                  <X className="h-4 w-4 mr-1" />Отклонить жалобу
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// КНОПКА «ПОЖАЛОВАТЬСЯ» — для использования в профилях
// ============================================================
export function ReportUserButton({ targetUserId, targetName, targetRole }: {
  targetUserId: string;
  targetName: string;
  targetRole?: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ReportType>("fraud");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<"low" | "medium" | "high" | "critical">("medium");
  const createReport = useAppStore((s) => s.createFraudReport);
  const user = useAppStore((s) => s.user);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { toast.error("Войдите, чтобы подать жалобу"); return; }
    if (!description.trim()) { toast.error("Опишите проблему"); return; }

    createReport({
      reportedBy: user.id,
      reporterName: user.name,
      targetUserId,
      targetName,
      type,
      reason: description.trim(),
      description: description.trim(),
      evidence: [],
      urgency,
    });

    toast.success("Жалоба отправлена. Администрация рассмотрит её в ближайшее время.");
    setOpen(false);
    setDescription("");
    setType("fraud");
    setUrgency("medium");
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20">
        <Flag className="h-3.5 w-3.5 mr-1" />Пожаловаться
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Жалоба на пользователя</DialogTitle>
            <DialogDescription>Подайте жалобу на «{targetName}». Мы рассмотрим её в течение 24 часов.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label>Тип нарушения</Label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ReportType)}
                className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm mt-1"
              >
                {REPORT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>Срочность</Label>
              <div className="grid grid-cols-4 gap-2 mt-1">
                {[
                  { v: "low", l: "Низкая" },
                  { v: "medium", l: "Средняя" },
                  { v: "high", l: "Высокая" },
                  { v: "critical", l: "Критич." },
                ].map((u) => (
                  <button
                    key={u.v}
                    type="button"
                    onClick={() => setUrgency(u.v as any)}
                    className={`p-2 rounded-lg border-2 text-xs font-medium transition ${
                      urgency === u.v ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    {u.l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Описание</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Опишите подробно, что произошло. Укажите дату, номер заказа, сумму..."
                required
              />
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300">
              ⚠️ Ложные жалобы могут привести к блокировке вашего аккаунта. Подавайте только реальные обращения.
            </div>

            <div className="flex gap-2">
              <Button type="submit" className="flex-1">Отправить жалобу</Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
