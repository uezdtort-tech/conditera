"use client";

import { useAppStore } from "@/lib/store";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ChevronLeft, Gift, Check, Mail, Phone, Printer, Sparkles } from "lucide-react";
import { GIFT_CERTIFICATE_DESIGNS, GIFT_CERTIFICATE_AMOUNTS } from "@/lib/mock-data-features";
import { formatCurrency, formatDate } from "@/lib/finance";
import { toast } from "sonner";

export function GiftCertificatesPage() {
  const navigate = useAppStore((s) => s.navigate);
  const certificates = useAppStore((s) => s.giftCertificates);
  const purchase = useAppStore((s) => s.purchaseGiftCertificate);
  const user = useAppStore((s) => s.user);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);

  const [showPurchase, setShowPurchase] = useState(false);
  const [amount, setAmount] = useState(5000);
  const [customAmount, setCustomAmount] = useState<number | null>(null);
  const [design, setDesign] = useState<string>("birthday");
  const [toName, setToName] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [toPhone, setToPhone] = useState("");
  const [message, setMessage] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"email" | "sms" | "print">("email");
  const [sendDate, setSendDate] = useState("");

  const handlePurchase = () => {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    if (!toName || !toEmail) {
      toast.error("Заполните имя и email получателя");
      return;
    }
    const finalAmount = customAmount || amount;
    purchase({
      amount: finalAmount,
      fromName: user.name,
      fromEmail: user.email,
      toName,
      toEmail,
      toPhone: toPhone || undefined,
      message: message || undefined,
      design: design as any,
      deliveryMethod,
      sendDate: sendDate || undefined,
    });
    toast.success("Сертификат приобретён!", {
      description: `Код отправлен на ${toEmail}`,
    });
    setShowPurchase(false);
    setToName("");
    setToEmail("");
    setToPhone("");
    setMessage("");
    setCustomAmount(null);
  };

  const myCertificates = certificates.filter((c) => c.fromEmail === user?.email);

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-5xl">
      <button onClick={() => navigate("home")} className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mb-4">
        <ChevronLeft className="h-4 w-4" /> На главную
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <Badge className="mb-2 bg-amber-100 text-amber-800 border-amber-200">
            <Gift className="h-3 w-3 mr-1" /> Подарочные сертификаты
          </Badge>
          <h1 className="font-display text-2xl lg:text-3xl font-bold">Подарите сладкий подарок</h1>
          <p className="text-muted-foreground mt-1">Электронный сертификат на любой номинал. Приходит на email сразу или в назначенную дату.</p>
        </div>
        <Button onClick={() => setShowPurchase(true)} className="shrink-0">
          <Gift className="h-4 w-4 mr-1" /> Купить сертификат
        </Button>
      </div>

      {/* Доступные номиналы */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {GIFT_CERTIFICATE_AMOUNTS.slice(0, 4).map((amt) => (
          <Card key={amt} className="p-4 text-center cursor-pointer hover:border-primary hover:shadow-md transition-all" onClick={() => { setAmount(amt); setShowPurchase(true); }}>
            <div className="text-3xl mb-1">🎁</div>
            <div className="font-display font-bold text-lg">{formatCurrency(amt)}</div>
            <div className="text-xs text-muted-foreground">электронный</div>
          </Card>
        ))}
      </div>

      {/* Преимущества */}
      <div className="grid sm:grid-cols-3 gap-3 mb-8">
        {[
          { icon: Mail, title: "Мгновенная доставка", desc: "На email за 1 секунду" },
          { icon: Sparkles, title: "5 дизайнов", desc: "День рождения, свадьба, Новый год" },
          { icon: Check, title: "Действует 1 год", desc: "Можно потратить частями" },
        ].map((f, i) => {
          const Icon = f.icon;
          return (
            <Card key={i} className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="font-medium text-sm">{f.title}</div>
                <div className="text-xs text-muted-foreground">{f.desc}</div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Мои сертификаты */}
      {myCertificates.length > 0 && (
        <div>
          <h2 className="font-display text-xl font-bold mb-4">Мои сертификаты</h2>
          <div className="space-y-3">
            {myCertificates.map((cert) => {
              const designInfo = GIFT_CERTIFICATE_DESIGNS.find((d) => d.id === cert.design);
              return (
                <Card key={cert.id} className={`p-4 bg-gradient-to-r ${designInfo?.color || "from-amber-400 to-primary"} text-white`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-2xl mb-1">{designInfo?.emoji || "🎁"}</div>
                      <div className="font-display font-bold text-2xl">{formatCurrency(cert.amount)}</div>
                      <div className="text-xs opacity-90 mt-1">
                        Кому: {cert.toName} • {cert.toEmail}
                      </div>
                      {cert.message && (
                        <div className="text-xs opacity-80 mt-1 italic">«{cert.message}»</div>
                      )}
                      <div className="text-xs opacity-70 mt-2">
                        Код: <code className="bg-white/20 px-1 rounded">{cert.code}</code>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge className={cert.status === "active" ? "bg-emerald-500" : "bg-slate-500"}>
                        {cert.status === "active" ? "Активен" : cert.status === "used" ? "Использован" : "Истёк"}
                      </Badge>
                      <div className="text-xs opacity-70 mt-1">до {formatDate(cert.expiresAt)}</div>
                      {cert.remainingAmount !== undefined && cert.remainingAmount < cert.amount && (
                        <div className="text-xs mt-1">Остаток: {formatCurrency(cert.remainingAmount)}</div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Purchase dialog */}
      {showPurchase && (
        <Dialog open onOpenChange={setShowPurchase}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Покупка сертификата</DialogTitle>
              <DialogDescription>Электронный сертификат с кодом. Действует 1 год.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {/* Amount */}
              <div>
                <Label>Номинал</Label>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {GIFT_CERTIFICATE_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      onClick={() => { setAmount(amt); setCustomAmount(null); }}
                      className={`p-2 text-sm rounded-lg border-2 transition-colors ${
                        !customAmount && amount === amt ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                    >
                      {amt >= 1000 ? `${amt / 1000}к` : amt} ₽
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Своя сумма</Label>
                <Input type="number" value={customAmount || ""} onChange={(e) => setCustomAmount(+e.target.value || null)} placeholder="Например, 7500" />
              </div>
              {/* Design */}
              <div>
                <Label>Дизайн</Label>
                <div className="grid grid-cols-5 gap-2 mt-2">
                  {GIFT_CERTIFICATE_DESIGNS.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setDesign(d.id)}
                      className={`p-2 rounded-lg border-2 transition-all ${
                        design === d.id ? "border-primary scale-105" : "border-border"
                      }`}
                    >
                      <div className="text-xl">{d.emoji}</div>
                      <div className="text-[9px] mt-0.5">{d.name}</div>
                    </button>
                  ))}
                </div>
              </div>
              {/* Recipient */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Имя получателя *</Label>
                  <Input value={toName} onChange={(e) => setToName(e.target.value)} placeholder="Мама" />
                </div>
                <div>
                  <Label>Email получателя *</Label>
                  <Input type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="mom@example.ru" />
                </div>
              </div>
              <div>
                <Label>Телефон (для SMS)</Label>
                <Input value={toPhone} onChange={(e) => setToPhone(e.target.value)} placeholder="+7 (___) ___-__-__" />
              </div>
              <div>
                <Label>Поздравление</Label>
                <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="С Днём Рождения! Пусть каждый день будет сладким ❤️" rows={2} />
              </div>
              {/* Delivery */}
              <div>
                <Label>Способ доставки</Label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {[
                    { id: "email", label: "Email", icon: Mail },
                    { id: "sms", label: "SMS", icon: Phone },
                    { id: "print", label: "Печать", icon: Printer },
                  ].map((m) => {
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setDeliveryMethod(m.id as any)}
                        className={`p-2 rounded-lg border-2 text-xs flex items-center justify-center gap-1 ${
                          deliveryMethod === m.id ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <Icon className="h-3 w-3" /> {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label>Дата отправки (необязательно)</Label>
                <Input type="date" value={sendDate} onChange={(e) => setSendDate(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">Оставьте пустым — отправим сразу</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPurchase(false)}>Отмена</Button>
              <Button onClick={handlePurchase}>
                Купить за {formatCurrency(customAmount || amount)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
