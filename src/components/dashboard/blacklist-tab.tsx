"use client";

import { useAppStore } from "@/lib/store";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Shield,
  ShieldX,
  ShieldAlert,
  Ban,
  Flag,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  User,
  Mail,
  Phone,
  Globe,
  Monitor,
  Building2,
  Plus,
  Search,
  Trash2,
  Unlock,
  MessageSquare,
} from "lucide-react";
import { BLACKLIST_REASONS } from "@/lib/mock-data-corporate";
import { formatDateTime, formatDate } from "@/lib/finance";
import { toast } from "sonner";
import type { BlacklistScope, BlacklistReason, BlacklistEntry } from "@/lib/types";

const SCOPE_INFO: Record<BlacklistScope, { label: string; icon: typeof User }> = {
  user: { label: "Пользователь", icon: User },
  email: { label: "Email", icon: Mail },
  phone: { label: "Телефон", icon: Phone },
  ip: { label: "IP-адрес", icon: Globe },
  device: { label: "Устройство", icon: Monitor },
  company: { label: "Компания (ИНН)", icon: Building2 },
};

export function BlacklistTab() {
  const blacklist = useAppStore((s) => s.blacklist);
  const addToBlacklist = useAppStore((s) => s.addToBlacklist);
  const removeFromBlacklist = useAppStore((s) => s.removeFromBlacklist);
  const appealBlacklist = useAppStore((s) => s.appealBlacklist);

  const [showAdd, setShowAdd] = useState(false);
  const [appealingEntry, setAppealingEntry] = useState<BlacklistEntry | null>(null);
  const [search, setSearch] = useState("");
  const [filterReason, setFilterReason] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const filtered = blacklist.filter((b) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !b.value.toLowerCase().includes(q) &&
        !b.reasonDetails.toLowerCase().includes(q) &&
        !b.blockedBy.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    if (filterReason !== "all" && b.reason !== filterReason) return false;
    if (filterStatus !== "all" && b.status !== filterStatus) return false;
    return true;
  });

  const stats = {
    total: blacklist.length,
    active: blacklist.filter((b) => b.status === "active").length,
    permanent: blacklist.filter((b) => b.isPermanent).length,
    appealed: blacklist.filter((b) => b.status === "appealed").length,
    lifted: blacklist.filter((b) => b.status === "lifted").length,
    highSeverity: blacklist.filter(
      (b) =>
        b.status === "active" &&
        ["fraud", "scam", "extortion", "threats"].includes(b.reason)
    ).length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-red-600" />
            Чёрный список
          </h1>
          <p className="text-sm text-muted-foreground">
            Блокировка мошенников, вымогателей и нарушителей. Семафор проверяет email/телефон при регистрации.
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="bg-red-600 hover:bg-red-700">
          <Plus className="h-4 w-4 mr-1" />
          Добавить в ЧС
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Card className="p-3">
          <Shield className="h-5 w-5 text-slate-600 mb-1" />
          <div className="font-display text-xl font-bold">{stats.total}</div>
          <div className="text-xs text-muted-foreground">всего</div>
        </Card>
        <Card className="p-3">
          <Ban className="h-5 w-5 text-red-600 mb-1" />
          <div className="font-display text-xl font-bold text-red-600">{stats.active}</div>
          <div className="text-xs text-muted-foreground">активных</div>
        </Card>
        <Card className="p-3">
          <AlertTriangle className="h-5 w-5 text-orange-600 mb-1" />
          <div className="font-display text-xl font-bold text-orange-600">{stats.highSeverity}</div>
          <div className="text-xs text-muted-foreground">высокая тяжесть</div>
        </Card>
        <Card className="p-3">
          <Clock className="h-5 w-5 text-amber-600 mb-1" />
          <div className="font-display text-xl font-bold text-amber-600">{stats.permanent}</div>
          <div className="text-xs text-muted-foreground">пожизненно</div>
        </Card>
        <Card className="p-3">
          <MessageSquare className="h-5 w-5 text-blue-600 mb-1" />
          <div className="font-display text-xl font-bold text-blue-600">{stats.appealed}</div>
          <div className="text-xs text-muted-foreground">апелляции</div>
        </Card>
        <Card className="p-3">
          <Unlock className="h-5 w-5 text-emerald-600 mb-1" />
          <div className="font-display text-xl font-bold text-emerald-600">{stats.lifted}</div>
          <div className="text-xs text-muted-foreground">разблокировано</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по email/телефону/причине..."
            className="pl-10"
          />
        </div>
        <Select value={filterReason} onValueChange={setFilterReason}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Причина" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все причины</SelectItem>
            {Object.entries(BLACKLIST_REASONS).map(([key, info]) => (
              <SelectItem key={key} value={key}>
                {info.icon} {info.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="appealed">С апелляцией</SelectItem>
            <SelectItem value="lifted">Разблокированные</SelectItem>
            <SelectItem value="expired">Истёкшие</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.map((entry) => {
          const reasonInfo = BLACKLIST_REASONS[entry.reason];
          const scopeInfo = SCOPE_INFO[entry.scope];
          const ScopeIcon = scopeInfo.icon;
          const isPermanent = entry.isPermanent;
          const isExpired =
            entry.expiresAt && new Date(entry.expiresAt) < new Date();
          const hasPendingAppeal = entry.appeals?.some((a) => a.status === "pending");
          return (
            <Card
              key={entry.id}
              className={`p-4 ${
                entry.status === "active"
                  ? isPermanent
                    ? "border-red-300 bg-red-50/30"
                    : "border-amber-300 bg-amber-50/30"
                  : entry.status === "appealed"
                  ? "border-blue-300 bg-blue-50/30"
                  : "border-emerald-300 bg-emerald-50/30"
              }`}
            >
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Left */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={reasonInfo.color}>
                        {reasonInfo.icon} {reasonInfo.label}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        <ScopeIcon className="h-3 w-3 mr-1" />
                        {scopeInfo.label}
                      </Badge>
                      {entry.status === "active" && (
                        <Badge
                          className={
                            isPermanent
                              ? "bg-red-600 text-white text-[10px]"
                              : "bg-amber-500 text-white text-[10px]"
                          }
                        >
                          {isPermanent ? "ПОЖИЗНЕННО" : "ВРЕМЕННО"}
                        </Badge>
                      )}
                      {entry.status === "appealed" && (
                        <Badge className="bg-blue-500 text-white text-[10px]">
                          <MessageSquare className="h-3 w-3 mr-1" />
                          АПЕЛЛЯЦИЯ
                        </Badge>
                      )}
                      {entry.status === "lifted" && (
                        <Badge className="bg-emerald-500 text-white text-[10px]">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          РАЗБЛОКИРОВАНО
                        </Badge>
                      )}
                      {hasPendingAppeal && (
                        <Badge className="bg-orange-500 text-white text-[10px] animate-pulse">
                          Ожидает апелляцию
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Value */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-muted-foreground">Заблокировано:</span>
                    <code className="text-sm font-mono font-bold bg-muted px-2 py-0.5 rounded">
                      {entry.value}
                    </code>
                  </div>

                  {/* Reason details */}
                  <p className="text-sm text-muted-foreground mb-3 p-2 bg-muted/30 rounded">
                    {entry.reasonDetails}
                  </p>

                  {/* Evidence */}
                  {entry.evidence && entry.evidence.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs text-muted-foreground mb-1">Доказательства:</div>
                      <div className="flex flex-wrap gap-1">
                        {entry.evidence.map((ev, i) => (
                          <Badge key={i} variant="outline" className="text-[10px]">
                            <FileText className="h-3 w-3 mr-1" />
                            {ev}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Appeals */}
                  {entry.appeals && entry.appeals.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs text-muted-foreground mb-1">Апелляции:</div>
                      <div className="space-y-1">
                        {entry.appeals.map((appeal) => (
                          <div
                            key={appeal.id}
                            className="text-xs p-2 border border-border rounded bg-card"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-muted-foreground">
                                {formatDate(appeal.createdAt)}
                              </span>
                              <Badge
                                variant="outline"
                                className={
                                  appeal.status === "pending"
                                    ? "bg-orange-50 text-orange-700 border-orange-200 text-[10px]"
                                    : appeal.status === "approved"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
                                    : "bg-red-50 text-red-700 border-red-200 text-[10px]"
                                }
                              >
                                {appeal.status === "pending"
                                  ? "На рассмотрении"
                                  : appeal.status === "approved"
                                  ? "Одобрена"
                                  : "Отклонена"}
                              </Badge>
                            </div>
                            <p className="text-xs italic">«{appeal.text}»</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Meta */}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>Кто: {entry.blockedBy}</span>
                    <span>•</span>
                    <span>Когда: {formatDate(entry.blockedAt)}</span>
                    {entry.expiresAt && !isPermanent && (
                      <>
                        <span>•</span>
                        <span className={isExpired ? "text-red-600" : ""}>
                          До: {formatDate(entry.expiresAt)}
                          {isExpired ? " (истёк)" : ""}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Right — actions */}
                <div className="sm:w-44 shrink-0 flex flex-col gap-2 sm:border-l sm:pl-3">
                  {entry.status === "active" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs"
                        onClick={() => setAppealingEntry(entry)}
                      >
                        <MessageSquare className="h-3 w-3 mr-1" />
                        Подать апелляцию
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                        onClick={() => {
                          removeFromBlacklist(entry.id);
                          toast.success("Запись разблокирована");
                        }}
                      >
                        <Unlock className="h-3 w-3 mr-1" />
                        Разблокировать
                      </Button>
                    </>
                  )}
                  {hasPendingAppeal && (
                    <Button
                      size="sm"
                      className="w-full text-xs bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => {
                        // Одобрить апелляцию → разблокировать
                        removeFromBlacklist(entry.id);
                        toast.success("Апелляция одобрена — запись разблокирована");
                      }}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Одобрить апелляцию
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card className="p-12 text-center">
          <Shield className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Записей не найдено</h3>
          <p className="text-sm text-muted-foreground">Измените параметры фильтра</p>
        </Card>
      )}

      {/* Add dialog */}
      {showAdd && (
        <AddToBlacklistDialog
          onClose={() => setShowAdd(false)}
          onAdd={(entry) => {
            addToBlacklist(entry);
            toast.success("Добавлено в чёрный список");
            setShowAdd(false);
          }}
        />
      )}

      {/* Appeal dialog */}
      {appealingEntry && (
        <AppealDialog
          entry={appealingEntry}
          onClose={() => setAppealingEntry(null)}
          onSubmit={(text) => {
            appealBlacklist(appealingEntry.id, text);
            toast.success("Апелляция подана", {
              description: "Будет рассмотрена администратором",
            });
            setAppealingEntry(null);
          }}
        />
      )}
    </div>
  );
}

function AddToBlacklistDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (entry: Omit<BlacklistEntry, "id" | "blockedAt">) => void;
}) {
  const [scope, setScope] = useState<BlacklistScope>("email");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<BlacklistReason>("fraud");
  const [reasonDetails, setReasonDetails] = useState("");
  const [isPermanent, setIsPermanent] = useState(true);
  const [expiresAt, setExpiresAt] = useState("");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-red-600" />
            Добавить в чёрный список
          </DialogTitle>
          <DialogDescription>
            После добавления запись будет проверяться при регистрации и входе.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Что блокируем</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as BlacklistScope)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SCOPE_INFO).map(([key, info]) => (
                  <SelectItem key={key} value={key}>
                    {info.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Значение *</Label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={scope === "email" ? "fraud@example.ru" : scope === "phone" ? "+7 999 000-00-00" : scope === "ip" ? "192.168.1.1" : "..."}
            />
          </div>
          <div>
            <Label>Причина</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as BlacklistReason)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(BLACKLIST_REASONS).map(([key, info]) => (
                  <SelectItem key={key} value={key}>
                    {info.icon} {info.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Описание причины *</Label>
            <Textarea
              value={reasonDetails}
              onChange={(e) => setReasonDetails(e.target.value)}
              placeholder="Подробное описание нарушения..."
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isPermanent}
                onChange={(e) => setIsPermanent(e.target.checked)}
              />
              Пожизненная блокировка
            </label>
            {!isPermanent && (
              <div>
                <Label>До какой даты</Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700"
            disabled={!value || !reasonDetails}
            onClick={() =>
              onAdd({
                scope,
                value,
                reason,
                reasonDetails,
                isPermanent,
                expiresAt: !isPermanent ? expiresAt : undefined,
                blockedBy: "admin@demo.ru",
                status: "active",
              })
            }
          >
            <Ban className="h-4 w-4 mr-1" />
            Заблокировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppealDialog({
  entry,
  onClose,
  onSubmit,
}: {
  entry: BlacklistEntry;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-blue-600" />
            Подать апелляцию
          </DialogTitle>
          <DialogDescription>
            Запись: <code className="bg-muted px-1 rounded">{entry.value}</code>
            <br />
            Опишите, почему блокировку следует снять. Приложите доказательства.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Я признаю нарушение, обязуюсь..."
          rows={5}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!text.trim()} onClick={() => onSubmit(text)}>
            Отправить апелляцию
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
