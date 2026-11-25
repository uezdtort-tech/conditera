"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Palette, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { csrfFetch } from "@/lib/api-client";

type Design = {
  id: string;
  theme: string;
  primary_color: string;
  accent_color: string;
  background_color: string;
  text_color: string;
  font_heading: string;
  font_body: string;
  layout_style: string;
  max_width: number;
  animations_enabled: boolean;
};
const DEFAULTS: Omit<Design, "id"> = {
  theme: "default",
  primary_color: "#8B2942",
  accent_color: "#D97706",
  background_color: "#F7F2E8",
  text_color: "#1F2937",
  font_heading: "Brokgauz_amp_Efron-Italic",
  font_body: "Geist",
  layout_style: "classic",
  max_width: 1280,
  animations_enabled: true,
};

export function AdminDesignTab() {
  const [design, setDesign] = useState<Design>({ id: "", ...DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await csrfFetch("/api/cms/design");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить дизайн");
      setDesign(payload.design ? { ...DEFAULTS, ...payload.design } : { id: "", ...DEFAULTS });
    } catch (error) {
      toast.error("Ошибка загрузки дизайна", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = (patch: Partial<Design>) => setDesign((current) => ({ ...current, ...patch }));
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await csrfFetch("/api/cms/design", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: design.theme,
          primaryColor: design.primary_color,
          accentColor: design.accent_color,
          backgroundColor: design.background_color,
          textColor: design.text_color,
          fontHeading: design.font_heading,
          fontBody: design.font_body,
          layoutStyle: design.layout_style,
          maxWidth: design.max_width,
          animationsEnabled: design.animations_enabled,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить дизайн");
      setDesign({ ...DEFAULTS, ...payload.design });
      toast.success("Настройки дизайна сохранены");
    } catch (error) {
      toast.error("Ошибка сохранения", { description: error instanceof Error ? error.message : "Неизвестная ошибка" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка дизайн-системы…</Card>;

  const colors = [
    ["primary_color", "Основной цвет"],
    ["accent_color", "Акцентный цвет"],
    ["background_color", "Фон"],
    ["text_color", "Цвет текста"],
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Palette className="h-5 w-5" />Визуальный стиль сайта</h2>
          <p className="text-sm text-muted-foreground">Настройки применяются ко всему публичному интерфейсу. Произвольный CSS и JavaScript не исполняются.</p>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Сохранить</Button>
      </div>
      <Card className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {colors.map(([key, label]) => (
            <div key={key} className="flex items-center gap-3 rounded-lg border p-3">
              <Input type="color" aria-label={label} value={design[key]} onChange={(event) => update({ [key]: event.target.value })} className="h-10 w-14 p-1" />
              <div><Label>{label}</Label><div className="font-mono text-xs text-muted-foreground">{design[key]}</div></div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Шрифт заголовков</Label><Input value={design.font_heading} maxLength={80} onChange={(event) => update({ font_heading: event.target.value })} /></div>
          <div className="space-y-1"><Label>Шрифт текста</Label><Input value={design.font_body} maxLength={80} onChange={(event) => update({ font_body: event.target.value })} /></div>
          <div className="space-y-1"><Label>Стиль карточек и радиусов</Label><Select value={design.layout_style} onValueChange={(value) => update({ layout_style: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="classic">Классический</SelectItem><SelectItem value="modern">Современный</SelectItem><SelectItem value="minimal">Минималистичный</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label>Ширина контента (960–1600 px)</Label><Input type="number" min={960} max={1600} step={40} value={design.max_width} onChange={(event) => update({ max_width: Math.max(960, Math.min(1600, Number(event.target.value) || 1280)) })} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={design.animations_enabled} onCheckedChange={(value) => update({ animations_enabled: value === true })} />Разрешить анимации</label>
      </Card>
    </div>
  );
}
