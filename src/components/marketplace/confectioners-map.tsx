"use client";

/**
 * ConfectionersMap — карта с расположением кондитеров.
 *
 * Использует встроенный SVG-визуализатор карты (без внешних библиотек).
 * Показывает кондитеров как маркеры на схематичной карте.
 * При клике на маркер — показывает информацию о кондитере.
 */

import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MapPin, Star, Navigation } from "lucide-react";
import { useState, useMemo } from "react";
import { formatCurrency } from "@/lib/finance";

export function ConfectionersMap() {
  const confectioners = useAppStore((s) => s.confectioners);
  const navigate = useAppStore((s) => s.navigate);
  const [selected, setSelected] = useState<string | null>(null);

  // Мин/макс координаты для нормализации
  const bounds = useMemo(() => {
    const coords = confectioners
      .filter((c) => {
        const lat = c.location?.lat;
        const lng = c.location?.lng;
        return typeof lat === "number" && typeof lng === "number";
      })
      .map((c) => ({ lat: c.location!.lat as number, lng: c.location!.lng as number }));
    if (coords.length === 0) return null;
    return {
      minLat: Math.min(...coords.map((c) => c.lat)),
      maxLat: Math.max(...coords.map((c) => c.lat)),
      minLng: Math.min(...coords.map((c) => c.lng)),
      maxLng: Math.max(...coords.map((c) => c.lng)),
    };
  }, [confectioners]);

  const mapConfectioners = confectioners.filter(
    (c) => c.location?.lat && c.location?.lng
  );

  if (!bounds || mapConfectioners.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <MapPin className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p>Нет данных о расположении кондитеров</p>
      </Card>
    );
  }

  // Нормализация координат в SVG-пространство (0-100%)
  const toX = (lng: number) => {
    const range = bounds.maxLng - bounds.minLng || 1;
    return ((lng - bounds.minLng) / range) * 90 + 5; // 5% padding
  };
  const toY = (lat: number) => {
    const range = bounds.maxLat - bounds.minLat || 1;
    return 95 - ((lat - bounds.minLat) / range) * 90; // инвертируем Y, 5% padding
  };

  const selectedConf = mapConfectioners.find((c) => c.id === selected);

  return (
    <div className="relative">
      {/* Карта */}
      <Card className="p-0 overflow-hidden relative" style={{ height: "500px" }}>
        {/* SVG карта России (схематично) */}
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          preserveAspectRatio="xMidYMid slice"
          style={{ background: "linear-gradient(135deg, #e0f2fe 0%, #f0fdf4 50%, #fef3c7 100%)" }}
        >
          {/* Сетка */}
          {[20, 40, 60, 80].map((n) => (
            <g key={n}>
              <line x1={n} y1="0" x2={n} y2="100" stroke="#cbd5e1" strokeWidth="0.2" strokeDasharray="1,1" />
              <line x1="0" y1={n} x2="100" y2={n} stroke="#cbd5e1" strokeWidth="0.2" strokeDasharray="1,1" />
            </g>
          ))}

          {/* Схематичная граница России */}
          <path
            d="M 10,20 Q 15,15 25,18 L 40,15 Q 55,12 70,16 L 85,14 Q 92,18 90,30 L 88,45 Q 85,55 80,60 L 70,65 Q 55,68 40,65 L 25,62 Q 15,58 12,48 L 10,35 Z"
            fill="#dcfce7"
            stroke="#86efac"
            strokeWidth="0.3"
            opacity="0.5"
          />

          {/* Города (круги) */}
          {mapConfectioners.map((c) => {
            const x = toX(c?.location?.lng ?? 0);
            const y = toY(c?.location?.lat ?? 0);
            const isSel = selected === c.id;
            return (
              <g key={c.id} onClick={() => setSelected(c.id)} style={{ cursor: "pointer" }}>
                {/* Pulse ring для selected */}
                {isSel && (
                  <circle cx={x} cy={y} r="4" fill="#7c2d12" opacity="0.2">
                    <animate attributeName="r" from="2" to="6" dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" from="0.3" to="0" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                )}
                {/* Маркер */}
                <circle
                  cx={x}
                  cy={y}
                  r={isSel ? "2.5" : "1.8"}
                  fill={c.verified ? "#059669" : "#7c2d12"}
                  stroke="#fff"
                  strokeWidth="0.5"
                />
                {c.verified && (
                  <text x={x} y={y - 0.5} fontSize="1.5" fill="#fff" textAnchor="middle" fontWeight="bold">
                    ✓
                  </text>
                )}
                {/* Label для selected */}
                {isSel && (
                  <text x={x} y={y - 3.5} fontSize="2" fill="#1e293b" textAnchor="middle" fontWeight="bold">
                    {c.businessName.length > 15 ? c.businessName.slice(0, 13) + "..." : c.businessName}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Overlay info card */}
        {selectedConf && (
          <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:w-96">
            <Card className="p-4 shadow-lg bg-white/95 backdrop-blur">
              <div className="flex items-start gap-3">
                <Avatar className="h-12 w-12 shrink-0">
                  <AvatarImage src={selectedConf.avatar} alt={selectedConf.businessName} />
                  <AvatarFallback>{selectedConf.businessName.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate">{selectedConf.businessName}</h3>
                    {selectedConf.verified && (
                      <Badge className="bg-emerald-100 text-emerald-800 text-[10px] shrink-0">
                        ✓ Проверен
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    <span>{selectedConf.rating.toFixed(1)}</span>
                    <span>•</span>
                    <span>{selectedConf.ordersCount} заказов</span>
                    <span>•</span>
                    <MapPin className="h-3 w-3" />
                    <span>{selectedConf.city}</span>
                  </div>
                  {selectedConf.specialization.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-2">
                      {selectedConf.specialization.slice(0, 3).map((s, i) => (
                        <Badge key={i} variant="outline" className="text-[10px]">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                className="w-full mt-3"
                onClick={() => navigate("confectioner-profile", { id: selectedConf.id })}
              >
                <Navigation className="h-3.5 w-3.5 mr-1" />
                Перейти в профиль
              </Button>
            </Card>
          </div>
        )}

        {/* Legend */}
        <div className="absolute top-3 right-3 bg-white/90 backdrop-blur rounded-lg p-2 text-xs shadow">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-3 w-3 rounded-full bg-emerald-600" />
            <span>Проверенный</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-[#7c2d12]" />
            <span>На проверке</span>
          </div>
        </div>

        {/* Counter */}
        <div className="absolute top-3 left-3 bg-white/90 backdrop-blur rounded-lg px-3 py-1.5 text-xs shadow">
          <strong>{mapConfectioners.length}</strong> кондитеров на карте
        </div>
      </Card>

      {/* Список кондитеров под картой */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {mapConfectioners.slice(0, 6).map((c) => (
          <Card
            key={c.id}
            className={`p-3 cursor-pointer transition-all hover:border-primary/30 ${
              selected === c.id ? "border-primary ring-2 ring-primary/20" : ""
            }`}
            onClick={() => setSelected(c.id)}
          >
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={c.avatar} alt={c.businessName} />
                <AvatarFallback className="text-xs">{c.businessName.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{c.businessName}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {c.city}
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {c.rating.toFixed(1)}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
