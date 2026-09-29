"use client";

/**
 * AiAskProduct — компактный блок «Помочь выбрать» в карточке товара (сценарий №2).
 *
 * Отвечает на вопросы ТОЛЬКО по данным карточки (grounding на сервере).
 * Нет данных в карточке → ИИ скажет «данных недостаточно, уточните у мастера».
 * Не подменяет подтверждение продавца: аллергены, даты, наличие — за мастером.
 */
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Sparkles, Send, Loader2, ChevronDown, Info } from "lucide-react";
import { toast } from "sonner";
import { getCsrfToken } from "@/lib/api-client";
import type { Product } from "@/lib/types";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const QUICK_QUESTIONS = [
  "На сколько человек хватит?",
  "Есть ли орехи в составе?",
  "Сколько хранится?",
  "Какой срок изготовления?",
];

export function AiAskProduct({ productId, product }: { productId: string; product?: Product }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [missingInfo, setMissingInfo] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    const nextMessages: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      // CSRF double-submit: мутации требуют header x-csrf-token
      const csrf = await getCsrfToken();
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({
          productId,
          question: q,
          history: nextMessages.slice(-7, -1),
          // Snapshot карточки — фоллбэк для сервера, когда БД витрины недоступна
          product: product
            ? {
                id: product.id,
                title: product.title,
                description: product.description,
                price: product.price,
                weight: product.weight,
                servings: product.servings,
                tags: product.tags,
                rating: product.rating,
                composition: product.composition,
              }
            : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Не удалось получить ответ");
      }
      const data = (await res.json()) as { answer: string; missingInfo?: string[] };
      setMessages([...nextMessages, { role: "assistant", content: data.answer }]);
      setMissingInfo(data.missingInfo || []);
      requestAnimationFrame(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка соединения с ИИ");
      setMessages(nextMessages); // оставляем вопрос пользователя
    } finally {
      setLoading(false);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-purple-200 bg-purple-50/40 dark:bg-purple-950/20 dark:border-purple-900">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-purple-600" />
            Помочь выбрать?
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-1.5">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="px-2.5 py-1 rounded-full border border-purple-200 bg-background text-xs text-purple-700 hover:bg-purple-50 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`text-sm leading-relaxed rounded-lg px-3 py-2 ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground ml-8 rounded-br-sm"
                    : "bg-background mr-4 rounded-bl-sm border"
                }`}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="text-muted-foreground text-xs flex items-center gap-1.5 px-1">
                <Loader2 className="h-3 w-3 animate-spin" /> ИИ отвечает…
              </div>
            )}
            <div ref={scrollRef} />
          </div>

          {missingInfo.length > 0 && (
            <div className="text-[11px] text-muted-foreground">
              В карточке нет данных: {missingInfo.join(", ")} — уточните у мастера.
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Спросите о составе, порциях, хранении…"
              aria-label="Вопрос по товару"
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/40"
            />
            <Button
              type="submit"
              size="icon"
              disabled={loading || !input.trim()}
              className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              aria-label="Отправить вопрос"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>

          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            ИИ отвечает по данным карточки и не заменяет подтверждение продавца:
            аллергены, сроки и доступность подтверждает мастер.
          </p>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
