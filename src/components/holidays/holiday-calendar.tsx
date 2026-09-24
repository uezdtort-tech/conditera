"use client";

/**
 * HolidayCalendar — календарь праздников с напоминаниями.
 *
 * Показывает:
 *   - Ближайшие праздники (системные + личные)
 *   - Форма добавления личного праздника
 *   - Список пользовательских праздников
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Calendar, Plus, Trash2, Gift, Bell, Clock,
} from "lucide-react";
import { toast } from "sonner";

const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

interface Holiday {
  id: string;
  name: string;
  month: number;
  day: number;
  type: string;
  daysUntil: number;
  remindDaysBefore?: number;
  preferredCategory?: string;
}

export function HolidayCalendar() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [remindDays, setRemindDays] = useState("7");

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/holidays");
      if (res.ok) {
        const data = await res.json();
        // API returns { system: [...], user: [...] } — merge and calculate daysUntil
        const now = new Date();
        const currentYear = now.getFullYear();
        const systemHolidays = (data.system || []).map((h: { name: string; month: number; day: number; category: string }) => {
          const targetDate = new Date(currentYear, h.month - 1, h.day);
          // If the date has passed this year, use next year
          if (targetDate < now) {
            targetDate.setFullYear(currentYear + 1);
          }
          const daysUntil = Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          return {
            id: `sys_${h.month}_${h.day}`,
            name: h.name,
            month: h.month,
            day: h.day,
            type: "system" as const,
            daysUntil,
          };
        });
        const userHolidays = (data.user || []).map((h: { id: string; name: string; month: number; day: number; remind_days_before: number }) => {
          const targetDate = new Date(currentYear, h.month - 1, h.day);
          if (targetDate < now) {
            targetDate.setFullYear(currentYear + 1);
          }
          const daysUntil = Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          return {
            id: h.id,
            name: h.name,
            month: h.month,
            day: h.day,
            type: "personal" as const,
            daysUntil,
          };
        });
        const allHolidays = [...systemHolidays, ...userHolidays]
          .sort((a: Holiday, b: Holiday) => a.daysUntil - b.daysUntil);
        setHolidays(allHolidays);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!name || !month || !day) {
      toast.error("Заполните все поля");
      return;
    }
    try {
      const res = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          month: parseInt(month),
          day: parseInt(day),
          remindDaysBefore: parseInt(remindDays),
        }),
      });
      if (res.ok) {
        toast.success("Праздник добавлен! Напомним заранее.");
        setName("");
        setMonth("");
        setDay("");
        setShowForm(false);
        await load();
      }
    } catch {
      toast.error("Ошибка");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/holidays?id=${id}`, { method: "DELETE" });
      setHolidays(holidays.filter((h) => h.id !== id));
      toast.success("Удалено");
    } catch {}
  };

  if (loading) {
    return (
      <Card className="p-4">
        <div className="text-sm text-muted-foreground">Загрузка календаря...</div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-sm">Календарь праздников</h3>
          <Badge variant="outline" className="text-[10px]">{holidays.length}</Badge>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowForm(!showForm)} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" />
          Добавить
        </Button>
      </div>

      {/* Форма добавления */}
      {showForm && (
        <div className="p-3 bg-muted/30 rounded-lg space-y-2">
          <div>
            <Label className="text-xs">Название праздника</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="День рождения мамы"
              className="h-8 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs">Месяц</Label>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full h-8 px-2 border rounded text-sm bg-background"
              >
                <option value="">—</option>
                {MONTHS.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="w-16">
              <Label className="text-xs">День</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="w-20">
              <Label className="text-xs">Напомнить за</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={remindDays}
                onChange={(e) => setRemindDays(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <Button size="sm" onClick={handleAdd} className="w-full">Добавить</Button>
        </div>
      )}

      {/* Список праздников */}
      <div className="space-y-1.5 max-h-60 overflow-y-auto">
        {holidays.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground text-sm">
            <Gift className="h-8 w-8 mx-auto mb-1 opacity-30" />
            Нет праздников. Добавьте — и мы напомним!
          </div>
        ) : (
          holidays.map((h) => (
            <div
              key={h.id}
              className={`flex items-center gap-2 p-2 rounded-lg ${
                h.daysUntil <= 7 ? "bg-amber-50 border border-amber-200" : "bg-muted/20"
              }`}
            >
              <div className="text-center shrink-0 w-10">
                <div className="text-[10px] text-muted-foreground">{MONTHS[h.month - 1]}</div>
                <div className="font-bold text-sm">{h.day}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{h.name}</div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  {h.daysUntil <= 7 ? (
                    <>
                      <Bell className="h-2.5 w-2.5 text-amber-500" />
                      <span className="text-amber-700">через {h.daysUntil} дн!</span>
                    </>
                  ) : (
                    <>
                      <Clock className="h-2.5 w-2.5" />
                      <span>через {h.daysUntil} дн</span>
                    </>
                  )}
                  {h.type === "system" && <Badge variant="outline" className="text-[9px]">системный</Badge>}
                </div>
              </div>
              {h.type === "personal" && (
                <button
                  onClick={() => handleDelete(h.id)}
                  className="text-muted-foreground hover:text-red-500 p-1"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
