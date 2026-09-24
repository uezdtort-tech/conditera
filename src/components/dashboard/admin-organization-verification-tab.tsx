"use client";

/**
 * Admin tab: Organization verification history (DaData Party API).
 *
 * Shows all verifications performed (registration, profile updates, invoices, cron).
 * Allows filtering by status (ACTIVE/LIQUIDATED/LIQUIDATING), INN, user.
 * Manual re-check button per row.
 * Stats summary at top.
 */
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
  Clock,
  TrendingUp,
  FileText,
} from "lucide-react";
import { formatDistanceToNow } from "@/lib/utils";

interface Verification {
  id: string;
  userId: string | null;
  confectionerId: string | null;
  inn: string;
  ogrn: string | null;
  kpp: string | null;
  companyName: string;
  fullName: string | null;
  opfShort: string | null;
  status: "ACTIVE" | "LIQUIDATING" | "LIQUIDATED" | "REORGANIZING" | "UNKNOWN";
  managementName: string | null;
  legalAddress: string | null;
  registeredAt: string | null;
  liquidatedAt: string | null;
  trigger:
    | "REGISTRATION"
    | "PROFILE_UPDATE"
    | "INVOICE_ISSUE"
    | "PAYOUT_REQUEST"
    | "CRON_PERIODIC"
    | "ADMIN_MANUAL";
  success: boolean;
  errorMessage: string | null;
  actionTaken: string | null;
  createdAt: string;
  user?: { id: string; name: string; email: string } | null;
  confectioner?: { id: string; businessName: string; city: string } | null;
}

const STATUS_CONFIG: Record<
  Verification["status"],
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  ACTIVE: { label: "Действующая", color: "text-emerald-700 bg-emerald-100 border-emerald-200", icon: CheckCircle2 },
  LIQUIDATING: { label: "В ликвидации", color: "text-amber-700 bg-amber-100 border-amber-200", icon: AlertTriangle },
  LIQUIDATED: { label: "Ликвидирована", color: "text-red-700 bg-red-100 border-red-200", icon: XCircle },
  REORGANIZING: { label: "Реорганизация", color: "text-blue-700 bg-blue-100 border-blue-200", icon: RefreshCw },
  UNKNOWN: { label: "Неизвестно", color: "text-muted-foreground bg-muted", icon: Clock },
};

const TRIGGER_LABELS: Record<Verification["trigger"], string> = {
  REGISTRATION: "Регистрация",
  PROFILE_UPDATE: "Профиль",
  INVOICE_ISSUE: "Счёт",
  PAYOUT_REQUEST: "Выплата",
  CRON_PERIODIC: "Cron (регулярно)",
  ADMIN_MANUAL: "Админ",
};

const ACTION_LABELS: Record<string, string> = {
  approved: "Одобрено",
  blocked: "Заблокировано",
  suspended: "Приостановлено",
  notified: "Уведомление отправлено",
};

