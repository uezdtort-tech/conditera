"use client";

/**
 * StoriesFeed — горизонтальная лента сторис кондитеров (как в Instagram).
 *
 * Показывает аватарки кондитеров с цветным кольцом (есть непросмотренные).
 * Клик → открывает StoriesViewer с полным экраном.
 *
 * Размещается на главной странице и в карточке кондитера.
 */
import { useEffect, useState, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Heart, Send, X, ChevronLeft, ChevronRight, Eye, Plus,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";

interface Story {
  id: string;
  confectionerId: string;
  image: string;
  video?: string | null;
  type: "image" | "video";
  caption?: string | null;
  duration: number;
  productId?: string | null;
  viewsCount: number;
  likesCount: number;
  repliesCount: number;
  expiresAt: string;
  createdAt: string;
}

interface GroupedStories {
  confectionerId: string;
  confectionerName: string;
  confectionerAvatar?: string;
  stories: Story[];
  hasUnviewed: boolean;
}

export function StoriesFeed({
  confectionerId,
  limit = 10,
}: {
  confectionerId?: string;
  limit?: number;
}) {
  const [groups, setGroups] = useState<GroupedStories[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState(0);
  const [activeStory, setActiveStory] = useState(0);
  const confectioners = useAppStore((s) => s.confectioners);

  useEffect(() => {
    loadStories();
  }, [confectionerId]);

  const loadStories = async () => {
    setLoading(true);
    try {
      const url = confectionerId
        ? `/api/stories?confectionerId=${confectionerId}`
        : "/api/stories";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const stories: Story[] = data.stories || [];
        // Группируем по кондитеру
        const grouped: Record<string, Story[]> = {};
        stories.forEach((s) => {
          if (!grouped[s.confectionerId]) grouped[s.confectionerId] = [];
          grouped[s.confectionerId].push(s);
        });

        const groupsArray: GroupedStories[] = Object.entries(grouped).map(([cid, sts]) => {
          const conf = confectioners.find((c: any) => c.id === cid || c.userId === cid);
          return {
            confectionerId: cid,
            confectionerName: conf?.businessName || "Кондитер",
            confectionerAvatar: conf?.avatar,
            stories: sts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
            hasUnviewed: sts.length > 0,
          };
        });
        setGroups(groupsArray.slice(0, limit));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const openViewer = (groupIdx: number, storyIdx: number = 0) => {
    setActiveGroup(groupIdx);
    setActiveStory(storyIdx);
    setViewerOpen(true);
  };

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="shrink-0 flex flex-col items-center gap-1">
            <div className="h-16 w-16 rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-12 bg-muted rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return null; // Не показываем пустой блок
  }

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
        {groups.map((group, gi) => (
          <button
            key={group.confectionerId}
            onClick={() => openViewer(gi, 0)}
            className="shrink-0 flex flex-col items-center gap-1 group"
          >
            <div className={`p-0.5 rounded-full ${
              group.hasUnviewed
                ? "bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600"
                : "bg-muted"
            }`}>
              <div className="p-0.5 bg-background rounded-full">
                <Avatar className="h-14 w-14">
                  <AvatarImage src={group.confectionerAvatar} alt={group.confectionerName} />
                  <AvatarFallback>{group.confectionerName.slice(0, 2)}</AvatarFallback>
                </Avatar>
              </div>
            </div>
            <span className="text-xs text-muted-foreground max-w-[60px] truncate">
              {group.confectionerName.split(" ")[0]}
            </span>
            {group.stories.length > 1 && (
              <Badge variant="outline" className="text-[9px] -mt-1">
                {group.stories.length}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Viewer */}
      {viewerOpen && groups[activeGroup] && (
        <StoriesViewer
          group={groups[activeGroup]}
          initialStoryIndex={activeStory}
          onClose={() => {
            setViewerOpen(false);
            loadStories(); // обновить счётчики
          }}
          onPrevGroup={() => {
            if (activeGroup > 0) {
              setActiveGroup(activeGroup - 1);
              setActiveStory(0);
            }
          }}
          onNextGroup={() => {
            if (activeGroup < groups.length - 1) {
              setActiveGroup(activeGroup + 1);
              setActiveStory(0);
            }
          }}
        />
      )}
    </>
  );
}

// ===== Полноэкранный viewer =====
function StoriesViewer({
  group,
  initialStoryIndex,
  onClose,
  onPrevGroup,
  onNextGroup,
}: {
  group: GroupedStories;
  initialStoryIndex: number;
  onClose: () => void;
  onPrevGroup: () => void;
  onNextGroup: () => void;
}) {
  const [storyIdx, setStoryIdx] = useState(initialStoryIndex);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [liked, setLiked] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const navigate = useAppStore((s) => s.navigate);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const story = group.stories[storyIdx];
  const duration = (story?.duration || 5) * 1000; // в мс

  // Прогресс-бар + автопереключение
  useEffect(() => {
    if (!story) return;
    setProgress(0);
    setPaused(false);

    // Отмечаем просмотр
    fetch(`/api/stories/${story.id}/view`, { method: "POST" }).catch(() => {});

    const startTime = Date.now();
    const tick = () => {
      if (paused) return;
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, (elapsed / duration) * 100);
      setProgress(pct);
      if (pct >= 100) {
        goNext();
      }
    };
    timerRef.current = setInterval(tick, 50);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [storyIdx, paused, story]);

  const goNext = () => {
    if (storyIdx < group.stories.length - 1) {
      setStoryIdx(storyIdx + 1);
    } else {
      onNextGroup();
    }
  };

  const goPrev = () => {
    if (storyIdx > 0) {
      setStoryIdx(storyIdx - 1);
    } else {
      onPrevGroup();
    }
  };

  const handleLike = async () => {
    if (!story) return;
    setLiked(!liked);
    try {
      await fetch(`/api/stories/${story.id}/like`, { method: "POST" });
    } catch {}
  };

  const handleReply = async () => {
    if (!story || !replyText.trim()) return;
    setSendingReply(true);
    try {
      const res = await fetch(`/api/stories/${story.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: replyText.trim() }),
      });
      if (res.ok) {
        toast.success("Ответ отправлен");
        setReplyText("");
        setShowReply(false);
      }
    } catch {
      toast.error("Ошибка");
    } finally {
      setSendingReply(false);
    }
  };

  if (!story) return null;

  // Время до истечения
  const expiresAt = new Date(story.expiresAt);
  const hoursLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / (60 * 60 * 1000)));

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="p-0 max-w-md gap-0 overflow-hidden bg-black border-0" style={{ height: "90vh" }}>
        <DialogTitle className="sr-only">История кондитера</DialogTitle>
        {/* Progress bars */}
        <div className="absolute top-0 left-0 right-0 flex gap-1 p-2 z-20">
          {group.stories.map((_, i) => (
            <div key={i} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-white transition-all"
                style={{ width: i < storyIdx ? "100%" : i === storyIdx ? `${progress}%` : "0%" }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-4 left-0 right-0 flex items-center justify-between p-3 z-20">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8 border-2 border-white">
              <AvatarImage src={group.confectionerAvatar} alt={group.confectionerName} />
              <AvatarFallback className="text-xs">{group.confectionerName.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="text-white text-sm font-medium">{group.confectionerName}</div>
              <div className="text-white/70 text-[10px]">{hoursLeft}ч до истечения</div>
            </div>
          </div>
          <button onClick={onClose} className="text-white p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Медиа */}
        <div
          className="relative h-full flex items-center justify-center"
          onMouseDown={() => setPaused(true)}
          onMouseUp={() => setPaused(false)}
          onTouchStart={() => setPaused(true)}
          onTouchEnd={() => setPaused(false)}
        >
          {story.type === "video" && story.video ? (
            <video
              src={story.video}
              autoPlay
              muted
              loop
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <img
              src={story.image}
              alt={story.caption || "Story"}
              className="max-h-full max-w-full object-contain"
            />
          )}

          {/* Click zones */}
          <button
            onClick={goPrev}
            className="absolute left-0 top-0 bottom-0 w-1/3 z-10"
            aria-label="Предыдущая"
          />
          <button
            onClick={goNext}
            className="absolute right-0 top-0 bottom-0 w-1/3 z-10"
            aria-label="Следующая"
          />
        </div>

        {/* Caption + actions */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent z-20">
          {story.caption && (
            <p className="text-white text-sm mb-3 line-clamp-3">{story.caption}</p>
          )}

          {/* Метрики */}
          <div className="flex items-center gap-4 text-white/80 text-xs mb-3">
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {story.viewsCount}
            </span>
            <button onClick={handleLike} className="flex items-center gap-1 hover:text-white">
              <Heart className={`h-3.5 w-3.5 ${liked ? "fill-red-500 text-red-500" : ""}`} />
              {story.likesCount + (liked ? 1 : 0)}
            </button>
            <button
              onClick={() => setShowReply(!showReply)}
              className="flex items-center gap-1 hover:text-white"
            >
              <Send className="h-3.5 w-3.5" />
              {story.repliesCount}
            </button>
          </div>

          {/* Reply form */}
          {showReply ? (
            <div className="flex gap-2 mb-2">
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Ответить кондитеру..."
                className="bg-white/10 border-white/20 text-white placeholder:text-white/50 text-sm min-h-[40px] max-h-[80px]"
                maxLength={500}
                autoFocus
              />
              <Button
                size="sm"
                onClick={handleReply}
                disabled={sendingReply || !replyText.trim()}
                className="bg-white text-black hover:bg-white/90"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setShowReply(true)}
              className="w-full text-left text-white/70 text-sm bg-white/10 rounded-full px-4 py-2 border border-white/20"
            >
              Ответить...
            </button>
          )}

          {/* Связанный товар */}
          {story.productId && (
            <button
              onClick={() => {
                onClose();
                navigate("product", { id: story.productId! });
              }}
              className="mt-2 w-full flex items-center gap-2 bg-white/10 rounded-lg p-2 border border-white/20 hover:bg-white/20 transition-colors"
            >
              <Plus className="h-4 w-4 text-white" />
              <span className="text-white text-xs">Посмотреть товар</span>
            </button>
          )}
        </div>

        {/* Side navigation arrows (desktop) */}
        <button
          onClick={goPrev}
          className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 z-30"
        >
          <ChevronLeft className="h-5 w-5 text-white" />
        </button>
        <button
          onClick={goNext}
          className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 z-30"
        >
          <ChevronRight className="h-5 w-5 text-white" />
        </button>
      </DialogContent>
    </Dialog>
  );
}
