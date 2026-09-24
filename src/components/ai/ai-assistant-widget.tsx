"use client";

/**
 * ai-assistant-widget.tsx — плавающий виджет AI-помощника.
 *
 * Функциональность:
 *   - FAB-кнопка внизу справа (с badge непрочитанных уведомлений)
 *   - Раскрывается в чат-окно (Sheet снизу или Dialog)
 *   - История сообщений с ролями user/assistant
 *   - Создание нового диалога или продолжение последнего
 *   - Thumbs up/down для последнего ответа (через /api/ai-assistant/feedback)
 *   - Кнопка "История диалогов" для просмотра прошлых бесед
 *   - Индикатор "AI печатает..." во время ожидания ответа
 *   - Минимизация/закрытие виджета
 *
 * Использует:
 *   - /api/ai-assistant/chat (POST)
 *   - /api/ai-assistant/conversations (GET для истории)
 *   - /api/ai-assistant/feedback (POST thumbs up/down)
 *   - z-ai-web-dev-sdk через API route (серверная сторона)
 *
 * Доступность:
 *   - Виден всем аутентифицированным пользователям
 *   - Подсказки ролевые (CUSTOMER видит "помочь подобрать торт",
 *     CONFECTIONER — "помочь с рецептом" и т.д.)
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bot, Send, X, ThumbsUp, ThumbsDown, MessageSquare,
  Sparkles, Clock, ChevronDown, History, Plus, Loader2,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { user_role, AIAssistantConversation } from "@/lib/supabase/types";

const STORAGE_OPEN_KEY = "ai-widget-open";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  logId?: number;
  feedbackGiven?: boolean;
}

interface ChatResponse {
  data: {
    conversation_id: string;
    message: string;
    request_type: string;
    log_id: number;
    model_used: string;
    latency_ms: number;
  };
  meta: {
    input_tokens: number | null;
    output_tokens: number | null;
  };
  error?: {
    code: string;
    message: string;
  };
}

const ROLE_PROMPTS: Partial<Record<user_role, string>> = {
  CUSTOMER: "Привет! Могу помочь подобрать торт, рассчитать цену или спланировать заказ 🎂",
  CONFECTIONER: "Готов помочь с рецептами, расчётом себестоимости или планированием загрузки 🧁",
  COURIER: "Подскажу с маршрутом, статусом доставки или общением с клиентом 🚗",
  SUPPLIER: "Помогу с управлением складом, тендерами или ценообразованием 📦",
  ADMIN: "Готов помочь с аналитикой, прогнозами и масштабированием платформы 📊",
  FRANCHISEE: "Помогу с управлением сетью, контролем качества и отчётами 🏪",
};

/**
 * Отправить сообщение в AI-помощник.
 */
