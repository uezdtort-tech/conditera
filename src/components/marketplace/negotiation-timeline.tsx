"use client";

/**
 * NegotiationTimeline — timeline переговоров (раздел 18, 62).
 *
 * Вертикальный timeline процесса: request → quote → counter → accept/decline.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Send, Receipt, RefreshCw, Check, X, Clock, MessageSquare,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/finance";

export interface TimelineEvent {
  id: string;
  type: "request" | "quote" | "counter" | "message" | "accept" | "decline" | "expire";
  label: string;
  description?: string;
  price?: number;
  timestamp: string;
  actor?: string;
}

interface NegotiationTimelineProps {
  events: TimelineEvent[];
  currentStatus?: string;
}

const EVENT_ICONS: Record<string, typeof Send> = {
  request: Send,
  quote: Receipt,
  counter: RefreshCw,
  message: MessageSquare,
  accept: Check,
  decline: X,
  expire: Clock,
};

const EVENT_COLORS: Record<string, string> = {
  request: "bg-blue-500",
  quote: "bg-primary",
  counter: "bg-amber-500",
  message: "bg-muted-foreground",
  accept: "bg-success",
  decline: "bg-destructive",
  expire: "bg-muted-foreground",
};

export function NegotiationTimeline({ events, currentStatus }: NegotiationTimelineProps): React.JSX.Element {
  if (events.length === 0) return <></>;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-medium text-sm">Хроника переговоров</h4>
        {currentStatus && (
          <Badge variant="outline" className="text-[10px]">{currentStatus}</Badge>
        )}
      </div>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

        {events.map((event, i) => {
          const Icon = EVENT_ICONS[event.type] || Clock;
          const color = EVENT_COLORS[event.type] || "bg-muted-foreground";

          return (
            <div key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
              {/* Icon circle */}
              <div className={`shrink-0 w-8 h-8 rounded-full ${color} text-white flex items-center justify-center z-10`}>
                <Icon className="h-4 w-4" />
              </div>

              {/* Content */}
              <div className="flex-1 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{event.label}</span>
                  <span className="text-[10px] text-muted-foreground">{formatDate(event.timestamp)}</span>
                </div>

                {event.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                )}

                {event.price !== undefined && (
                  <div className="text-xs font-semibold text-primary mt-1">
                    {formatCurrency(event.price)}
                  </div>
                )}

                {event.actor && (
                  <span className="text-[10px] text-muted-foreground">{event.actor}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
