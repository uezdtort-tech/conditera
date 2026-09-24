"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Edit3, Trash2, Eye, Loader2, School, Video, FileText, Users, Star, Clock, Upload } from "lucide-react";
import { toast } from "sonner";

const LESSON_TYPES = [
  { value: "video_lesson", label: "Видеоурок" },
  { value: "master_class", label: "Мастер-класс" },
  { value: "presentation", label: "Презентация" },
  { value: "article", label: "Статья" },
  { value: "live_workshop", label: "Живой МК" },
];

const DIFFICULTY = [
  { value: "beginner", label: "Начинающий" },
  { value: "intermediate", label: "Средний" },
  { value: "advanced", label: "Продвинутый" },
  { value: "professional", label: "Профессионал" },
];

export function ConfectionerLessonsTab({ userId }: { userId: string }) {
  const [lessons, setLessons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  useEffect(() => { load(); }, [userId]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons?confectionerId=${userId}`);
      if (res.ok) { const data = await res.json(); setLessons(data.lessons || []); }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleSave = async (lesson: any) => {
    try {
      const isEdit = !!lesson.id;
      const res = await fetch("/api/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lesson),
      });
      if (res.ok) {
        toast.success(isEdit ? "Урок обновлён" : "Урок создан");
        setShowEdit(false);
        setEditing(null);
        await load();
      }
    } catch { toast.error("Ошибка"); }
  };

  if (loading) return <Card className="p-8 text-center"><Loader2 className="h-6 w-6 mx-auto animate-spin"/></Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><School className="h-6 w-6 text-primary"/> Уроки и мастер-классы</h1>
          <p className="text-sm text-muted-foreground">Создавайте видеоуроки, МК, презентации. monetизация обучения.</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowEdit(true); }}><Plus className="h-4 w-4 mr-1"/> Создать</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {lessons.map((lesson) => (
          <Card key={lesson.id} className="overflow-hidden p-0">
            <div className="relative aspect-video bg-muted">
              {lesson.posterUrl && <img src={lesson.posterUrl} alt={lesson.title} className="w-full h-full object-cover"/>}
              <Badge className="absolute top-2 left-2 bg-black/60 text-white text-[9px]">{LESSON_TYPES.find(t => t.value === lesson.type)?.label || lesson.type}</Badge>
              {lesson.price > 0 && <Badge className="absolute top-2 right-2 bg-amber-500 text-white text-[9px]">{lesson.price}₽</Badge>}
              {lesson.price === 0 && <Badge className="absolute top-2 right-2 bg-emerald-500 text-white text-[9px]">Бесплатно</Badge>}
            </div>
            <div className="p-3 space-y-1.5">
              <div className="font-medium text-sm line-clamp-2">{lesson.title}</div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Badge variant="outline" className="text-[9px]">{DIFFICULTY.find(d => d.value === lesson.difficultyLevel)?.label}</Badge>
                <span className="flex items-center gap-0.5"><Users className="h-2.5 w-2.5"/>{lesson.enrolledCount}</span>
                <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5"/>{lesson.viewsCount}</span>
                {lesson.rating > 0 && <span className="flex items-center gap-0.5"><Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400"/>{lesson.rating}</span>}
              </div>
              <div className="flex gap-1 pt-1">
                <Button size="sm" variant="outline" className="flex-1 text-xs gap-1" onClick={() => { setEditing(lesson); setShowEdit(true); }}><Edit3 className="h-3 w-3"/> Редакт.</Button>
                <Button size="sm" variant="ghost" className="text-xs"><Eye className="h-3 w-3"/></Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {lessons.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">
          <School className="h-12 w-12 mx-auto mb-2 opacity-30"/>
          <p className="text-sm">Уроков пока нет. Создайте первый видеоурок или мастер-класс!</p>
        </Card>
      )}

      {showEdit && <LessonEditDialog lesson={editing} onClose={() => { setShowEdit(false); setEditing(null); }} onSave={handleSave}/>}
    </div>
  );
}

function LessonEditDialog({ lesson, onClose, onSave }: { lesson: any; onClose: () => void; onSave: (l: any) => void }) {
  const [form, setForm] = useState(lesson || { type: "video_lesson", title: "", description: "", videoUrl: "", posterUrl: "", difficultyLevel: "beginner", price: 0, tags: [], scheduledAt: "", maxParticipants: null });
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: string) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    const fd = new FormData(); fd.append("file", file); fd.append("ownerType", "confectioner"); fd.append("category", "recipe");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (res.ok) { const data = await res.json(); setForm({ ...form, [field]: data.url }); toast.success("Загружено"); }
    } catch { toast.error("Ошибка"); }
    finally { setUploading(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{lesson ? "Редактировать урок" : "Новый урок"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-sm">Тип</Label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm">
              {LESSON_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div><Label className="text-sm">Название *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Сахарная роза: от раскатки до сборки"/></div>
          <div><Label className="text-sm">Описание *</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Полный видеоурок по созданию..." className="min-h-[80px]"/></div>
          <div><Label className="text-sm">Видео URL</Label><Input value={form.videoUrl || ""} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} placeholder="https://..."/></div>
          <div><Label className="text-sm">Обложка (URL)</Label><Input value={form.posterUrl || ""} onChange={(e) => setForm({ ...form, posterUrl: e.target.value })} placeholder="https://..."/>
            <label className="block mt-1 cursor-pointer"><input type="file" accept="image/*" onChange={(e) => handleUpload(e, "posterUrl")} className="hidden"/>
              <div className="border border-dashed rounded p-2 text-center text-xs hover:border-primary/50">{uploading ? <Loader2 className="h-3 w-3 mx-auto animate-spin"/> : <Upload className="h-3 w-3 mx-auto"/>}{" Загрузить"}</div>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-sm">Уровень</Label>
              <select value={form.difficultyLevel} onChange={(e) => setForm({ ...form, difficultyLevel: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm">
                {DIFFICULTY.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div><Label className="text-sm">Цена (₽, 0=бесплатно)</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}/></div>
          </div>
          {form.type === "live_workshop" && (
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-sm">Дата и время</Label><Input type="datetime-local" value={form.scheduledAt || ""} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}/></div>
              <div><Label className="text-sm">Макс. участников</Label><Input type="number" value={form.maxParticipants || ""} onChange={(e) => setForm({ ...form, maxParticipants: parseInt(e.target.value) || null })}/></div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button disabled={!form.title || !form.description} onClick={() => onSave(form)}>Сохранить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
