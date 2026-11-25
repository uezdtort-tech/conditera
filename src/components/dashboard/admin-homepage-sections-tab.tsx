"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Save, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { csrfFetch } from "@/lib/api-client";

type Section = { section: string; title: string; sort_order: number; is_enabled: boolean };
const DEFAULTS: Section[] = [
  { section: "hero", title: "От редакции", sort_order: 10, is_enabled: true },
  { section: "advantages", title: "Наши преимущества", sort_order: 20, is_enabled: true },
  { section: "steps", title: "Как это работает", sort_order: 30, is_enabled: true },
  { section: "stats", title: "О платформе", sort_order: 40, is_enabled: true },
  { section: "testimonials", title: "Истории клиентов", sort_order: 50, is_enabled: true },
  { section: "cta_confectioner", title: "Для кондитеров", sort_order: 60, is_enabled: true },
];

export function AdminHomepageSectionsTab() {
  const [sections, setSections] = useState<Section[]>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await csrfFetch("/api/cms/sections");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить секции");
      if (Array.isArray(payload.sections) && payload.sections.length === DEFAULTS.length) {
        const map = new Map<string, Section>(payload.sections.map((item: Section) => [item.section, item]));
        const ordered = DEFAULTS.map((item) => map.get(item.section) ?? item)
          .sort((a, b) => a.sort_order - b.sort_order);
        setSections(ordered);
      }
    } catch (error) {
      toast.error("Ошибка загрузки композиции", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (index === 0 || target <= 0 || target >= sections.length) return;
    setSections((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((item, position) => ({ ...item, sort_order: (position + 1) * 10 }));
    });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch("/api/cms/sections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sections: sections.map((item, index) => ({
            ...item,
            sort_order: (index + 1) * 10,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить композицию");
      toast.success("Порядок и видимость секций сохранены");
      await load();
    } catch (error) {
      toast.error("Ошибка сохранения", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Композиция главной страницы</h2>
          <p className="text-sm text-muted-foreground">Управляйте заголовками, видимостью и порядком секций. Hero закреплён первым.</p>
        </div>
        <Button onClick={save} disabled={saving || loading}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Сохранить
        </Button>
      </div>
      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка…</Card>
      ) : (
        <div className="space-y-2">
          {sections.map((section, index) => (
            <Card key={section.section} className="flex flex-wrap items-center gap-3 p-3">
              <div className="w-8 text-center text-sm font-semibold text-muted-foreground">{index + 1}</div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm font-medium">{section.section}</div>
                <Input
                  value={section.title}
                  maxLength={100}
                  aria-label={`Название секции ${section.section}`}
                  onChange={(event) => setSections((current) => current.map((item) => item.section === section.section ? { ...item, title: event.target.value } : item))}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={section.is_enabled} onCheckedChange={(checked) => setSections((current) => current.map((item) => item.section === section.section ? { ...item, is_enabled: checked === true } : item))} />
                {section.is_enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                Показывать
              </label>
              <div className="flex gap-1">
                <Button size="icon" variant="outline" aria-label="Переместить вверх" disabled={index <= 1} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" aria-label="Переместить вниз" disabled={index === 0 || index === sections.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
