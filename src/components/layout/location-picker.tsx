"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MapPin, Navigation, Search, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { confectionerServesCity } from "@/lib/finance";

const POPULAR_CITIES = [
  "Москва",
  "Санкт-Петербург",
  "Тула",
  "Новосибирск",
  "Екатеринбург",
  "Казань",
  "Нижний Новгород",
  "Краснодар",
  "Вологда",
  "Самара",
];

export function LocationPicker() {
  const userCity = useAppStore((s) => s.userCity);
  const setUserCity = useAppStore((s) => s.setUserCity);
  const detectUserLocation = useAppStore((s) => s.detectUserLocation);
  const confectioners = useAppStore((s) => s.confectioners);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Города, где есть кондитеры
  const availableCities = Array.from(
    new Set(
      confectioners.flatMap((c) => [
        c.city,
        ...(c.location.deliveryCities || []),
      ])
    )
  ).filter(Boolean);

  const filteredCities = availableCities.filter((city) =>
    city.toLowerCase().includes(search.toLowerCase())
  );

  const handleDetect = async () => {
    toast.info("Определяем местоположение...");
    await detectUserLocation();
    toast.success("Местоположение определено", {
      description: userCity ? `Ваш город: ${userCity}` : undefined,
    });
    setOpen(false);
  };

  const handleSelectCity = (city: string) => {
    setUserCity(city);
    const count = confectioners.filter((c) => confectionerServesCity(c, city)).length;
    toast.success(`Город: ${city}`, {
      description: `Найдено кондитеров: ${count}`,
    });
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="hidden md:flex gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2"
        >
          <MapPin className="h-4 w-4 text-primary" />
          <span className="max-w-[120px] truncate">{userCity || "Выбрать город"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-3 border-b">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Ваше местоположение</span>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск города..."
              className="pl-8 h-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-2 text-xs"
            onClick={handleDetect}
          >
            <Navigation className="h-3 w-3 mr-1.5" />
            Определить автоматически
          </Button>
        </div>

        <div className="p-3 max-h-72 overflow-y-auto">
          {search && filteredCities.length > 0 ? (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                Найденные города
              </div>
              {filteredCities.map((city) => (
                <CityButton
                  key={city}
                  city={city}
                  active={userCity === city}
                  confectionersCount={
                    confectioners.filter((c) => confectionerServesCity(c, city)).length
                  }
                  onClick={() => handleSelectCity(city)}
                />
              ))}
            </div>
          ) : (
            <>
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                Популярные города
              </div>
              <div className="space-y-1 mb-3">
                {POPULAR_CITIES.map((city) => (
                  <CityButton
                    key={city}
                    city={city}
                    active={userCity === city}
                    confectionersCount={
                      confectioners.filter((c) => confectionerServesCity(c, city)).length
                    }
                    onClick={() => handleSelectCity(city)}
                  />
                ))}
              </div>
              {availableCities.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-muted-foreground uppercase mb-2 pt-2 border-t">
                    Города с кондитерами
                  </div>
                  <div className="space-y-1">
                    {availableCities
                      .filter((c) => !POPULAR_CITIES.includes(c))
                      .map((city) => (
                        <CityButton
                          key={city}
                          city={city}
                          active={userCity === city}
                          confectionersCount={
                            confectioners.filter((cc) => confectionerServesCity(cc, city)).length
                          }
                          onClick={() => handleSelectCity(city)}
                        />
                      ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CityButton({
  city,
  active,
  confectionersCount,
  onClick,
}: {
  city: string;
  active: boolean;
  confectionersCount: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors ${
        active ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent"
      }`}
    >
      <span className="flex items-center gap-1.5">
        {active && <Check className="h-3 w-3" />}
        {city}
      </span>
      {confectionersCount > 0 && (
        <span className="text-xs text-muted-foreground">{confectionersCount} конд.</span>
      )}
    </button>
  );
}