function useSendMessage() {
  return useMutation({
    mutationFn: async (input: {
      message: string;
      conversation_id: string | null;
      role_context?: user_role;
    }): Promise<ChatResponse> => {
      const response = await fetch("/api/ai-assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input.message,
          conversation_id: input.conversation_id,
          role_context: input.role_context,
          request_type: "chat",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return data as ChatResponse;
    },
  });
}

/**
 * Отправить feedback (thumbs up/down) на последний ответ.
 */
function useSendFeedback() {
  return useMutation({
    mutationFn: async (input: {
      log_id: number;
      was_helpful: boolean;
      feedback_text?: string;
    }) => {
      const response = await fetch("/api/ai-assistant/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      // Тихо — без toast, чтобы не отвлекать
    },
    onError: (err: Error) => {
      console.warn("[ai-widget] feedback error:", err.message);
    },
  });
}

/**
 * Загрузить последние диалоги.
 */
function useRecentConversations() {
  return useQuery<AIAssistantConversation[]>({
    queryKey: ["ai-assistant", "conversations"],
    queryFn: async () => {
      const response = await fetch("/api/ai-assistant/conversations?limit=10");
      if (!response.ok) return [];
      const json = await response.json();
      return (json.data || []) as AIAssistantConversation[];
    },
    enabled: false, // только при открытии истории
  });
}

/**
 * AIAssistantWidget — главный экспорт.
 * Рендерится глобально в RootLayout.
 */
export function AIAssistantWidget(): React.JSX.Element {
  const user = useAppStore((s) => s.user);
  const [isOpen, setIsOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);

  const sendMutation = useSendMessage();
  const feedbackMutation = useSendFeedback();
  const conversationsQ = useRecentConversations();

  // Сохранить состояние в localStorage чтобы не терялось при перезагрузке
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_OPEN_KEY);
      if (saved === "true") setIsOpen(true);
    } catch {}
  }, []);

  // Определить начальную подсказку по роли пользователя
  const userRole: user_role = (user?.roles?.[0] as user_role) || "CUSTOMER";
  const initialPrompt = ROLE_PROMPTS[userRole] || "Чем могу помочь?";

  // Добавить приветственное сообщение при первом открытии
  React.useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        {
          role: "assistant",
          content: initialPrompt,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  }, [isOpen, messages.length, initialPrompt]);

  const sendMessage = async () => {
    const message = input.trim();
    if (!message || sendMutation.isPending) return;

    // Добавить сообщение пользователя сразу (optimistic UI)
    const userMsg: ChatMessage = {
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    try {
      const response = await sendMutation.mutateAsync({
        message,
        conversation_id: conversationId,
        role_context: userRole,
      });

      setConversationId(response.data.conversation_id);

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: response.data.message || response.error?.message || "Извините, не удалось получить ответ",
        timestamp: new Date().toISOString(),
        logId: response.data.log_id,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: `⚠ Ошибка: ${err?.message || "не удалось связаться с AI"}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  };

  const startNewConversation = () => {
    setMessages([
      {
        role: "assistant",
        content: initialPrompt,
        timestamp: new Date().toISOString(),
      },
    ]);
    setConversationId(null);
    setShowHistory(false);
  };

  const giveFeedback = async (msg: ChatMessage, wasHelpful: boolean) => {
    if (!msg.logId || msg.feedbackGiven) return;

    try {
      await feedbackMutation.mutateAsync({
        log_id: msg.logId,
        was_helpful: wasHelpful,
      });
      // Пометить что feedback уже дан
      setMessages((prev) =>
        prev.map((m) =>
          m.logId === msg.logId ? { ...m, feedbackGiven: true } : m
        )
      );
      toast.success(wasHelpful ? "Спасибо за отзыв! 👍" : "Спасибо, учту замечание 👎", {
        duration: 2000,
      });
    } catch {
      // silent fail
    }
  };

  // Не показывать виджет для неавторизованных
  if (!user) return <></>;

  return (
    <>
      {/* FAB — плавающая кнопка внизу справа */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-full shadow-lg hover:scale-105 transition-transform"
          aria-label="Открыть AI-помощник"
        >
          <Bot className="w-6 h-6" />
          <span className="font-medium hidden sm:inline">AI-помощник</span>
          <Sparkles className="w-4 h-4" />
        </button>
      )}

      {/* Чат-окно */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[calc(100vw-3rem)] sm:w-[420px] max-h-[600px]">
          <Card className="flex flex-col h-full max-h-[600px] overflow-hidden border-2 border-amber-200/50 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white">
              <div className="flex items-center gap-2">
                <Avatar className="w-8 h-8 bg-white/20 border-0">
                  <AvatarFallback className="bg-transparent text-white">
                    <Bot className="w-5 h-5" />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold text-sm">AI-помощник</div>
                  <div className="text-xs opacity-90">
                    {sendMutation.isPending ? "Печатает..." : "Готов помочь"}
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={() => setShowHistory(!showHistory)}
                  title="История диалогов"
                >
                  <History className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={startNewConversation}
                  title="Новый диалог"
                >
                  <Plus className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={() => setIsOpen(false)}
                  title="Свернуть"
                >
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* История диалогов (временно overlay) */}
            {showHistory && (
              <div className="border-b bg-muted/30 p-2 max-h-40 overflow-y-auto">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Последние диалоги
                </div>
                {conversationsQ.isFetching ? (
                  <div className="text-xs text-muted-foreground">Загрузка...</div>
                ) : (conversationsQ.data || []).length === 0 ? (
                  <div className="text-xs text-muted-foreground">Пока нет сохранённых диалогов</div>
                ) : (
                  (conversationsQ.data || []).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setConversationId(c.id);
                        setShowHistory(false);
                        toast.info(`Загружаем диалог: ${c.title || "Без названия"}`);
                      }}
                      className="w-full text-left p-2 hover:bg-accent rounded text-sm"
                    >
                      <div className="font-medium truncate">{c.title || "Без названия"}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(c.last_message_at || c.created_at).toLocaleDateString("ru-RU")}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Сообщения */}
            <ScrollArea className="flex-1 p-3 min-h-[200px]">
              <div className="space-y-3">
                {messages.map((msg, idx) => (
                  <MessageBubble
                    key={idx}
                    message={msg}
                    isLastAssistant={
                      msg.role === "assistant" &&
                      idx === messages.length - 1 &&
                      msg.logId !== undefined
                    }
                    onFeedback={(helpful) => giveFeedback(msg, helpful)}
                    feedbackPending={feedbackMutation.isPending}
                  />
                ))}
                {sendMutation.isPending && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>AI думает...</span>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="p-3 border-t bg-card">
              <div className="flex gap-2 items-end">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Опишите, что вы ищете..."
                  rows={1}
                  className="resize-none min-h-[40px] max-h-32"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  disabled={sendMutation.isPending}
                />
                <Button
                  size="icon"
                  onClick={sendMessage}
                  disabled={!input.trim() || sendMutation.isPending}
                  className="bg-amber-600 hover:bg-amber-700 shrink-0"
                >
                  {sendMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 text-center">
                Enter — отправить, Shift+Enter — новая строка
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

/**
 * Сообщение в чате с ролью user/assistant.
 */
function MessageBubble({
  message,
  isLastAssistant,
  onFeedback,
  feedbackPending,
}: {
  message: ChatMessage;
  isLastAssistant: boolean;
  onFeedback: (helpful: boolean) => void;
  feedbackPending: boolean;
}): React.JSX.Element {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <Avatar className="w-8 h-8 shrink-0">
        {isUser ? (
          <AvatarFallback className="bg-amber-100 text-amber-700">Я</AvatarFallback>
        ) : (
          <AvatarFallback className="bg-gradient-to-br from-amber-500 to-orange-600 text-white">
            <Bot className="w-5 h-5" />
          </AvatarFallback>
        )}
      </Avatar>

      <div className={`flex-1 max-w-[85%] ${isUser ? "text-right" : ""}`}>
        <div
          className={`inline-block px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
            isUser
              ? "bg-amber-600 text-white"
              : "bg-muted text-foreground"
          }`}
        >
          {message.content}
        </div>
        <div className={`text-[10px] text-muted-foreground mt-0.5 ${isUser ? "text-right" : ""}`}>
          {new Date(message.timestamp).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>

        {/* Feedback buttons только для последнего ответа AI */}
        {isLastAssistant && !message.feedbackGiven && (
          <div className="flex gap-2 mt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => onFeedback(true)}
              disabled={feedbackPending}
              title="Хороший ответ"
            >
              <ThumbsUp className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => onFeedback(false)}
              disabled={feedbackPending}
              title="Плохой ответ"
            >
              <ThumbsDown className="w-3 h-3" />
            </Button>
          </div>
        )}

        {/* Подтверждение feedback */}
        {message.feedbackGiven && (
          <Badge variant="secondary" className="text-[10px] mt-1">
            ✓ Спасибо за отзыв
          </Badge>
        )}
      </div>
    </div>
  );
}
