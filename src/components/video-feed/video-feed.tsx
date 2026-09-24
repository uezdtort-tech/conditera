"use client";

/**
 * VideoFeed — вертикальная видео-лента (TikTok-style).
 *
 * Полноэкранные вертикальные видео с автопрокруткой.
 * Лайки, комментарии, переход к товару.
 */
import { useEffect, useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Heart, MessageCircle, Share2, Eye, Music2,
  ChevronUp, ChevronDown, ShoppingBag, Loader2,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";

interface VideoItem {
  id: string;
  confectionerId: string;
  videoUrl: string;
  posterUrl?: string;
  title: string;
  description?: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  productId?: string;
  audioTitle?: string;
}

export function VideoFeed() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [likedVideos, setLikedVideos] = useState<Set<string>>(new Set());
  const navigate = useAppStore((s) => s.navigate);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadVideos();
  }, []);

  const loadVideos = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/video-feed?limit=10");
      if (res.ok) {
        const data = await res.json();
        // API returns snake_case DB fields — map to camelCase VideoItem interface
        const rawVideos = data.videos || [];
        const mappedVideos: VideoItem[] = rawVideos.map((v: Record<string, unknown>) => ({
          id: String(v.id || ""),
          confectionerId: String(v.confectioner_id || v.confectionerId || ""),
          videoUrl: String(v.video_url || v.videoUrl || ""),
          posterUrl: v.poster_url != null ? String(v.poster_url) : (v.posterUrl != null ? String(v.posterUrl) : undefined),
          title: String(v.title || ""),
          description: v.description != null ? String(v.description) : undefined,
          viewsCount: Number(v.views_count ?? v.viewsCount ?? 0),
          likesCount: Number(v.likes_count ?? v.likesCount ?? 0),
          commentsCount: Number(v.comments_count ?? v.commentsCount ?? 0),
          sharesCount: Number(v.shares_count ?? v.sharesCount ?? 0),
          productId: v.product_id != null ? String(v.product_id) : (v.productId != null ? String(v.productId) : undefined),
          audioTitle: v.audio_title != null ? String(v.audio_title) : (v.audioTitle != null ? String(v.audioTitle) : undefined),
        }));
        setVideos(mappedVideos);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLike = (videoId: string) => {
    setLikedVideos((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
        // Отправляем лайк на сервер
        fetch(`/api/video-feed/${videoId}/like`, { method: "POST" }).catch(() => {});
      }
      return next;
    });
  };

  const handleShare = async (video: VideoItem) => {
    try {
      await navigator.share?.({
        title: video.title,
        text: video.description || "",
        url: window.location.href,
      });
    } catch {
      navigator.clipboard?.writeText(window.location.href);
      toast.success("Ссылка скопирована");
    }
  };

  const goNext = () => {
    if (currentIndex < videos.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const goPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-muted-foreground">Видео пока нет</p>
      </Card>
    );
  }

  const current = videos[currentIndex];
  const isLiked = likedVideos.has(current.id);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="relative h-[600px] bg-black rounded-2xl overflow-hidden"
      >
        {/* Video */}
        <video
          key={current.id}
          src={current.videoUrl}
          poster={current.posterUrl}
          autoPlay
          muted
          loop
          playsInline
          className="w-full h-full object-cover"
        />

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 pointer-events-none" />

        {/* Top bar */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
          <Badge className="bg-black/60 text-white backdrop-blur">
            <Eye className="h-3 w-3 mr-1" />
            {current.viewsCount || 0}
          </Badge>
          <Badge className="bg-black/60 text-white backdrop-blur">
            {currentIndex + 1} / {videos.length}
          </Badge>
        </div>

        {/* Navigation arrows */}
        {currentIndex > 0 && (
          <button
            onClick={goPrev}
            className="absolute top-1/2 left-3 -translate-y-1/2 h-10 w-10 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white"
          >
            <ChevronUp className="h-5 w-5" />
          </button>
        )}
        {currentIndex < videos.length - 1 && (
          <button
            onClick={goNext}
            className="absolute top-1/2 right-3 -translate-y-1/2 h-10 w-10 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
        )}

        {/* Right sidebar — actions */}
        <div className="absolute right-3 bottom-20 flex flex-col gap-4 items-center">
          <button
            onClick={() => handleLike(current.id)}
            className="flex flex-col items-center gap-1"
          >
            <div className={`h-12 w-12 rounded-full flex items-center justify-center backdrop-blur ${
              isLiked ? "bg-red-500" : "bg-black/40"
            }`}>
              <Heart className={`h-6 w-6 text-white ${isLiked ? "fill-white" : ""}`} />
            </div>
            <span className="text-white text-xs font-medium">
              {(current.likesCount || 0) + (isLiked ? 1 : 0)}
            </span>
          </button>

          <button className="flex flex-col items-center gap-1">
            <div className="h-12 w-12 rounded-full bg-black/40 backdrop-blur flex items-center justify-center">
              <MessageCircle className="h-6 w-6 text-white" />
            </div>
            <span className="text-white text-xs font-medium">{current.commentsCount || 0}</span>
          </button>

          <button
            onClick={() => handleShare(current)}
            className="flex flex-col items-center gap-1"
          >
            <div className="h-12 w-12 rounded-full bg-black/40 backdrop-blur flex items-center justify-center">
              <Share2 className="h-6 w-6 text-white" />
            </div>
            <span className="text-white text-xs font-medium">{current.sharesCount || 0}</span>
          </button>
        </div>

        {/* Bottom — info */}
        <div className="absolute bottom-0 left-0 right-16 p-4 space-y-2">
          <h3 className="text-white font-semibold text-sm line-clamp-2">{current.title}</h3>
          {current.description && (
            <p className="text-white/80 text-xs line-clamp-2">{current.description}</p>
          )}
          {current.audioTitle && (
            <div className="flex items-center gap-1 text-white/70 text-xs">
              <Music2 className="h-3 w-3" />
              <span className="truncate">{current.audioTitle}</span>
            </div>
          )}
          {current.productId && (
            <Button
              size="sm"
              onClick={() => navigate("product", { id: current.productId! })}
              className="gap-1 mt-2 bg-gradient-to-r from-purple-600 to-pink-600"
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              Заказать торт
            </Button>
          )}
        </div>
      </div>

      {/* Thumbnails strip */}
      <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
        {videos.map((v, i) => (
          <button
            key={v.id}
            onClick={() => setCurrentIndex(i)}
            className={`shrink-0 h-16 w-12 rounded-lg overflow-hidden border-2 transition-all ${
              i === currentIndex ? "border-purple-500 scale-105" : "border-transparent opacity-60"
            }`}
          >
            {v.posterUrl && (
              <img src={v.posterUrl} alt={v.title} className="w-full h-full object-cover" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
