"use client";

/**
 * AICakeFinder — AI-консультант по подбору торта.
 *
 * Чат-виджет на главной странице:
 *   3-5 вопросов → персональные рекомендации → переход к товару
 */
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles, Send, Loader2, X, Cake, Star } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Recommendation {
  id: string;
  title: string;
  reason: string;
  priceFrom: number;
  image?: string;
  rating?: number;
}

export function AICakeFinderButton() {
  const [open, setOpen] = useState(false);
  const navigate = useAppStore((s) => s.navigate);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
        size="lg"
      >
        <Sparkles className="h-4 w-4" />
        Подобрать торт через AI
      </Button>

      <AICakeFinderDialog
        open={open}
        onOpenChange={setOpen}
        onNavigate={(productId) => {
          setOpen(false);
          navigate("product", { id: productId });
        }}
      />
    </>
  );
}

function AICakeFinderDialog({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onNavigate: (productId: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [stage, setStage] = useState("questioning");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      // Стартовое сообщение
      sendMessage("Здравствуйте, хочу подобрать торт", true);
    }
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (text: string, isInitial = false) => {
    const newMessages = isInitial ? [] : [...messages, { role: "user" as const, content: text }];
    if (!isInitial) setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai-cake-finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.length > 0 ? newMessages : [{ role: "user", content: text }],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages([...newMessages, { role: "assistant", content: data.reply }]);
        setStage(data.stage);
        if (data.recommendations?.length > 0) {
          setRecommendations(data.recommendations);
        }
      } else {
        setMessages([...newMessages, { role: "assistant", content: "Извините, не удалось получить ответ. Попробуйте ещё раз." }]);
      }
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "Ошибка соединения с AI." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setMessages([]);
    setRecommendations([]);
    setStage("questioning");
    sendMessage("Здравствуйте, хочу подобрать торт", true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-4 border-b bg-gradient-to-r from-purple-600 to-pink-600 text-white">
          <DialogTitle className="flex items-center gap-2 text-white">
            <Sparkles className="h-5 w-5" />
            AI-консультант по тортам
          </DialogTitle>
        </DialogHeader>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px] max-h-[400px]">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted rounded-bl-sm"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted p-3 rounded-2xl rounded-bl-sm">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Cake className="h-3 w-3" />
                Рекомендованные торты:
              </div>
              {recommendations.map((rec) => (
                <Card
                  key={rec.id}
                  className="p-2 flex gap-2 cursor-pointer hover:border-primary/40 transition-colors"
                  onClick={() => onNavigate(rec.id)}
                >
                  {rec.image && (
                    <img src={rec.image} alt={rec.title} className="h-12 w-12 rounded object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{rec.title}</div>
                    <div className="text-xs text-muted-foreground">{rec.reason}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-sm font-bold text-primary">{rec.priceFrom}₽</span>
                      {rec.rating && (
                        <span className="flex items-center gap-0.5 text-[10px]">
                          <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                          {rec.rating}
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div ref={scrollRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim() && !loading) {
                sendMessage(input.trim());
              }
            }}
            placeholder="Напишите ответ..."
            className="flex-1 px-3 py-2 border rounded-full text-sm bg-background"
            disabled={loading || stage === "done"}
          />
          <Button
            size="icon"
            onClick={() => input.trim() && sendMessage(input.trim())}
            disabled={loading || !input.trim()}
            className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600"
          >
            <Send className="h-4 w-4" />
          </Button>
          {stage === "done" && (
            <Button size="icon" variant="ghost" onClick={handleReset} className="rounded-full">
              <Sparkles className="h-4 w-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
