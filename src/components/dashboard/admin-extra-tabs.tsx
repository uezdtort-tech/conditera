"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ShieldCheck, Check, X, Eye, AlertCircle, Clock, DollarSign, TrendingUp,
  Users, Store, FileText, MessageSquare, Bell, Send, Settings, Activity,
  Cpu, Server, Database, Zap, AlertTriangle, Mail, Megaphone, Plus, Edit,
  Trash2, Download, Filter, Search, Star, Ban, UserCheck, UserX, Wallet,
  Percent, Gift, RefreshCw, CheckCircle2, XCircle, Phone, Mail as MailIcon,
  Calendar, ChevronRight, ExternalLink,
} from "lucide-react";
import { formatCurrency, formatDate, ORDER_STATUS_LABELS } from "@/lib/finance";

// ============================================================
// АДМИН: Верификация кондитеров
// ============================================================
export function AdminVerificationsTab() {
  const [filter, setFilter] = useState<string>("all");

  const verifications = [
    { id: "v1", name: "Мария Сладкоежка", legalForm: "ИП", inn: "770123456789", city: "Москва", date: "2026-06-29", status: "pending", docs: ["Паспорт РФ", "Свидетельство ИП", "Сертификат Роспотребнадзора", "Договор аренды"] },
    { id: "v2", name: "Дмитрий Шоколатье", legalForm: "ООО", inn: "770987654321", city: "Москва", date: "2026-06-28", status: "pending", docs: ["Устав ООО", "ОГРН", "Договор аренды", "Сертификат ХАССП"] },
    { id: "v3", name: "Екатерина Десерт", legalForm: "Самозанятый", inn: "500345678901", city: "Санкт-Петербург", date: "2026-06-28", status: "pending", docs: ["Паспорт РФ", "Справка НПД"] },
    { id: "v4", name: "Анна Пирожкова", legalForm: "ИП", inn: "780111122233", city: "Казань", date: "2026-06-27", status: "review", docs: ["Паспорт РФ", "Свидетельство ИП"] },
    { id: "v5", name: "Сеть «Сладкий дом»", legalForm: "ООО", inn: "770555666777", city: "Екатеринбург", date: "2026-06-26", status: "approved", docs: ["Полный пакет", "Сертификат ISO 22000"] },
  ];

  const filtered = filter === "all" ? verifications : verifications.filter((v) => v.status === filter);

  const statusInfo: Record<string, { label: string; color: string }> = {
    pending: { label: "Ожидает", color: "bg-amber-100 text-amber-700" },
    review: { label: "На проверке", color: "bg-blue-100 text-blue-700" },
    approved: { label: "Одобрено", color: "bg-emerald-100 text-emerald-700" },
    rejected: { label: "Отклонено", color: "bg-rose-100 text-rose-700" },
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Верификация кондитеров
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Проверка документов и подтверждение статуса кондитеров</p>
        </div>
        <div className="flex gap-1">
          {[
            { id: "all", label: "Все" },
            { id: "pending", label: "Ожидают" },
            { id: "review", label: "На проверке" },
            { id: "approved", label: "Одобрено" },
          ].map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? "default" : "outline"}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Ожидают</div><div className="text-2xl font-bold text-amber-600">3</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">На проверке</div><div className="text-2xl font-bold text-blue-600">1</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Одобрено за месяц</div><div className="text-2xl font-bold text-emerald-600">47</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Отклонено</div><div className="text-2xl font-bold text-rose-600">8</div></Card>
      </div>

      {/* Список заявок */}
      <div className="space-y-3">
        {filtered.map((v) => (
          <Card key={v.id} className="p-4">
            <div className="flex flex-wrap items-start gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent flex items-center justify-center text-primary font-bold shrink-0">
                {v.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{v.name}</span>
                  <Badge variant="outline">{v.legalForm}</Badge>
                  <Badge variant="outline">ИНН: {v.inn}</Badge>
                  <Badge className={statusInfo[v.status].color}>{statusInfo[v.status].label}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                  <span>📍 {v.city}</span>
                  <span>📅 Подано: {formatDate(v.date)}</span>
                </div>
              </div>
              <div className="flex gap-1">
                {v.status === "pending" || v.status === "review" ? (
                  <>
                    <Button size="sm" variant="outline"><Eye className="h-3.5 w-3.5 mr-1" />Документы</Button>
                    <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600"><Check className="h-3.5 w-3.5 mr-1" />Одобрить</Button>
                    <Button size="sm" variant="outline" className="text-rose-600"><X className="h-3.5 w-3.5 mr-1" />Отклонить</Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost"><Eye className="h-3.5 w-3.5 mr-1" />Просмотр</Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-3 border-t border-border/60">
              <span className="text-xs text-muted-foreground self-center mr-1">Документы:</span>
              {v.docs.map((doc) => (
                <Badge key={doc} variant="secondary" className="text-[10px] cursor-pointer hover:bg-accent">
                  <FileText className="h-3 w-3 mr-1" />{doc}
                </Badge>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// АДМИН: Финансы и выплаты
// ============================================================
export function AdminFinanceTab() {
  const [tab, setTab] = useState<"overview" | "payouts" | "transactions" | "commissions">("overview");

  const payouts = [
    { id: "po1", confectioner: "Сладкая мастерская Анны", amount: 47800, status: "pending", date: "2026-06-29", method: "Карта •• 4521" },
    { id: "po2", confectioner: "Кондитерский дом «Ваниль»", amount: 64500, status: "pending", date: "2026-06-29", method: "Карта •• 8819" },
    { id: "po3", confectioner: "Мария Десерт", amount: 32400, status: "processing", date: "2026-06-28", method: "СБП +7 900 ***-44-55" },
    { id: "po4", confectioner: "Шоколатье Дмитрий", amount: 18900, status: "completed", date: "2026-06-27", method: "Карта •• 2233" },
    { id: "po5", confectioner: "Мастерская макарон «Люси»", amount: 56200, status: "completed", date: "2026-06-27", method: "Карта •• 7744" },
    { id: "po6", confectioner: "Сладкая уездная", amount: 12100, status: "rejected", date: "2026-06-26", method: "Карта •• 9988" },
  ];

  const payoutStatus: Record<string, { label: string; color: string }> = {
    pending: { label: "Ожидает", color: "bg-amber-100 text-amber-700" },
    processing: { label: "В обработке", color: "bg-blue-100 text-blue-700" },
    completed: { label: "Выплачено", color: "bg-emerald-100 text-emerald-700" },
    rejected: { label: "Отклонено", color: "bg-rose-100 text-rose-700" },
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          Финансы и выплаты
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Управление выплатами, комиссиями и транзакциями</p>
      </div>

      {/* Вкладки финансов */}
      <div className="flex gap-1 border-b border-border">
        {[
          { id: "overview", label: "Обзор" },
          { id: "payouts", label: "Выплаты кондитерам" },
          { id: "transactions", label: "Транзакции" },
          { id: "commissions", label: "Комиссии" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-1"><DollarSign className="h-5 w-5 text-emerald-500" /><Badge variant="secondary" className="text-[10px]">+18%</Badge></div>
              <div className="text-2xl font-bold">1 247 800 ₽</div>
              <div className="text-xs text-muted-foreground">Выручка за месяц</div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center justify-between mb-1"><Percent className="h-5 w-5 text-primary" /><Badge variant="secondary" className="text-[10px]">8%</Badge></div>
              <div className="text-2xl font-bold text-primary">99 824 ₽</div>
              <div className="text-xs text-muted-foreground">Комиссия платформы</div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center justify-between mb-1"><Wallet className="h-5 w-5 text-amber-500" /><Badge variant="secondary" className="text-[10px]">2</Badge></div>
              <div className="text-2xl font-bold">112 300 ₽</div>
              <div className="text-xs text-muted-foreground">К выплате</div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center justify-between mb-1"><TrendingUp className="h-5 w-5 text-blue-500" /><Badge variant="secondary" className="text-[10px]">3 650 ₽</Badge></div>
              <div className="text-2xl font-bold">3 650 ₽</div>
              <div className="text-xs text-muted-foreground">Средний чек</div>
            </Card>
          </div>

          <Card className="p-4">
            <h3 className="font-semibold mb-3">Доходы и комиссии по неделям</h3>
            <div className="flex items-end gap-2 h-40">
              {[65, 80, 75, 95, 88, 100, 92, 110].map((h, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] font-medium">{[78, 96, 90, 114, 105, 120, 110, 132][i]}K</div>
                  <div className="w-full bg-gradient-to-t from-primary to-accent rounded-t" style={{ height: `${h}%` }} />
                  <span className="text-[10px] text-muted-foreground">Нед. {i + 1}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold mb-3">Распределение по тарифам</h3>
            <div className="space-y-2">
              {[
                { name: "START (15% комиссия)", count: 1842, revenue: 542000, percent: 62 },
                { name: "PROFI (10% комиссия)", count: 824, revenue: 486000, percent: 28 },
                { name: "PREMIUM (5% комиссия)", count: 156, revenue: 219800, percent: 10 },
              ].map((t) => (
                <div key={t.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{t.name}</span>
                    <span className="font-medium">{t.count} кондитеров • {formatCurrency(t.revenue)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${t.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "payouts" && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Запросы на выплату</h3>
            <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600">
              <Check className="h-4 w-4 mr-1" />Выплатить все (2)
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b text-xs text-muted-foreground">
                <th className="py-2">Кондитер</th><th className="py-2 text-right">Сумма</th>
                <th className="py-2">Метод</th><th className="py-2">Дата</th>
                <th className="py-2 text-center">Статус</th><th className="py-2 text-right">Действия</th>
              </tr></thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-accent/30">
                    <td className="py-3 font-medium">{p.confectioner}</td>
                    <td className="py-3 text-right font-bold">{formatCurrency(p.amount)}</td>
                    <td className="py-3 text-xs text-muted-foreground">{p.method}</td>
                    <td className="py-3 text-xs">{formatDate(p.date)}</td>
                    <td className="py-3 text-center"><Badge className={payoutStatus[p.status].color}>{payoutStatus[p.status].label}</Badge></td>
                    <td className="py-3 text-right">
                      {p.status === "pending" && (
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 h-7"><Check className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" className="h-7 text-rose-600"><X className="h-3 w-3" /></Button>
                        </div>
                      )}
                      {p.status === "processing" && <Badge variant="outline">В обработке</Badge>}
                      {p.status === "completed" && <span className="text-xs text-emerald-600">Готово</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "transactions" && (
        <Card className="p-6 text-center">
          <Activity className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <h3 className="font-semibold">Журнал транзакций</h3>
          <p className="text-sm text-muted-foreground mt-1">Полный лог всех транзакций с фильтрами</p>
          <Button className="mt-3">Открыть журнал</Button>
        </Card>
      )}

      {tab === "commissions" && (
        <Card className="p-4 space-y-3">
          <h3 className="font-semibold">Настройка комиссий по тарифам</h3>
          {[
            { name: "START", current: 15, recommended: 15 },
            { name: "PROFI", current: 10, recommended: 10 },
            { name: "PREMIUM", current: 5, recommended: 5 },
          ].map((t) => (
            <div key={t.name} className="flex items-center gap-3 p-3 rounded-lg border border-border">
              <div className="flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">Рекомендовано: {t.recommended}%</div>
              </div>
              <Input type="number" defaultValue={t.current} className="w-20" />
              <span className="text-sm">%</span>
              <Button size="sm">Сохранить</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ============================================================
// АДМИН: Промокоды и акции
// ============================================================
export function AdminPromocodesTab() {
  const [showNew, setShowNew] = useState(false);

  const promocodes = [
    { id: "pc1", code: "SWEET20", type: "percent", value: 20, uses: 1247, limit: 5000, expires: "2026-07-31", active: true, revenue: 312400 },
    { id: "pc2", code: "FREESHIP", type: "shipping", value: 0, uses: 856, limit: 1000, expires: "2026-07-15", active: true, revenue: 0 },
    { id: "pc3", code: "WELCOME500", type: "fixed", value: 500, uses: 423, limit: 1000, expires: "2026-12-31", active: true, revenue: 0 },
    { id: "pc4", code: "SUMMER15", type: "percent", value: 15, uses: 1893, limit: 2000, expires: "2026-08-31", active: true, revenue: 412800 },
    { id: "pc5", code: "BIRTHDAY1000", type: "fixed", value: 1000, uses: 67, limit: 100, expires: "2026-06-30", active: false, revenue: 89000 },
    { id: "pc6", code: "B2B10", type: "percent", value: 10, uses: 124, limit: 500, expires: "2026-12-31", active: true, revenue: 84600 },
  ];

  const typeInfo: Record<string, string> = {
    percent: "Скидка %",
    fixed: "Фикс. сумма",
    shipping: "Бесплатная доставка",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            Промокоды и акции
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Управление скидками и промокодами</p>
        </div>
        <Button onClick={() => setShowNew(!showNew)}>
          <Plus className="h-4 w-4 mr-1" />Создать промокод
        </Button>
      </div>

      {showNew && (
        <Card className="p-4 space-y-3 border-2 border-primary/30">
          <h3 className="font-semibold">Новый промокод</h3>
          <div className="grid md:grid-cols-3 gap-3">
            <div><Label>Код</Label><Input placeholder="Например: AUTUMN25" /></div>
            <div>
              <Label>Тип скидки</Label>
              <select className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm">
                <option value="percent">Процент</option>
                <option value="fixed">Фиксированная сумма</option>
                <option value="shipping">Бесплатная доставка</option>
              </select>
            </div>
            <div><Label>Значение</Label><Input type="number" placeholder="25" /></div>
            <div><Label>Лимит использований</Label><Input type="number" placeholder="1000" /></div>
            <div><Label>Действует до</Label><Input type="date" /></div>
            <div><Label>Минимальный заказ, ₽</Label><Input type="number" placeholder="0" /></div>
          </div>
          <div className="flex gap-2">
            <Button>Создать</Button>
            <Button variant="outline" onClick={() => setShowNew(false)}>Отмена</Button>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b text-xs text-muted-foreground">
              <th className="py-2">Код</th><th className="py-2">Тип</th><th className="py-2 text-right">Значение</th>
              <th className="py-2 text-center">Использовано</th><th className="py-2">Действует до</th>
              <th className="py-2 text-right">Принёс дохода</th><th className="py-2 text-center">Статус</th><th className="py-2"></th>
            </tr></thead>
            <tbody>
              {promocodes.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="py-3"><code className="font-mono font-bold text-primary bg-primary/5 px-2 py-0.5 rounded">{p.code}</code></td>
                  <td className="py-3 text-xs">{typeInfo[p.type]}</td>
                  <td className="py-3 text-right font-medium">{p.type === "percent" ? `${p.value}%` : p.type === "fixed" ? `${p.value} ₽` : "—"}</td>
                  <td className="py-3 text-center">
                    <div className="text-sm font-medium">{p.uses} / {p.limit}</div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden mt-1 w-20 mx-auto">
                      <div className="h-full bg-primary" style={{ width: `${(p.uses / p.limit) * 100}%` }} />
                    </div>
                  </td>
                  <td className="py-3 text-xs">{formatDate(p.expires)}</td>
                  <td className="py-3 text-right font-medium text-emerald-600">{p.revenue > 0 ? formatCurrency(p.revenue) : "—"}</td>
                  <td className="py-3 text-center">
                    <Badge variant={p.active ? "default" : "secondary"}>{p.active ? "Активен" : "Выключен"}</Badge>
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="h-8 w-8"><Edit className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// АДМИН: Тикеты поддержки
// ============================================================
export function AdminTicketsTab() {
  const [filter, setFilter] = useState("all");

  const tickets = [
    { id: "T-1024", topic: "Не пришёл заказ", customer: "Анна К.", priority: "high", status: "open", time: "5 мин", messages: 4 },
    { id: "T-1023", topic: "Возврат средств по заказу UK-102234", customer: "Михаил В.", priority: "high", status: "open", time: "30 мин", messages: 7 },
    { id: "T-1022", topic: "Вопрос по доставке в регионы", customer: "Ольга М.", priority: "medium", status: "open", time: "1ч", messages: 2 },
    { id: "T-1021", topic: "Промокод не сработал", customer: "Игорь П.", priority: "low", status: "resolved", time: "2ч", messages: 3 },
    { id: "T-1020", topic: "Конфликт с кондитером", customer: "Светлана К.", priority: "high", status: "escalated", time: "3ч", messages: 12 },
    { id: "T-1019", topic: "Изменить состав заказа", customer: "Дмитрий С.", priority: "medium", status: "resolved", time: "5ч", messages: 5 },
  ];

  const priorityInfo: Record<string, { label: string; color: string }> = {
    high: { label: "Срочно", color: "bg-rose-500 text-white" },
    medium: { label: "Средне", color: "bg-amber-500 text-white" },
    low: { label: "Низкий", color: "bg-blue-500 text-white" },
  };

  const statusInfo: Record<string, { label: string; color: string }> = {
    open: { label: "Открыт", color: "bg-blue-100 text-blue-700" },
    resolved: { label: "Решён", color: "bg-emerald-100 text-emerald-700" },
    escalated: { label: "Эскалирован", color: "bg-rose-100 text-rose-700" },
  };

  const filtered = filter === "all" ? tickets : tickets.filter((t) => t.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Тикеты поддержки
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Обращения пользователей</p>
        </div>
        <div className="flex gap-1">
          {[{ id: "all", l: "Все" }, { id: "open", l: "Открытые" }, { id: "escalated", l: "Эскалированные" }, { id: "resolved", l: "Решённые" }].map((f) => (
            <Button key={f.id} size="sm" variant={filter === f.id ? "default" : "outline"} onClick={() => setFilter(f.id)}>{f.l}</Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Открытых</div><div className="text-2xl font-bold text-blue-600">3</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Эскалированных</div><div className="text-2xl font-bold text-rose-600">1</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Ср. время ответа</div><div className="text-2xl font-bold text-amber-600">14м</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Решено сегодня</div><div className="text-2xl font-bold text-emerald-600">23</div></Card>
      </div>

      <div className="space-y-2">
        {filtered.map((t) => (
          <Card key={t.id} className="p-3 hover:shadow-md transition cursor-pointer">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${priorityInfo[t.priority].color}`}>
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold">{t.id}</span>
                  <span className="text-sm font-medium line-clamp-1">{t.topic}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-3">
                  <span>👤 {t.customer}</span>
                  <span>💬 {t.messages} сообщ.</span>
                  <span>🕐 {t.time} назад</span>
                </div>
              </div>
              <Badge className={priorityInfo[t.priority].color}>{priorityInfo[t.priority].label}</Badge>
              <Badge className={statusInfo[t.status].color}>{statusInfo[t.status].label}</Badge>
              <Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5 mr-1" />Открыть</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// АДМИН: Мониторинг системы
// ============================================================
export function AdminMonitoringTab() {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Мониторинг системы
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Состояние серверов, API и сервисов в реальном времени</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />Обновить
        </Button>
      </div>

      {/* Статус сервисов */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { name: "Web-сервер", icon: Server, status: "operational", value: "99.98%", color: "text-emerald-500" },
          { name: "API", icon: Activity, status: "operational", value: "100%", color: "text-emerald-500" },
          { name: "База данных", icon: Database, status: "operational", value: "99.99%", color: "text-emerald-500" },
          { name: "Redis кэш", icon: Zap, status: "operational", value: "100%", color: "text-emerald-500" },
          { name: "Socket.IO чат", icon: MessageSquare, status: "operational", value: "99.95%", color: "text-emerald-500" },
          { name: "YooKassa", icon: Wallet, status: "operational", value: "100%", color: "text-emerald-500" },
          { name: "Telegram бот", icon: Send, status: "degraded", value: "98.2%", color: "text-amber-500" },
          { name: "SMTP почта", icon: Mail, status: "operational", value: "99.8%", color: "text-emerald-500" },
        ].map((s) => (
          <Card key={s.name} className="p-3">
            <div className="flex items-center justify-between mb-1">
              <s.icon className={`h-5 w-5 ${s.color}`} />
              <span className={`w-2 h-2 rounded-full ${s.status === "operational" ? "bg-emerald-500" : "bg-amber-500"} animate-pulse`} />
            </div>
            <div className="text-sm font-medium">{s.name}</div>
            <div className="text-xs text-muted-foreground">{s.value} uptime</div>
          </Card>
        ))}
      </div>

      {/* Метрики */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />Нагрузка на сервер
          </h3>
          <div className="space-y-3">
            {[
              { name: "CPU", value: 34, color: "bg-emerald-500" },
              { name: "Память (RAM)", value: 62, color: "bg-amber-500" },
              { name: "Диск (SSD)", value: 41, color: "bg-emerald-500" },
              { name: "Сеть", value: 18, color: "bg-emerald-500" },
            ].map((m) => (
              <div key={m.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{m.name}</span>
                  <span className="font-medium">{m.value}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full ${m.color}`} style={{ width: `${m.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />Запросы в секунду
          </h3>
          <div className="flex items-end gap-1 h-32">
            {[40, 55, 48, 62, 58, 70, 65, 78, 72, 85, 80, 92, 88, 100, 95, 110, 105, 98, 90, 85].map((h, i) => (
              <div key={i} className="flex-1 bg-gradient-to-t from-primary to-accent rounded-t" style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="text-xs text-muted-foreground mt-2 text-center">Последние 20 минут • Среднее: 78 req/s</div>
        </Card>
      </div>

      {/* Журнал ошибок */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />Последние ошибки
          </h3>
          <Button size="sm" variant="outline"><Download className="h-3.5 w-3.5 mr-1" />Экспорт логов</Button>
        </div>
        <div className="space-y-1.5 font-mono text-xs">
          {[
            { time: "14:32:18", level: "WARN", msg: "Telegram API rate limit: 429 Too Many Requests", color: "text-amber-600" },
            { time: "14:28:42", level: "ERROR", msg: "YooKassa webhook signature mismatch (order UK-102345)", color: "text-rose-600" },
            { time: "14:15:03", level: "WARN", msg: "Slow query: 1.2s — SELECT * FROM orders WHERE ...", color: "text-amber-600" },
            { time: "13:58:21", level: "INFO", msg: "Cron job 'escrow-release' completed in 2.4s", color: "text-blue-600" },
            { time: "13:42:55", level: "ERROR", msg: "Failed to send email: SMTP timeout (user 1245)", color: "text-rose-600" },
          ].map((log, i) => (
            <div key={i} className="flex gap-2 p-1.5 rounded hover:bg-accent/40">
              <span className="text-muted-foreground">{log.time}</span>
              <span className={`font-bold ${log.color}`}>[{log.level}]</span>
              <span className="flex-1 truncate">{log.msg}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// АДМИН: Рассылки и уведомления
// ============================================================
export function AdminBroadcastTab() {
  const [audience, setAudience] = useState("all");
  const [channel, setChannel] = useState("email");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          Рассылки и уведомления
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Массовые рассылки по пользователям</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Форма рассылки */}
        <Card className="p-4 space-y-3">
          <h3 className="font-semibold">Новая рассылка</h3>

          <div>
            <Label className="mb-1.5 block">Аудитория</Label>
            <select value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm">
              <option value="all">Все пользователи (12 450)</option>
              <option value="customers">Только покупатели (9 870)</option>
              <option value="confectioners">Только кондитеры (2 412)</option>
              <option value="couriers">Только курьеры (142)</option>
              <option value="inactive">Неактивные 30+ дней (1 245)</option>
              <option value="vip">VIP-клиенты (PLATINUM) (87)</option>
            </select>
          </div>

          <div>
            <Label className="mb-1.5 block">Канал доставки</Label>
            <div className="grid grid-cols-3 gap-2">
              {[{ id: "email", l: "📧 Email" }, { id: "telegram", l: "✈️ Telegram" }, { id: "push", l: "🔔 Push" }].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setChannel(c.id)}
                  className={`p-2 rounded-lg border-2 text-sm font-medium transition ${
                    channel === c.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  }`}
                >
                  {c.l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">Тема {channel === "email" ? "письма" : "сообщения"}</Label>
            <Input placeholder="Например: 🎂 Скидка 25% на торты до конца недели!" />
          </div>

          <div>
            <Label className="mb-1.5 block">Текст</Label>
            <Textarea rows={6} placeholder="Здравствуйте, {name}!&#10;&#10;Только до 31 июля — скидка 25% на все торты..." />
            <div className="text-xs text-muted-foreground mt-1">
              Доступные переменные: <code className="bg-muted px-1 rounded">{'{name}'}</code>, <code className="bg-muted px-1 rounded">{'{city}'}</code>, <code className="bg-muted px-1 rounded">{'{bonus}'}</code>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200">
            <input type="checkbox" id="schedule" className="w-4 h-4 accent-primary" />
            <Label htmlFor="schedule" className="text-sm cursor-pointer flex-1">Отложенная отправка</Label>
            <Input type="datetime-local" className="w-44 h-8 text-xs" />
          </div>

          <div className="flex gap-2">
            <Button className="flex-1"><Send className="h-4 w-4 mr-1" />Отправить</Button>
            <Button variant="outline">Предпросмотр</Button>
          </div>
        </Card>

        {/* История рассылок */}
        <Card className="p-4">
          <h3 className="font-semibold mb-3">История рассылок</h3>
          <div className="space-y-2">
            {[
              { topic: "🎂 Скидка 20% на все торты", audience: "Все (12 450)", channel: "email", sent: "2 дня назад", open: 42, click: 8, status: "completed" },
              { topic: "🚚 Бесплатная доставка от 3000₽", audience: "Покупатели (9 870)", channel: "telegram", sent: "5 дней назад", open: 68, click: 12, status: "completed" },
              { topic: "👨‍🍳 Новый тариф PROFI для кондитеров", audience: "Кондитеры (2 412)", channel: "email", sent: "1 неделя назад", open: 54, click: 15, status: "completed" },
              { topic: "🎁 Подарок на день рождения", audience: "VIP (87)", channel: "push", sent: "1 неделя назад", open: 78, click: 24, status: "completed" },
            ].map((b, i) => (
              <div key={i} className="p-3 border border-border rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium line-clamp-1">{b.topic}</span>
                  <Badge variant="secondary" className="text-[10px]">{b.channel}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mb-2">{b.audience} • {b.sent}</div>
                <div className="flex gap-3 text-xs">
                  <span>Открыли: <b className="text-foreground">{b.open}%</b></span>
                  <span>Кликнули: <b className="text-foreground">{b.click}%</b></span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// АДМИН: Жалобы и спорные ситуации
// ============================================================
export function AdminDisputesTab() {
  const disputes = [
    { id: "d1", order: "UK-102345", customer: "Анна К.", confectioner: "Сладкая мастерская", reason: "Торт не соответствует фото", amount: 2800, status: "open", date: "2026-06-29", messages: 8 },
    { id: "d2", order: "UK-102234", customer: "Михаил В.", confectioner: "Кондитерский дом «Ваниль»", reason: "Доставка задержалась на 3 часа", amount: 3500, status: "investigation", date: "2026-06-28", messages: 12 },
    { id: "d3", order: "UK-101876", customer: "Ольга М.", confectioner: "Мастерская макарон", reason: "Часть заказа испорчена", amount: 2100, status: "open", date: "2026-06-28", messages: 5 },
    { id: "d4", order: "UK-101800", customer: "Игорь П.", confectioner: "Шоколатье Дмитрий", reason: "Вкус отличается от заявленного", amount: 5600, status: "resolved", date: "2026-06-27", messages: 14, resolution: "Возврат 50%" },
    { id: "d5", order: "UK-101700", customer: "Светлана К.", confectioner: "Мария Десерт", reason: "Неправильная надпись на торте", amount: 3400, status: "resolved", date: "2026-06-26", messages: 9, resolution: "Полный возврат" },
  ];

  const statusInfo: Record<string, { label: string; color: string }> = {
    open: { label: "Открыт", color: "bg-rose-100 text-rose-700" },
    investigation: { label: "Расследуется", color: "bg-amber-100 text-amber-700" },
    resolved: { label: "Решён", color: "bg-emerald-100 text-emerald-700" },
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-rose-500" />
          Жалобы и споры
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Спорные ситуации между покупателями и кондитерами</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Открытых споров</div><div className="text-2xl font-bold text-rose-600">2</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">На расследовании</div><div className="text-2xl font-bold text-amber-600">1</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Решено за месяц</div><div className="text-2xl font-bold text-emerald-600">18</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Сумма возвратов</div><div className="text-2xl font-bold">14 200 ₽</div></Card>
      </div>

      <div className="space-y-3">
        {disputes.map((d) => (
          <Card key={d.id} className="p-4">
            <div className="flex flex-wrap items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-500 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold">#{d.order}</span>
                  <Badge className={statusInfo[d.status].color}>{statusInfo[d.status].label}</Badge>
                  {d.resolution && <Badge variant="outline" className="text-emerald-600">{d.resolution}</Badge>}
                </div>
                <div className="text-sm font-medium mt-1">{d.reason}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  👤 {d.customer} ↔ 👩‍🍳 {d.confectioner} • 💬 {d.messages} сообщ. • 📅 {formatDate(d.date)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-lg">{formatCurrency(d.amount)}</div>
                {d.status !== "resolved" && (
                  <Button size="sm" className="mt-1"><Eye className="h-3.5 w-3.5 mr-1" />Рассмотреть</Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// АДМИН: Отчёты и экспорт
// ============================================================
export function AdminReportsTab() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Отчёты и экспорт
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Финансовые и аналитические отчёты</p>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {[
          { name: "Финансовый отчёт за месяц", desc: "Выручка, комиссии, выплаты, возвраты", icon: DollarSign, color: "text-emerald-500" },
          { name: "Отчёт по заказам", desc: "Все заказы с детализацией по статусам", icon: ShoppingCart, color: "text-blue-500" },
          { name: "Отчёт по кондитерам", desc: "Топ кондитеров, рейтинги, доходы", icon: Store, color: "text-purple-500" },
          { name: "Налоговый отчёт (НПД)", desc: "Расчёт 4%/6% для самозанятых", icon: FileText, color: "text-amber-500" },
          { name: "Отчёт по промокодам", desc: "Использование, эффективность, ROI", icon: Gift, color: "text-rose-500" },
          { name: "Аудит действий (Action Log)", desc: "Логи всех действий администраторов", icon: Activity, color: "text-indigo-500" },
          { name: "Отчёт по возвратам", desc: "Все возвраты и спорные ситуации", icon: AlertCircle, color: "text-rose-500" },
          { name: "Бухгалтерский отчёт", desc: "Для передачи в бухгалтерию", icon: Wallet, color: "text-emerald-500" },
        ].map((r) => (
          <Card key={r.name} className="p-4 hover:shadow-md transition cursor-pointer group">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10">
                <r.icon className={`h-5 w-5 ${r.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{r.desc}</div>
              </div>
              <div className="flex gap-1">
                <select className="h-8 text-xs rounded-md border border-border bg-card px-2">
                  <option>Excel</option>
                  <option>CSV</option>
                  <option>PDF</option>
                </select>
                <Button size="sm"><Download className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Запланированные отчёты</h3>
        <div className="space-y-2">
          {[
            { name: "Еженедельный финансовый отчёт", schedule: "Каждый понедельник в 9:00", recipients: "finance@conditera.ru", active: true },
            { name: "Ежемесячный налоговый отчёт", schedule: "1-го числа каждого месяца", recipients: "tax@conditera.ru, buh@conditera.ru", active: true },
            { name: "Ежедневный дайджест заказов", schedule: "Каждый день в 23:00", recipients: "admin@conditera.ru", active: false },
          ].map((r, i) => (
            <div key={i} className="flex items-center gap-3 p-3 border border-border rounded-lg">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.schedule} → {r.recipients}</div>
              </div>
              <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Активен" : "Пауза"}</Badge>
              <Button size="icon" variant="ghost" className="h-8 w-8"><Edit className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-3"><Plus className="h-3.5 w-3.5 mr-1" />Запланировать отчёт</Button>
      </Card>
    </div>
  );
}

// Импорт для ShoppingCart из shared
import { ShoppingCart } from "lucide-react";