export function AdminOrganizationVerificationTab() {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterInn, setFilterInn] = useState("");
  const [filterTrigger, setFilterTrigger] = useState<string>("all");
  const [rechecking, setRechecking] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    liquidated: 0,
    liquidating: 0,
    suspended: 0,
  });

  const loadVerifications = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterInn) params.set("inn", filterInn);
      params.set("limit", "100");

      const resp = await fetch(`/api/organization/history?${params.toString()}`);
      if (!resp.ok) throw new Error("Failed to load");
      const data = await resp.json();
      setVerifications(data.verifications || []);

      // Compute stats
      const all = data.verifications || [];
      setStats({
        total: data.total || all.length,
        active: all.filter((v: Verification) => v.status === "ACTIVE").length,
        liquidated: all.filter((v: Verification) => v.status === "LIQUIDATED").length,
        liquidating: all.filter((v: Verification) => v.status === "LIQUIDATING").length,
        suspended: all.filter((v: Verification) => v.actionTaken === "suspended" || v.actionTaken === "blocked").length,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVerifications();
     
  }, [filterStatus, filterInn]);

  const handleRecheck = async (inn: string) => {
    setRechecking(inn);
    try {
      await fetch("/api/organization/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inn, trigger: "ADMIN_MANUAL" }),
      });
      await loadVerifications();
    } catch (e) {
      console.error(e);
    } finally {
      setRechecking(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold mb-1 flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          Проверка организаций
        </h1>
        <p className="text-sm text-muted-foreground">
          Интеграция с DaData Party API — проверка ИНН/ОГРН в ЕГРЮЛ/ЕГРИП при
          регистрации, выставлении счетов и регулярная перепроверка (cron).
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          icon={FileText}
          label="Всего проверок"
          value={stats.total}
          color="text-primary bg-primary/10"
        />
        <StatCard
          icon={CheckCircle2}
          label="Действующих"
          value={stats.active}
          color="text-emerald-600 bg-emerald-100"
        />
        <StatCard
          icon={XCircle}
          label="Ликвидировано"
          value={stats.liquidated}
          color="text-red-600 bg-red-100"
        />
        <StatCard
          icon={AlertTriangle}
          label="В ликвидации"
          value={stats.liquidating}
          color="text-amber-600 bg-amber-100"
        />
        <StatCard
          icon={ShieldX}
          label="Заблокировано"
          value={stats.suspended}
          color="text-purple-600 bg-purple-100"
        />
      </div>

      {/* DaData status */}
      <Card className="p-3 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-blue-600 flex-shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-medium">
              Интеграция с DaData Party API
            </div>
            <div className="text-xs text-muted-foreground">
              {typeof window !== "undefined" && localStorage.getItem("dadata_key")
                ? "API-ключ настроен ✓"
                : "API-ключ не указан — проверки пропускаются (dev mode). Укажите DADATA_API_KEY в .env"}
            </div>
          </div>
          <a
            href="https://dadata.ru/profile/#info"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            Получить ключ →
          </a>
        </div>
      </Card>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по ИНН..."
              value={filterInn}
              onChange={(e) => setFilterInn(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="ACTIVE">Действующие</SelectItem>
              <SelectItem value="LIQUIDATING">В ликвидации</SelectItem>
              <SelectItem value="LIQUIDATED">Ликвидированные</SelectItem>
              <SelectItem value="REORGANIZING">Реорганизация</SelectItem>
              <SelectItem value="UNKNOWN">Неизвестно</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Verifications list */}
      <Card className="p-4">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            Загрузка...
          </div>
        ) : verifications.length === 0 ? (
          <div className="text-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Пока нет проверок организаций
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Проверки появляются при регистрации юрлиц, выставлении счетов и
              регулярной cron-задаче
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {verifications.map((v) => {
              const config = STATUS_CONFIG[v.status];
              const Icon = config.icon;
              return (
                <div
                  key={v.id}
                  className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">
                          {v.companyName || "(без названия)"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ИНН: {v.inn}
                          {v.ogrn && ` · ОГРН: ${v.ogrn}`}
                          {v.kpp && ` · КПП: ${v.kpp}`}
                          {v.opfShort && ` · ${v.opfShort}`}
                        </div>
                      </div>
                      <Badge className={`text-[10px] ${config.color} border`}>
                        {config.label}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(v.createdAt))}
                      </span>
                      <span>
                        Триггер: <strong>{TRIGGER_LABELS[v.trigger]}</strong>
                      </span>
                      {v.actionTaken && (
                        <span>
                          Действие:{" "}
                          <strong>{ACTION_LABELS[v.actionTaken] || v.actionTaken}</strong>
                        </span>
                      )}
                      {v.user && (
                        <span>
                          Пользователь: <strong>{v.user.name}</strong> ({v.user.email})
                        </span>
                      )}
                      {v.confectioner && (
                        <span>
                          Кондитер: <strong>{v.confectioner.businessName}</strong> ({v.confectioner.city})
                        </span>
                      )}
                    </div>

                    {v.errorMessage && (
                      <div className="text-xs text-red-600 mt-1">
                        {v.errorMessage}
                      </div>
                    )}

                    {v.managementName && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Руководитель: {v.managementName}
                        {v.legalAddress && ` · Адрес: ${v.legalAddress}`}
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRecheck(v.inn)}
                    disabled={rechecking === v.inn}
                  >
                    {rechecking === v.inn ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        Проверить
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Cron info */}
      <Card className="p-3 bg-amber-50 dark:bg-amber-950/30">
        <div className="flex items-start gap-3">
          <TrendingUp className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium">Регулярная перепроверка (cron)</div>
            <div className="text-xs text-muted-foreground mt-1">
              Каждый день проверяются все активные организации, не проверявшиеся
              более 30 дней. Если организация ликвидирована — пользователь
              блокируется, кондитер теряет верификацию, отправляется уведомление.
            </div>
            <div className="mt-2 text-xs font-mono">
              curl -H "X-Cron-Secret: $CRON_SECRET"{" "}
              http://localhost:3000/api/organization/cron-recheck
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Card className="p-3">
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${color}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </Card>
  );
}
