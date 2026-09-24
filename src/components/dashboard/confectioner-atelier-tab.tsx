"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Save, Loader2, GraduationCap, Award, Wrench, Clock, Users, Link2 } from "lucide-react";
import { toast } from "sonner";

const DAYS = [{ key: "mon", label: "Пн" }, { key: "tue", label: "Вт" }, { key: "wed", label: "Ср" }, { key: "thu", label: "Чт" }, { key: "fri", label: "Пт" }, { key: "sat", label: "Сб" }, { key: "sun", label: "Вс" }];
const TECHNIQUES = ["аэрограф", "сахарная флористика", "изомальт", "шоколадные формы", "3D-печать", "ручная роспись", "темперирование шоколада", "молекулярная кухня"];

export function ConfectionerAtelierTab({ userId }: { userId: string }) {
  const [atelier, setAtelier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, [userId]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/confectioner/atelier?userId=${userId}`);
      if (res.ok) { const data = await res.json(); setAtelier(data.atelier); }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/confectioner/atelier", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(atelier) });
      if (res.ok) toast.success("Информация об ателье сохранена");
      else toast.error("Ошибка сохранения");
    } catch { toast.error("Ошибка сети"); }
    finally { setSaving(false); }
  };

  const update = (field: string, value: any) => setAtelier({ ...atelier, [field]: value });

  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file); fd.append("ownerType", "confectioner"); fd.append("category", "portfolio");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (res.ok) { const data = await res.json(); update("workshopPhotos", [...(atelier.workshopPhotos || []), data.url]); toast.success("Фото загружено"); }
    } catch { toast.error("Ошибка загрузки"); }
  };

  if (loading) return <Card className="p-8 text-center"><Loader2 className="h-6 w-6 mx-auto animate-spin" /></Card>;
  if (!atelier) return <Card className="p-8 text-center text-muted-foreground">Не удалось загрузить</Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="font-display text-2xl font-bold">Моё ателье</h1><p className="text-sm text-muted-foreground">Подробная информация о мастерской, оборудовании, квалификации</p></div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Сохранить</Button>
      </div>

      <Card className="p-4 space-y-2">
        <Label className="flex items-center gap-1 text-sm font-medium"><Users className="h-4 w-4" /> О мастерской</Label>
        <Textarea value={atelier.about || ""} onChange={(e) => update("about", e.target.value)} placeholder="Наша мастерская расположена в центре города. Работаем с 2018 года..." className="min-h-[100px]" />
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Опыт (лет)</Label><Input type="number" value={atelier.experienceYears || 0} onChange={(e) => update("experienceYears", parseInt(e.target.value) || 0)} /></div>
          <div><Label className="text-xs">Размер команды</Label><Input type="number" value={atelier.teamSize || 1} onChange={(e) => update("teamSize", parseInt(e.target.value) || 1)} /></div>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <Label className="text-sm font-medium">Фото мастерской</Label>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {(atelier.workshopPhotos || []).map((photo: string, i: number) => (
            <div key={i} className="relative aspect-square rounded-lg overflow-hidden">
              <img src={photo} alt={`Мастерская ${i + 1}`} className="w-full h-full object-cover" />
              <button onClick={() => update("workshopPhotos", atelier.workshopPhotos.filter((_: any, idx: number) => idx !== i))} className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center"><Trash2 className="h-2.5 w-2.5" /></button>
            </div>
          ))}
          <label className="aspect-square border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer hover:border-primary/50">
            <input type="file" accept="image/*" onChange={handleUploadPhoto} className="hidden" /><Plus className="h-6 w-6 text-muted-foreground" />
          </label>
        </div>
        <div><Label className="text-xs">Видео-презентация (URL)</Label><Input value={atelier.presentationVideo || ""} onChange={(e) => update("presentationVideo", e.target.value)} placeholder="https://..." /></div>
      </Card>

      <Card className="p-4 space-y-2">
        <Label className="flex items-center gap-1 text-sm font-medium"><Wrench className="h-4 w-4" /> Оборудование</Label>
        {(atelier.equipment || []).map((item: any, i: number) => (
          <div key={i} className="flex gap-2">
            <Input value={item.name || ""} onChange={(e) => { const eq = [...atelier.equipment]; eq[i] = { ...item, name: e.target.value }; update("equipment", eq); }} placeholder="Планетарный миксер" className="flex-1" />
            <Input type="number" value={item.qty || 1} onChange={(e) => { const eq = [...atelier.equipment]; eq[i] = { ...item, qty: parseInt(e.target.value) || 1 }; update("equipment", eq); }} className="w-16" />
            <Button size="icon" variant="ghost" className="text-red-500" onClick={() => update("equipment", atelier.equipment.filter((_: any, idx: number) => idx !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" className="w-full" onClick={() => update("equipment", [...(atelier.equipment || []), { name: "", qty: 1 }])}><Plus className="h-3 w-3 mr-1" /> Добавить</Button>
      </Card>

      <div className="grid sm:grid-cols-2 gap-3">
        <Card className="p-4 space-y-2">
          <Label className="flex items-center gap-1 text-sm font-medium"><GraduationCap className="h-4 w-4" /> Образование</Label>
          {(atelier.education || []).map((edu: any, i: number) => (
            <div key={i} className="flex gap-2">
              <Input value={edu.institution || ""} onChange={(e) => { const ed = [...atelier.education]; ed[i] = { ...edu, institution: e.target.value }; update("education", ed); }} placeholder="Школа кондитеров" className="flex-1 text-sm" />
              <Input value={edu.year || ""} onChange={(e) => { const ed = [...atelier.education]; ed[i] = { ...edu, year: e.target.value }; update("education", ed); }} placeholder="2018" className="w-20 text-sm" />
              <Button size="icon" variant="ghost" className="text-red-500 h-7" onClick={() => update("education", atelier.education.filter((_: any, idx: number) => idx !== i))}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => update("education", [...(atelier.education || []), { institution: "", year: "" }])}><Plus className="h-3 w-3 mr-1" /> Добавить</Button>
        </Card>

        <Card className="p-4 space-y-2">
          <Label className="flex items-center gap-1 text-sm font-medium"><Award className="h-4 w-4" /> Награды и сертификаты</Label>
          {(atelier.awards || []).map((award: any, i: number) => (
            <div key={i} className="flex gap-2">
              <Input value={award.name || ""} onChange={(e) => { const a = [...atelier.awards]; a[i] = { ...award, name: e.target.value }; update("awards", a); }} placeholder="1 место Cake Expo" className="flex-1 text-sm" />
              <Button size="icon" variant="ghost" className="text-red-500 h-7" onClick={() => update("awards", atelier.awards.filter((_: any, idx: number) => idx !== i))}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => update("awards", [...(atelier.awards || []), { name: "", year: "" }])}><Plus className="h-3 w-3 mr-1" /> Добавить</Button>
        </Card>
      </div>

      <Card className="p-4 space-y-2">
        <Label className="flex items-center gap-1 text-sm font-medium"><Clock className="h-4 w-4" /> График работы</Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DAYS.map((day) => (
            <div key={day.key}>
              <Label className="text-xs">{day.label}</Label>
              <Input value={(atelier.workingHours || {})[day.key] || ""} onChange={(e) => update("workingHours", { ...(atelier.workingHours || {}), [day.key]: e.target.value })} placeholder="9-18" className="text-sm" />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <Label className="text-sm font-medium">Техники и стили</Label>
        <div className="flex flex-wrap gap-1.5">
          {TECHNIQUES.map((tech) => {
            const selected = (atelier.techniques || []).includes(tech);
            return (
              <button key={tech} onClick={() => { const techs = atelier.techniques || []; update("techniques", selected ? techs.filter((t: string) => t !== tech) : [...techs, tech]); }}
                className={`px-2 py-1 rounded-md text-xs border transition-colors ${selected ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/40"}`}>{tech}</button>
            );
          })}
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <Label className="flex items-center gap-1 text-sm font-medium"><Link2 className="h-4 w-4" /> Соцсети</Label>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Instagram</Label><Input value={(atelier.socialLinks || {}).instagram || ""} onChange={(e) => update("socialLinks", { ...(atelier.socialLinks || {}), instagram: e.target.value })} placeholder="@username" /></div>
          <div><Label className="text-xs">ВКонтакте</Label><Input value={(atelier.socialLinks || {}).vk || ""} onChange={(e) => update("socialLinks", { ...(atelier.socialLinks || {}), vk: e.target.value })} placeholder="vk.com/..." /></div>
          <div><Label className="text-xs">Telegram</Label><Input value={(atelier.socialLinks || {}).telegram || ""} onChange={(e) => update("socialLinks", { ...(atelier.socialLinks || {}), telegram: e.target.value })} placeholder="@channel" /></div>
          <div><Label className="text-xs">YouTube</Label><Input value={(atelier.socialLinks || {}).youtube || ""} onChange={(e) => update("socialLinks", { ...(atelier.socialLinks || {}), youtube: e.target.value })} placeholder="URL" /></div>
        </div>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="w-full gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Сохранить всё</Button>
    </div>
  );
}
