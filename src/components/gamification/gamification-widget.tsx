"use client";

/**
 * GamificationWidget — виджет бейджей и челленджей для дашборда покупателя.
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Trophy, Gift, Sparkles, Loader2, Check, Lock, Flame,
} from "lucide-react";
import { toast } from "sonner";

interface BadgeData {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  rarity: string;
  rewardPoints: number;
  earned: boolean;
  awardedAt?: string;
}

interface ChallengeData {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  goalType: string;
  goalValue: number;
  rewardPoints: number;
  rewardType?: string;
  rewardValue?: number;
  endsAt: string;
  progress: number;
  completed: boolean;
  rewardClaimed: boolean;
  percent: number;
}

const RARITY_COLORS: Record<string, string> = {
  common: "from-gray-400 to-gray-600",
  rare: "from-blue-400 to-blue-600",
  epic: "from-purple-400 to-purple-600",
  legendary: "from-amber-400 to-amber-600",
};

const RARITY_LABELS: Record<string, string> = {
  common: "Обычный",
  rare: "Редкий",
  epic: "Эпический",
  legendary: "Легендарный",
};

const CATEGORY_LABELS: Record<string, string> = {
  orders: "Заказы",
  reviews: "Отзывы",
  social: "Социальные",
  loyalty: "Лояльность",
  special: "Особые",
};

export function GamificationWidget() {
  const [badges, setBadges] = useState<BadgeData[]>([]);
  const [challenges, setChallenges] = useState<ChallengeData[]>([]);
  const [stats, setStats] = useState({ earned: 0, total: 0, percent: 0 });
  const [loading, setLoading] = useState(true);
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [badgesRes, challengesRes] = await Promise.all([
        fetch("/api/gamification/badges"),
        fetch("/api/gamification/challenges"),
      ]);

      if (badgesRes.ok) {
        const data = await badgesRes.json();
        setBadges(data.allBadges.map((b: any) => ({
          ...b,
          earned: data.userBadges.some((ub: any) => ub.badge?.code === b.code),
          awardedAt: data.userBadges.find((ub: any) => ub.badge?.code === b.code)?.awardedAt,
        })));
        setStats(data.stats);
      }

      if (challengesRes.ok) {
        const data = await challengesRes.json();
        setChallenges(data.challenges);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async (challengeId: string) => {
    setClaiming(challengeId);
    try {
      const res = await fetch(`/api/gamification/challenges/${challengeId}/claim`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(data.message || "Награда получена! 🎉");
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Ошибка");
      }
    } catch (err) {
      toast.error("Ошибка сети");
    } finally {
      setClaiming(null);
    }
  };

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="h-5 w-5 text-amber-500" />
          <h3 className="font-semibold">Достижения</h3>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-square rounded-full bg-muted animate-pulse" />
          ))}
        </div>
      </Card>
    );
  }

  const earnedBadges = badges.filter((b) => b.earned);
  const lockedBadges = badges.filter((b) => !b.earned);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            <h3 className="font-semibold">Бейджи</h3>
            <Badge variant="outline" className="text-[10px]">
              {stats.earned} / {stats.total}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Progress value={stats.percent} className="h-2 w-20" />
            <span className="text-xs text-muted-foreground">{stats.percent}%</span>
          </div>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mb-3">
          {earnedBadges.slice(0, 8).map((badge) => (
            <BadgeCard key={badge.id} badge={badge} />
          ))}
          {earnedBadges.length === 0 && (
            <div className="col-span-full text-center py-4 text-muted-foreground text-sm">
              Пока нет бейджей — оформите первый заказ!
            </div>
          )}
        </div>

        {lockedBadges.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-2">Скоро:</div>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {lockedBadges.slice(0, 4).map((badge) => (
                <BadgeCard key={badge.id} badge={badge} />
              ))}
            </div>
          </div>
        )}

        {badges.length > 8 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2"
            onClick={() => setShowAllBadges(true)}
          >
            Показать все ({badges.length})
          </Button>
        )}
      </Card>

      {challenges.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="h-5 w-5 text-orange-500" />
            <h3 className="font-semibold">Челленджи</h3>
            <Badge variant="outline" className="text-[10px]">
              {challenges.filter((c) => c.completed && !c.rewardClaimed).length} наград
            </Badge>
          </div>

          <div className="space-y-3">
            {challenges.map((ch) => (
              <ChallengeCard
                key={ch.id}
                challenge={ch}
                onClaim={() => handleClaim(ch.id)}
                claiming={claiming === ch.id}
              />
            ))}
          </div>
        </Card>
      )}

      <Dialog open={showAllBadges} onOpenChange={setShowAllBadges}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              Все бейджи ({badges.length})
            </DialogTitle>
            <DialogDescription>
              Получено: {stats.earned} из {stats.total} · Прогресс {stats.percent}%
            </DialogDescription>
          </DialogHeader>

          {Object.entries(
            badges.reduce((acc, b) => {
              const cat = b.category || "other";
              if (!acc[cat]) acc[cat] = [];
              acc[cat].push(b);
              return acc;
            }, {} as Record<string, BadgeData[]>)
          ).map(([cat, catBadges]) => (
            <div key={cat}>
              <h4 className="text-sm font-semibold mb-2 text-muted-foreground">
                {CATEGORY_LABELS[cat] || cat} ({catBadges.filter((b) => b.earned).length}/{catBadges.length})
              </h4>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
                {catBadges.map((badge) => (
                  <BadgeCard key={badge.id} badge={badge} detailed />
                ))}
              </div>
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BadgeCard({ badge, detailed }: { badge: BadgeData; detailed?: boolean }) {
  const rarityGradient = RARITY_COLORS[badge.rarity] || RARITY_COLORS.common;
  const timeAgo = badge.awardedAt
    ? new Date(badge.awardedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
    : null;

  return (
    <div
      className={`flex flex-col items-center text-center p-2 rounded-lg transition-all ${
        badge.earned ? "hover:scale-105" : "opacity-40 grayscale"
      }`}
      title={badge.description}
    >
      <div className={`h-12 w-12 rounded-full bg-gradient-to-br ${rarityGradient} flex items-center justify-center text-2xl shadow-md`}>
        {badge.earned ? badge.icon : <Lock className="h-5 w-5 text-white" />}
      </div>
      <div className="text-[10px] font-medium mt-1 line-clamp-2 leading-tight">
        {badge.name}
      </div>
      {detailed && (
        <>
          <div className="text-[9px] text-muted-foreground mt-0.5">
            {RARITY_LABELS[badge.rarity]}
          </div>
          {badge.rewardPoints > 0 && (
            <div className="text-[9px] text-amber-600">+{badge.rewardPoints} бонусов</div>
          )}
          {badge.earned && timeAgo && (
            <div className="text-[9px] text-emerald-600">{timeAgo}</div>
          )}
        </>
      )}
    </div>
  );
}

function ChallengeCard({
  challenge,
  onClaim,
  claiming,
}: {
  challenge: ChallengeData;
  onClaim: () => void;
  claiming: boolean;
}) {
  const daysLeft = Math.max(0, Math.ceil((new Date(challenge.endsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

  return (
    <div
      className={`p-3 rounded-lg border ${
        challenge.completed
          ? challenge.rewardClaimed
            ? "border-emerald-200 bg-emerald-50/30"
            : "border-amber-300 bg-amber-50/50"
          : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="h-10 w-10 rounded-lg flex items-center justify-center text-xl shrink-0"
          style={{ backgroundColor: `${challenge.color}20` }}
        >
          {challenge.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-sm font-medium truncate">{challenge.name}</span>
            <Badge variant="outline" className="text-[9px] shrink-0">{daysLeft} дн</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-2">{challenge.description}</p>

          <div className="flex items-center gap-2">
            <Progress value={challenge.percent} className="h-2 flex-1" />
            <span className="text-[10px] text-muted-foreground shrink-0">
              {challenge.progress} / {challenge.goalValue}
            </span>
          </div>

          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1 text-xs">
              <Gift className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-muted-foreground">
                {challenge.rewardPoints > 0 && `+${challenge.rewardPoints} бонусов`}
                {challenge.rewardType === "discount" && `Скидка ${challenge.rewardValue || 0}%`}
              </span>
            </div>

            {challenge.completed && !challenge.rewardClaimed && (
              <Button
                size="sm"
                onClick={onClaim}
                disabled={claiming}
                className="gap-1 h-7 text-xs bg-gradient-to-r from-amber-500 to-orange-500"
              >
                {claiming ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                Забрать
              </Button>
            )}
            {challenge.rewardClaimed && (
              <Badge className="bg-emerald-100 text-emerald-800 text-[10px] gap-1">
                <Check className="h-2.5 w-2.5" />
                Получено
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
