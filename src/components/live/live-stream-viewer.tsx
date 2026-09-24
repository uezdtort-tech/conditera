"use client";

/**
 * LiveStreamViewer — полноэкранный просмотрщик live-стрима.
 *
 * Возможности:
 *   - Видео-плеер (HTML5 video с HLS source, fallback на тестовый stream)
 *   - Чат в реальном времени (polling каждые 3 сек)
 *   - Лайк стрима
 *   - Заказать товар (если есть productId)
 *   - Метрики (зрители, лайки)
 */
import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  X, Heart, Eye, Send, ShoppingBag, Radio, Users, MessageCircle,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/finance";

interface LiveStream {
  id: string;
  confectionerId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  status: "live" | "scheduled" | "ended";
  streamUrl?: string;
  recordUrl?: string;
  productId?: string;
  viewersCount: number;
  likesCount: number;
  ordersCount: number;
  scheduledAt?: string;
}

interface ChatMessage {
  id: string;
  userName: string;
  userAvatar?: string;
  text: string;
  createdAt: string;
}

export function LiveStreamViewer({
  stream,
  onClose,
}: {
  stream: LiveStream;
  onClose: () => void;
}) {
  const navigate = useAppStore((s) => s.navigate);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [viewers, setViewers] = useState(stream.viewersCount);
  const [likes, setLikes] = useState(stream.likesCount);
  const [liked, setLiked] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isLive = stream.status === "live";
  const videoUrl = stream.streamUrl || stream.recordUrl;

  // === Присоединиться к стриму ===
  useEffect(() => {
    fetch(`/api/live-streams/${stream.id}/join`, { method: "POST" })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.sessionId) setSessionId(data.sessionId);
      })
      .catch(() => {});

    return () => {
      // При выходе — можно отправить leave (опционально)
    };
  }, [stream.id]);

  // === Загрузка чата + polling ===
  useEffect(() => {
    loadMessages();

    if (isLive) {
      const interval = setInterval(loadMessages, 3000);
      return () => clearInterval(interval);
    }
  }, [stream.id, isLive]);

  const loadMessages = async () => {
    try {
      const res = await fetch(`/api/live-streams/${stream.id}/chat?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        // Прокрутка вниз
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      }
    } catch {}
  };

  // === Отправка сообщения ===
  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/live-streams/${stream.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: newMessage.trim(),
          sessionId,
        }),
      });
      if (res.ok) {
        setNewMessage("");
        await loadMessages();
      }
    } catch {
      toast.error("Ошибка отправки");
    } finally {
      setSending(false);
    }
  };

  // === Лайк ===
  const handleLike = async () => {
    if (liked) return;
    setLiked(true);
    setLikes(l => l + 1);
    try {
      await fetch(`/api/live-streams/${stream.id}/like`, { method: "POST" });
    } catch {}
  };

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="p-0 max-w-6xl gap-0 overflow-hidden h-[90vh] flex">
        <DialogTitle className="sr-only">Прямой эфир кондитера</DialogTitle>
        {/* Левая часть — видео */}
        <div className="flex-1 flex flex-col bg-black">
          {/* Видео-плеер */}
          <div className="flex-1 relative">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                poster={stream.thumbnailUrl}
                autoPlay={isLive}
                controls={!isLive}
                playsInline
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900 to-pink-900">
                <div className="text-center text-white p-8">
                  <Radio className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <h3 className="text-xl font-bold mb-2">{stream.title}</h3>
                  <p className="text-white/70">
                    {isLive ? "Стрим скоро начнётся" : "Видео будет доступно позже"}
                  </p>
                  {stream.scheduledAt && (
                    <p className="text-white/50 text-sm mt-2">
                      Начало: {new Date(stream.scheduledAt).toLocaleString("ru-RU")}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* LIVE badge */}
            {isLive && (
              <div className="absolute top-4 left-4">
                <Badge className="bg-red-500 text-white gap-1">
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  LIVE
                </Badge>
              </div>
            )}

            {/* Метрики */}
            <div className="absolute top-4 right-4 flex gap-2">
              <Badge className="bg-black/70 text-white gap-1">
                <Eye className="h-3 w-3" />
                {viewers}
              </Badge>
              <Badge className="bg-black/70 text-white gap-1">
                <Heart className="h-3 w-3" />
                {likes}
              </Badge>
            </div>
          </div>

          {/* Info bar */}
          <div className="bg-black/90 text-white p-3 space-y-2">
            <h3 className="font-semibold text-sm">{stream.title}</h3>
            {stream.description && (
              <p className="text-xs text-white/70 line-clamp-2">{stream.description}</p>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleLike}
                disabled={liked}
                className={`gap-1 ${liked ? "bg-red-500" : "bg-white/10 hover:bg-white/20"}`}
              >
                <Heart className={`h-3.5 w-3.5 ${liked ? "fill-white" : ""}`} />
                {liked ? "Лайк!" : "Лайк"}
              </Button>
              {stream.productId && (
                <Button
                  size="sm"
                  onClick={() => {
                    onClose();
                    navigate("product", { id: stream.productId! });
                  }}
                  className="gap-1 bg-gradient-to-r from-purple-600 to-pink-600"
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  Заказать торт
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Правая часть — чат */}
        <div className="w-80 flex flex-col bg-background border-l">
          {/* Chat header */}
          <div className="p-3 border-b flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            <span className="text-sm font-medium">Чат</span>
            <Badge variant="outline" className="text-[10px] ml-auto">
              <Users className="h-2.5 w-2.5 mr-1" />
              {viewers}
            </Badge>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Будьте первым в чате!
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className="flex gap-2 text-sm">
                  {msg.userAvatar ? (
                    <img src={msg.userAvatar} alt={msg.userName} className="h-6 w-6 rounded-full shrink-0" />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium shrink-0">
                      {msg.userName.slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-medium truncate">{msg.userName}</span>
                      <span className="text-[9px] text-muted-foreground">
                        {new Date(msg.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-xs break-words">{msg.text}</p>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t flex gap-2">
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Сообщение..."
              maxLength={500}
              className="text-sm"
            />
            <Button
              size="icon"
              onClick={handleSendMessage}
              disabled={sending || !newMessage.trim()}
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
