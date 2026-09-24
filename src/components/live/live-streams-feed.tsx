"use client";

/**
 * LiveStreamsFeed — лента live-стримов кондитеров.
 *
 * Показывает карточки стримов:
 *   - LIVE — красный бейдж, текущие зрители, пульсирующая точка
 *   - SCHEDULED — расписание, "Напомнить"
 *   - ENDED — запись (VOD), метрики (пиковые зрители, заказы)
 *
 * Клик → открывает LiveStreamViewer (полноэкранный режим с чатом)
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Radio, Clock, Users, Heart, ShoppingBag, Play, Eye, Video,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { formatCurrency, formatRelative } from "@/lib/finance";
import { LiveStreamViewer } from "./live-stream-viewer";

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
  peakViewers: number;
  totalViewers: number;
  likesCount: number;
  ordersCount: number;
  revenue: number;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
}

export function LiveStreamsFeed() {
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStream, setActiveStream] = useState<LiveStream | null>(null);
  const confectioners = useAppStore((s) => s.confectioners);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/live-streams?status=live,scheduled,ended");
      if (res.ok) {
        const data = await res.json();
        setStreams(data.streams || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-0 overflow-hidden">
            <div className="aspect-video bg-muted animate-pulse" />
            <div className="p-3 space-y-2">
              <div className="h-4 bg-muted rounded animate-pulse" />
              <div className="h-3 bg-muted rounded w-2/3 animate-pulse" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (streams.length === 0) {
    return null;
  }

  const liveStreams = streams.filter((s) => s.status === "live");
  const scheduledStreams = streams.filter((s) => s.status === "scheduled");
  const endedStreams = streams.filter((s) => s.status === "ended");

  return (
    <>
      <div className="space-y-6">
        {/* LIVE сейчас */}
        {liveStreams.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Radio className="h-5 w-5 text-red-500" />
              <h2 className="font-display text-lg font-bold">В эфире сейчас</h2>
              <Badge className="bg-red-500 text-white gap-1">
                <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                LIVE
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {liveStreams.map((stream) => (
                <StreamCard
                  key={stream.id}
                  stream={stream}
                  confectioners={confectioners}
                  onClick={() => setActiveStream(stream)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Запланированные */}
        {scheduledStreams.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-5 w-5 text-blue-500" />
              <h2 className="font-display text-lg font-bold">Скоро</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {scheduledStreams.map((stream) => (
                <StreamCard
                  key={stream.id}
                  stream={stream}
                  confectioners={confectioners}
                  onClick={() => setActiveStream(stream)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Записи */}
        {endedStreams.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Video className="h-5 w-5 text-muted-foreground" />
              <h2 className="font-display text-lg font-bold">Записи стримов</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {endedStreams.map((stream) => (
                <StreamCard
                  key={stream.id}
                  stream={stream}
                  confectioners={confectioners}
                  onClick={() => setActiveStream(stream)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Viewer */}
      {activeStream && (
        <LiveStreamViewer
          stream={activeStream}
          onClose={() => {
            setActiveStream(null);
            load(); // обновить метрики
          }}
        />
      )}
    </>
  );
}

function StreamCard({
  stream,
  confectioners,
  onClick,
}: {
  stream: LiveStream;
  confectioners: any[];
  onClick: () => void;
}) {
  const confectioner = confectioners.find(
    (c) => c.id === stream.confectionerId || c.userId === stream.confectionerId
  );

  const isLive = stream.status === "live";
  const isScheduled = stream.status === "scheduled";
  const isEnded = stream.status === "ended";

  return (
    <Card
      className="p-0 overflow-hidden cursor-pointer hover:shadow-lg transition-shadow group"
      onClick={onClick}
    >
      {/* Превью */}
      <div className="relative aspect-video bg-muted">
        {stream.thumbnailUrl ? (
          <img
            src={stream.thumbnailUrl}
            alt={stream.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-pink-500/20">
            <Video className="h-12 w-12 text-muted-foreground" />
          </div>
        )}

        {/* Status badge */}
        <div className="absolute top-2 left-2">
          {isLive && (
            <Badge className="bg-red-500 text-white gap-1">
              <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
              LIVE
            </Badge>
          )}
          {isScheduled && (
            <Badge className="bg-blue-500 text-white gap-1">
              <Clock className="h-3 w-3" />
              {stream.scheduledAt ? formatRelative(stream.scheduledAt) : "Скоро"}
            </Badge>
          )}
          {isEnded && (
            <Badge variant="secondary" className="gap-1">
              <Play className="h-3 w-3" />
              Запись
            </Badge>
          )}
        </div>

        {/* Viewers count (для live) */}
        {isLive && (
          <div className="absolute top-2 right-2">
            <Badge className="bg-black/70 text-white gap-1">
              <Eye className="h-3 w-3" />
              {stream.viewersCount}
            </Badge>
          </div>
        )}

        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
          <div className="h-14 w-14 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Play className="h-6 w-6 text-black ml-1" fill="black" />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="font-semibold text-sm line-clamp-2 mb-2">{stream.title}</h3>

        {confectioner && (
          <div className="flex items-center gap-2 mb-2">
            <Avatar className="h-6 w-6">
              <AvatarImage src={confectioner.avatar} alt={confectioner.businessName} />
              <AvatarFallback className="text-[10px]">
                {confectioner.businessName?.slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground truncate">
              {confectioner.businessName}
            </span>
          </div>
        )}

        {/* Метрики */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {isLive && (
            <>
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {stream.viewersCount}
              </span>
              <span className="flex items-center gap-1">
                <Heart className="h-3 w-3" />
                {stream.likesCount}
              </span>
              {stream.ordersCount > 0 && (
                <span className="flex items-center gap-1 text-emerald-600">
                  <ShoppingBag className="h-3 w-3" />
                  {stream.ordersCount}
                </span>
              )}
            </>
          )}
          {isEnded && (
            <>
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {stream.peakViewers} пик
              </span>
              {stream.revenue > 0 && (
                <span className="text-emerald-600 font-medium">
                  {formatCurrency(stream.revenue)}
                </span>
              )}
            </>
          )}
          {isScheduled && stream.scheduledAt && (
            <span className="text-blue-600">
              {new Date(stream.scheduledAt).toLocaleDateString("ru-RU", {
                day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
              })}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
