"use client";

/**
 * AIDialogueAssistant — AI-ассистент для кондитера в чате.
 *
 * Показывает:
 *   - Контекст отношений (new/repeat/regular/vip)
 *   - Память о покупателе (предпочтения, аллергии, бюджет)
 *   - AI-подсказки ответов (адаптированные под тип отношений)
 *   - Кнопку "Обучить AI" — запускает анализ диалога
 *
 * Размещается сбоку от чата или как collapsible-панель.
 */
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Brain, Sparkles, Loader2, RefreshCw, Lightbulb,
  Heart, AlertTriangle, DollarSign, Calendar, User,
  ChevronDown, ChevronUp, TrendingUp, Copy,
} from "lucide-react";
import { toast } from "sonner";

interface RelationshipContext {
  relationshipType: string;
  ordersCount: number;
  chatsCount: number;
  trustScore: number;
  avgRating: number;
  preferences?: any;
}

interface Memory {
  id: string;
  memoryType: string;
  content: string;
  confidence: number;
  confirmed: boolean;
}

interface AIResponse {
  suggestion: string;
  reasoning: string;
  confidence: number;
  context?: {
    relationshipType: string;
    ordersCount: number;
    trustScore: number;
    memoriesCount: number;
  };
  extractedFacts?: Array<{ type: string; content: string; confidence: number }>;
}

const RELATIONSHIP_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  new: { label: "Новый клиент", color: "bg-blue-100 text-blue-800", icon: "🆕" },
  repeat: { label: "Повторный", color: "bg-amber-100 text-amber-800", icon: "🔁" },
  regular: { label: "Постоянный", color: "bg-emerald-100 text-emerald-800", icon: "⭐" },
  vip: { label: "VIP", color: "bg-purple-100 text-purple-800", icon: "👑" },
};

const MEMORY_ICONS: Record<string, any> = {
  preference: Heart,
  allergy: AlertTriangle,
  budget: DollarSign,
  event: Calendar,
  design: Sparkles,
  feedback: TrendingUp,
  personal: User,
};

export function AIDialogueAssistant({
  customerId,
  confectionerId,
  lastMessage,
  onUseSuggestion,
}: {
  customerId: string;
  confectionerId: string;
  lastMessage?: string;
  onUseSuggestion?: (text: string) => void;
}) {
  const [context, setContext] = useState<RelationshipContext | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [learning, setLearning] = useState(false);
  const [expanded, setExpanded] = useState(true);

  // Загрузка контекста
  const loadContext = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai-dialogue/context?customerId=${customerId}&confectionerId=${confectionerId}`);
      if (res.ok) {
        const data = await res.json();
        setContext(data.context);
        setMemories(data.memories || []);
        setRecommendations(data.recommendations || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [customerId, confectionerId]);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  // Генерация AI-ответа на новое сообщение
  const generateResponse = async () => {
    if (!lastMessage) {
      toast.info("Нет нового сообщения для анализа");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/ai-dialogue/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: lastMessage,
          customerId,
          confectionerId,
          chatHistory: [],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiResponse(data);
        if (data.extractedFacts?.length > 0) {
          toast.success(`AI извлёк ${data.extractedFacts.length} фактов из сообщения`);
        }
      }
    } catch (err) {
      toast.error("Ошибка AI");
    } finally {
      setGenerating(false);
    }
  };

  // Обучение на диалоге
  const handleLearn = async () => {
    setLearning(true);
    try {
      const res = await fetch("/api/ai-dialogue/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: "chat",
          customerId,
          confectionerId,
          messages: lastMessage ? [{ text: lastMessage, sender: "customer" }] : [],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`AI обучен: ${data.learned?.memoriesCreated || 0} новых фактов`);
        await loadContext(); // Перезагружаем контекст
      }
    } catch {
      toast.error("Ошибка обучения");
    } finally {
      setLearning(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Анализ отношений...
        </div>
      </Card>
    );
  }

  const relConfig = context
    ? RELATIONSHIP_CONFIG[context.relationshipType] || RELATIONSHIP_CONFIG.new
    : RELATIONSHIP_CONFIG.new;

  return (
    <Card className="p-3 space-y-3 bg-gradient-to-br from-purple-50/50 to-pink-50/30 border-purple-200">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold flex items-center gap-1">
              AI-ассистент
              <Badge variant="outline" className="text-[9px] bg-purple-50 text-purple-700">BETA</Badge>
            </div>
            <div className="text-[10px] text-muted-foreground">Самообучение диалогу</div>
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </div>

      {expanded && (
        <>
          {/* Контекст отношений */}
          {context && (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={`${relConfig.color} gap-1`}>
                {relConfig.icon} {relConfig.label}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {context.ordersCount} заказов
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                <TrendingUp className="h-2.5 w-2.5 mr-0.5" />
                {context.trustScore}% доверие
              </Badge>
              {context.avgRating > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  ⭐ {context.avgRating.toFixed(1)}
                </Badge>
              )}
            </div>
          )}

          {/* Память о клиенте */}
          {memories.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Память о клиенте ({memories.length})
              </div>
              {memories.slice(0, 5).map((m) => {
                const Icon = MEMORY_ICONS[m.memoryType] || Lightbulb;
                const isAllergy = m.memoryType === "allergy";
                return (
                  <div
                    key={m.id}
                    className={`flex items-start gap-1.5 text-xs p-1.5 rounded ${
                      isAllergy ? "bg-red-50 border border-red-200" : "bg-white/60"
                    }`}
                  >
                    <Icon className={`h-3 w-3 shrink-0 mt-0.5 ${isAllergy ? "text-red-500" : "text-muted-foreground"}`} />
                    <span className="flex-1">{m.content}</span>
                    {m.confidence > 0.7 && (
                      <span className="text-[8px] text-emerald-600 shrink-0">✓</span>
                    )}
                  </div>
                );
              })}
              {memories.length > 5 && (
                <div className="text-[10px] text-muted-foreground text-center">
                  +{memories.length - 5} ещё
                </div>
              )}
            </div>
          )}

          {/* Рекомендации */}
          {recommendations.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Рекомендации
              </div>
              {recommendations.slice(0, 3).map((rec, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs p-1.5 bg-amber-50 rounded">
                  <Lightbulb className="h-3 w-3 shrink-0 mt-0.5 text-amber-500" />
                  <span className="flex-1">{rec}</span>
                </div>
              ))}
            </div>
          )}

          {/* AI-подсказка ответа */}
          {aiResponse && (
            <div className="space-y-1.5 p-2 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-200">
              <div className="flex items-center gap-1 text-[10px] font-medium text-purple-700">
                <Sparkles className="h-3 w-3" />
                AI-предлагает ответ
              </div>
              <p className="text-xs leading-relaxed">{aiResponse.suggestion}</p>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-muted-foreground">
                  {aiResponse.reasoning} · {Math.round(aiResponse.confidence * 100)}%
                </span>
                {onUseSuggestion && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 text-[10px] gap-1"
                    onClick={() => {
                      onUseSuggestion(aiResponse.suggestion);
                      toast.success("Текст скопирован в поле ввода");
                    }}
                  >
                    <Copy className="h-2.5 w-2.5" />
                    Использовать
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Действия */}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={generateResponse}
              disabled={generating || !lastMessage}
              className="flex-1 gap-1 text-xs h-7 bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200"
            >
              {generating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3 text-purple-600" />
              )}
              Подсказать ответ
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleLearn}
              disabled={learning}
              className="gap-1 text-xs h-7"
              title="Обучить AI на этом диалоге"
            >
              {learning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Brain className="h-3 w-3" />
              )}
              Обучить
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={loadContext}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
