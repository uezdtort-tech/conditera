"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Send, MessageCircle, Phone, Video, MoreVertical, Bot, Sparkles, Mic, Square, X, Loader2 } from "lucide-react";
import { formatDateTime } from "@/lib/finance";
import type { QuickReply } from "@/lib/types";
import { useVoiceRecorder, formatDuration } from "@/hooks/useVoiceRecorder";
import { VoiceMessagePlayer } from "@/components/chat/voice-message-player";
import { useEffect, useRef, useState } from "react";

export function ChatWidget() {
  const chatOpen = useAppStore((s) => s.chatOpen);
  const setChatOpen = useAppStore((s) => s.setChatOpen);
  const chatRooms = useAppStore((s) => s.chatRooms);
  const chatMessages = useAppStore((s) => s.chatMessages);
  const activeChatRoom = useAppStore((s) => s.activeChatRoom);
  const setActiveChatRoom = useAppStore((s) => s.setActiveChatRoom);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const sendQuickReply = useAppStore((s) => s.sendQuickReply);
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);

  const [messageText, setMessageText] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Voice recorder
  const recorder = useVoiceRecorder({ maxDurationSec: 120, waveformSamples: 30 });
  const [showRecorder, setShowRecorder] = useState(false);

  const activeRoom = chatRooms.find((r) => r.id === activeChatRoom);
  const roomMessages = chatMessages.filter((m) => m.roomId === activeChatRoom);

  // Сохраняем идентификаторы показанных сообщений, чтобы дедуплицировать одинаковые id
  const seenMsgIdsRef = useRef<Set<string>>(new Set());

  // Последнее bot-сообщение с quick-replies (для отображения кнопок)
  const lastBotWithQuickReplies = [...roomMessages]
    .reverse()
    .find((m) => m.isBot && m.quickReplies && m.quickReplies.length > 0);

  // Скроллинг вниз при появлении новых сообщений И при переключении комнаты
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [roomMessages.length, activeChatRoom]);

  // Дедуплицируем сообщения по id, чтобы избежать одинаковых React-ключей
  const dedupedRoomMessages = (() => {
    const seen = new Set<string>();
    const out: typeof roomMessages = [];
    for (const m of roomMessages) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        out.push(m);
      }
    }
    return out;
  })();

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !activeChatRoom) return;
    if (!isAuthenticated) {
      setChatOpen(false);
      setAuthModalOpen(true);
      return;
    }
    sendMessage(activeChatRoom, messageText.trim());
    setMessageText("");
  };

  const handleQuickReply = (reply: QuickReply) => {
    if (!activeChatRoom) return;
    sendQuickReply(activeChatRoom, reply);
  };

  // AI-подсказка ответа (для кондитеров)
  const handleAiSuggestion = async () => {
    if (!activeRoom || roomMessages.length === 0) return;
    const lastCustomerMsg = [...roomMessages].reverse().find(m => !m.isOwn && !m.isBot);
    if (!lastCustomerMsg) return;

    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const res = await fetch("/api/ai-dialogue/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: lastCustomerMsg.text,
          customerId: lastCustomerMsg.senderId || "customer",
          confectionerId: user?.id || "confectioner",
          chatHistory: roomMessages.slice(-5).map(m => m.text),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiSuggestion(data.suggestion);
      }
    } catch {
      // Fallback — простая подсказка
      setAiSuggestion("Спасибо за сообщение! Уточните, пожалуйста, детали заказа — и я подберу для вас лучший вариант.");
    } finally {
      setAiLoading(false);
    }
  };

  const useAiSuggestion = () => {
    if (aiSuggestion) {
      setMessageText(aiSuggestion);
      setAiSuggestion(null);
    }
  };

  // === Voice recording ===
  const handleStartRecording = async () => {
    if (!isAuthenticated) {
      setChatOpen(false);
      setAuthModalOpen(true);
      return;
    }
    setShowRecorder(true);
    await recorder.start();
  };

  const handleStopRecording = async () => {
    const recording = await recorder.stop();
    setShowRecorder(false);
    if (recording && activeChatRoom) {
      // Создаём voice-сообщение и добавляем в store
      const voiceMsg = {
        id: `voice_${Date.now()}`,
        roomId: activeChatRoom,
        senderId: user?.id || "u1",
        senderName: user?.name || "Я",
        senderAvatar: user?.avatar,
        text: "🎤 Голосовое сообщение",
        createdAt: new Date().toISOString(),
        isOwn: true,
        voice: {
          url: recording.url,
          durationSec: recording.durationSec,
          waveform: recording.waveform,
        },
      };
      // Добавляем через store напрямую
      useAppStore.setState((s) => ({
        chatMessages: [...s.chatMessages, voiceMsg],
      }));
    }
  };

  const handleCancelRecording = () => {
    recorder.cancel();
    setShowRecorder(false);
  };

  return (
    <Sheet open={chatOpen} onOpenChange={setChatOpen}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col h-[100dvh] sm:h-[calc(100dvh-0px)]">
        <SheetHeader className="p-0 border-b shrink-0">
          <SheetTitle className="sr-only">Чат</SheetTitle>
          <div className="flex flex-1 min-h-0">
            {/* Sidebar — rooms list */}
            <div className="w-1/3 border-r min-w-[180px] flex flex-col">
              <div className="p-3 border-b">
                <h2 className="font-display font-bold text-sm">Сообщения</h2>
              </div>
              <ScrollArea className="flex-1">
                <div className="space-y-1 p-2">
                  {chatRooms.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => setActiveChatRoom(room.id)}
                      className={`w-full text-left p-2 rounded-lg transition-colors ${
                        activeChatRoom === room.id
                          ? "bg-primary/10"
                          : "hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={room.avatar} alt={room.name} />
                          <AvatarFallback className="text-[10px]">
                            {room.name.slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{room.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {room.lastMessage || "Нет сообщений"}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Main — active room */}
            <div className="flex-1 flex flex-col">
              {activeRoom ? (
                <>
                  {/* Header */}
                  <div className="p-3 border-b flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={activeRoom.avatar} alt={activeRoom.name} />
                        <AvatarFallback className="text-xs">
                          {activeRoom.name.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium">{activeRoom.name}</div>
                        <div className="text-[10px] text-emerald-600 flex items-center gap-1">
                          ● онлайн
                          {activeRoom.type === "order" && (
                            <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 h-3.5">
                              <Bot className="h-2.5 w-2.5 mr-0.5" />
                              авточат
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Phone className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Video className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Messages */}
                  <ScrollArea className="flex-1 bg-muted/30 min-h-0 overflow-y-auto" ref={scrollContainerRef}>
                    <div className="p-3 space-y-2">
                      {dedupedRoomMessages.map((msg, idx) => {
                        // Уникальный ключ: id + индекс + первые 20 символов текста для гарантии уникальности
                        const uniqueKey = `${msg.id}-${idx}-${(msg.text || "").slice(0, 20).replace(/\s/g, "_")}`;
                        return (
                        <div
                          key={uniqueKey}
                          className={`flex gap-2 ${
                            msg.isOwn ? "flex-row-reverse" : ""
                          }`}
                        >
                          {!msg.isOwn && (
                            <Avatar className="h-7 w-7 shrink-0">
                              <AvatarImage src={msg.senderAvatar} alt={msg.senderName} />
                              <AvatarFallback className={`text-[10px] ${msg.isBot ? "bg-primary/15" : ""}`}>
                                {msg.isBot ? <Bot className="h-3.5 w-3.5" /> : msg.senderName.slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          <div className="flex flex-col gap-1 max-w-[75%]">
                            <div
                              className={`rounded-2xl px-3 py-2 ${
                                msg.isOwn
                                  ? "bg-primary text-primary-foreground rounded-br-md"
                                  : msg.isBot
                                  ? "bg-gradient-to-br from-primary/5 to-accent/30 border border-primary/20 rounded-bl-md"
                                  : "bg-card border border-border rounded-bl-md"
                              }`}
                            >
                              {msg.isBot && !msg.isOwn && (
                                <div className="flex items-center gap-1 mb-1 text-[10px] text-primary font-medium">
                                  <Sparkles className="h-2.5 w-2.5" />
                                  {msg.senderName}
                                  {msg.botKind === "escalation" && (
                                    <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0 h-3">
                                      оператор
                                    </Badge>
                                  )}
                                </div>
                              )}
                              {msg.voice ? (
                                <VoiceMessagePlayer
                                  url={msg.voice.url}
                                  durationSec={msg.voice.durationSec}
                                  waveform={msg.voice.waveform}
                                  isOwn={msg.isOwn}
                                />
                              ) : (
                                <div className="text-xs leading-relaxed whitespace-pre-wrap">
                                  {msg.text}
                                </div>
                              )}
                              <div
                                className={`text-[9px] mt-1 ${
                                  msg.isOwn
                                    ? "text-primary-foreground/70"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {formatDateTime(msg.createdAt)}
                              </div>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  </ScrollArea>

                  {/* Quick replies — показываем только под последним bot-сообщением с ними */}
                  {lastBotWithQuickReplies && lastBotWithQuickReplies.quickReplies && (
                    <div className="px-3 pt-2 border-t bg-background/50">
                      <div className="flex flex-wrap gap-1.5 py-2">
                        {lastBotWithQuickReplies.quickReplies.map((reply, i) => (
                          <button
                            key={i}
                            onClick={() => handleQuickReply(reply)}
                            className="px-3 py-1.5 text-xs rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-colors text-primary"
                          >
                            {reply.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI-подсказка */}
                  {aiSuggestion && (
                    <div className="px-3 pt-2 border-t bg-purple-50/50">
                      <div className="flex items-start gap-2 py-2">
                        <div className="h-6 w-6 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
                          <Sparkles className="h-3 w-3 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-purple-900">{aiSuggestion}</p>
                          <div className="flex gap-1 mt-1">
                            <button onClick={useAiSuggestion} className="text-[10px] text-purple-600 font-medium hover:underline">Использовать</button>
                            <button onClick={() => setAiSuggestion(null)} className="text-[10px] text-muted-foreground hover:underline">Отклонить</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Input — текст или voice-recorder */}
                  {showRecorder || recorder.isRecording ? (
                    <div className="p-3 border-t flex items-center gap-2 bg-red-50/30">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleCancelRecording}
                        className="h-10 w-10 shrink-0 text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <div className="flex-1 flex items-center gap-2">
                        <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-500 transition-all"
                            style={{ width: `${Math.min(100, recorder.level * 200)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono tabular-nums text-red-600">
                          {formatDuration(recorder.elapsedSec)}
                        </span>
                      </div>
                      <Button
                        size="icon"
                        onClick={handleStopRecording}
                        className="h-10 w-10 shrink-0 bg-red-500 hover:bg-red-600"
                      >
                        <Square className="h-4 w-4 fill-current" />
                      </Button>
                    </div>
                  ) : (
                    <form
                      onSubmit={handleSend}
                      className="p-3 border-t flex items-center gap-2"
                    >
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={handleAiSuggestion}
                        disabled={aiLoading || !activeRoom || roomMessages.length === 0}
                        className="h-10 w-10 shrink-0 text-purple-600 hover:bg-purple-50"
                        title="AI-подсказка ответа"
                      >
                        {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      </Button>
                      <Input
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        placeholder="Сообщение..."
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={handleStartRecording}
                        className="h-10 w-10 shrink-0 text-muted-foreground hover:text-primary"
                        title="Записать голосовое сообщение"
                      >
                        <Mic className="h-4 w-4" />
                      </Button>
                      <Button
                        type="submit"
                        size="icon"
                        disabled={!messageText.trim()}
                        className="h-10 w-10 shrink-0"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </form>
                  )}
                  {recorder.error && (
                    <div className="px-3 pb-2 text-xs text-destructive">
                      {recorder.error}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <MessageCircle className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Выберите чат</h3>
                    <p className="text-sm text-muted-foreground">
                      Выберите диалог слева, чтобы начать общение
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
