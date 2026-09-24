"use client";

/**
 * GiftMode — режим подарка (раздел 44, 62).
 *
 * Обёртка для checkout: выбор получателя, дата, сообщение.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Gift, Calendar, Mail, User } from "lucide-react";

export interface GiftData {
  recipientName?: string;
  recipientEmail?: string;
  deliveryDate?: string;
  message?: string;
  isAnonymous?: boolean;
}

interface GiftModeProps {
  data: GiftData;
  onChange: (data: GiftData) => void;
}

export function GiftMode({ data, onChange }: GiftModeProps): React.JSX.Element {
  const [enabled, setEnabled] = React.useState(false);

  if (!enabled) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Gift className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-sm">Это подарок?</h3>
            <p className="text-xs text-muted-foreground">Оформите заказ как подарок — добавим открытку</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEnabled(true)}>Оформить подарок</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 border-primary/30 bg-primary/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-primary" />
          <h3 className="font-medium text-sm">Режим подарка</h3>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { setEnabled(false); onChange({}); }}>Отмена</Button>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs flex items-center gap-1"><User className="h-3 w-3" /> Имя получателя</Label>
            <Input placeholder="Имя того, кому подарок" value={data.recipientName || ""} onChange={(e) => onChange({ ...data, recipientName: e.target.value })} className="text-sm" />
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1"><Mail className="h-3 w-3" /> Email получателя</Label>
            <Input type="email" placeholder="email@example.com" value={data.recipientEmail || ""} onChange={(e) => onChange({ ...data, recipientEmail: e.target.value })} className="text-sm" />
          </div>
        </div>

        <div>
          <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" /> Дата доставки подарка</Label>
          <Input type="date" value={data.deliveryDate || ""} onChange={(e) => onChange({ ...data, deliveryDate: e.target.value })} className="text-sm max-w-xs" />
        </div>

        <div>
          <Label className="text-xs">Текст открытки</Label>
          <Textarea placeholder="С днём рождения! Пусть этот торт сделает твой день ещё сладче..." value={data.message || ""} onChange={(e) => onChange({ ...data, message: e.target.value })} rows={3} className="text-sm" maxLength={200} />
          <span className="text-[10px] text-muted-foreground">{(data.message || "").length}/200</span>
        </div>

        <label className="flex items-center gap-2 cursor-pointer text-xs">
          <input type="checkbox" checked={data.isAnonymous || false} onChange={(e) => onChange({ ...data, isAnonymous: e.target.checked })} className="w-4 h-4" />
          <span>Анонимный подарок (получатель не узнает от кого)</span>
        </label>
      </div>
    </Card>
  );
}
