"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Upload, X, Image as ImageIcon, Loader2, AlertCircle, Link as LinkIcon,
} from "lucide-react";
import { validateFile, type UploadCategory } from "@/lib/upload-config";
import { toast } from "sonner";

interface ImageUploaderProps {
  category: UploadCategory;
  value?: string | string[];
  onChange: (urls: string | string[]) => void;
  multiple?: boolean;
  maxImages?: number;
  label?: string;
  compact?: boolean;
}

export function ImageUploader({
  category,
  value = "",
  onChange,
  multiple = false,
  maxImages = 8,
  label,
  compact = false,
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentUrls: string[] = Array.isArray(value) ? value : value ? [value] : [];

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // Проверка лимита
    if (multiple && currentUrls.length + fileArray.length > maxImages) {
      toast.error(`Максимум ${maxImages} изображений`);
      return;
    }

    setUploading(true);

    try {
      const uploadedUrls: string[] = [];

      for (const file of fileArray) {
        // Валидация
        const validation = validateFile(file, category);
        if (!validation.valid) {
          toast.error(`${file.name}: ${validation.error}`);
          continue;
        }

        // В реальном приложении — POST на /api/upload
        // const formData = new FormData();
        // formData.append("file", file);
        // formData.append("category", category);
        // const res = await fetch("/api/upload", { method: "POST", body: formData });
        // const data = await res.json();
        // if (!data.success) throw new Error(data.error);
        // uploadedUrls.push(data.url);

        // Демо: используем URL.createObjectURL для превью
        const demoUrl = URL.createObjectURL(file);
        uploadedUrls.push(demoUrl);
      }

      if (uploadedUrls.length > 0) {
        if (multiple) {
          onChange([...currentUrls, ...uploadedUrls]);
        } else {
          onChange(uploadedUrls[0]);
        }
        toast.success(`Загружено: ${uploadedUrls.length} из ${fileArray.length}`);
      }
    } catch (err) {
      toast.error("Ошибка загрузки");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [category, currentUrls, maxImages, multiple, onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) {
      handleUpload(e.dataTransfer.files);
    }
  }, [handleUpload]);

  const handleRemove = (index: number) => {
    if (multiple) {
      const next = currentUrls.filter((_, i) => i !== index);
      onChange(next);
    } else {
      onChange("");
    }
  };

  const handleAddUrl = () => {
    if (!urlValue.trim()) return;
    if (!urlValue.startsWith("http")) {
      toast.error("Введите корректный URL (начинается с http)");
      return;
    }
    if (multiple) {
      onChange([...currentUrls, urlValue.trim()]);
    } else {
      onChange(urlValue.trim());
    }
    setUrlValue("");
    setShowUrlInput(false);
    toast.success("Изображение добавлено");
  };

  return (
    <div className="space-y-3">
      {label && <label className="text-sm font-medium block">{label}</label>}

      {/* Превью загруженных */}
      {currentUrls.length > 0 && (
        <div className={`grid ${compact ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"} gap-2`}>
          {currentUrls.map((url, i) => (
            <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted">
              <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              <button
                type="button"
                onClick={() => handleRemove(i)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition flex items-center justify-center hover:bg-rose-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              {i === 0 && multiple && (
                <Badge className="absolute bottom-1 left-1 text-[9px] bg-primary text-primary-foreground">
                  Главное
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Зона загрузки */}
      {!multiple && currentUrls.length === 1 ? null : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition ${
            dragOver
              ? "border-primary bg-primary/10"
              : "border-border hover:border-primary/40 hover:bg-accent/30"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple={multiple}
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
            className="hidden"
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Загрузка...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-2">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">
                {multiple ? "Загрузите изображения" : "Загрузите изображение"}
              </p>
              <p className="text-xs text-muted-foreground">
                Перетащите файл или нажмите для выбора
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                JPG, PNG, WebP • до {(8).toFixed(0)} МБ
              </p>
            </div>
          )}
        </div>
      )}

      {/* Кнопка "Добавить по URL" */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowUrlInput(!showUrlInput)}
          className="text-xs"
        >
          <LinkIcon className="h-3.5 w-3.5 mr-1" />
          Добавить по URL
        </Button>
        {multiple && currentUrls.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {currentUrls.length} / {maxImages}
          </span>
        )}
      </div>

      {/* Поле ввода URL */}
      {showUrlInput && (
        <div className="flex gap-2">
          <Input
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="flex-1"
          />
          <Button type="button" size="sm" onClick={handleAddUrl}>
            Добавить
          </Button>
        </div>
      )}
    </div>
  );
}
