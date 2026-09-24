"use client";

/**
 * AvailabilityCalendar — календарь доступности (раздел 62).
 *
 * Показывает занятость кондитера по дням.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BookedDate {
  date: string;
  status: "booked" | "limited" | "available";
  orderCount?: number;
}

interface AvailabilityCalendarProps {
  bookedDates?: BookedDate[];
  onSelectDate?: (date: string) => void;
  selectedDate?: string;
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function AvailabilityCalendar({ bookedDates = [], onSelectDate, selectedDate }: AvailabilityCalendarProps): React.JSX.Element {
  const [currentMonth, setCurrentMonth] = React.useState(new Date());

  const bookedMap = React.useMemo(() => {
    const map = new Map<string, BookedDate>();
    bookedDates.forEach((d) => map.set(d.date, d));
    return map;
  }, [bookedDates]);

  const days = React.useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const totalDays = lastDay.getDate();
    const result: Array<{ day: number | null; dateStr: string | null }> = [];
    for (let i = 0; i < startOffset; i++) result.push({ day: null, dateStr: null });
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      result.push({ day: d, dateStr });
    }
    return result;
  }, [currentMonth]);

  const getStatus = (dateStr: string | null): BookedDate["status"] | "none" => {
    if (!dateStr) return "none";
    return bookedMap.get(dateStr)?.status || "available";
  };

  const statusColors: Record<string, string> = {
    available: "bg-success/10 hover:bg-success/20 text-foreground",
    limited: "bg-warning/10 hover:bg-warning/20 text-foreground",
    booked: "bg-destructive/10 text-muted-foreground line-through cursor-not-allowed",
    none: "",
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-medium">{MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground mb-1">
        {DAYS.map((d) => <div key={d}>{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const status = getStatus(d.dateStr);
          if (!d.day) return <div key={i} />;
          return (
            <button
              key={i}
              disabled={status === "booked"}
              onClick={() => d.dateStr && onSelectDate?.(d.dateStr)}
              className={`aspect-square rounded text-xs flex items-center justify-center transition-colors ${
                status !== "none" ? statusColors[status] : statusColors.available
              } ${selectedDate === d.dateStr ? "ring-2 ring-primary" : ""}`}
            >
              {d.day}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-success/30" />Свободно</span>
        <span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-warning/30" />Ограничено</span>
        <span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-destructive/30" />Занято</span>
      </div>
    </Card>
  );
}
