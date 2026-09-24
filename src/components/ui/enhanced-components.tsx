"use client";

import { useAppStore } from "@/lib/store";
import { useState, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Search,
  ShoppingCart,
  Star,
  X,
  Eye,
  Heart,
  ChevronRight,
  Clock,
  Trash2,
  Plus,
  Minus,
} from "lucide-react";
import { formatCurrency, calculateDelivery } from "@/lib/finance";
import type { Product } from "@/lib/types";
import { toast } from "sonner";

// ==================== GLOBAL SEARCH WITH AUTOCOMPLETE ====================
export function GlobalSearch() {
  const products = useAppStore((s) => s.products);
  const confectioners = useAppStore((s) => s.confectioners);
  const navigate = useAppStore((s) => s.navigate);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);

  const results = useMemo(() => {
    if (!query || query.length < 2) return { products: [], confectioners: [], categories: [] };
    const q = query.toLowerCase();
    return {
      products: products
        .filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.tags?.some((t) => t.toLowerCase().includes(q))
        )
        .slice(0, 5),
      confectioners: confectioners
        .filter(
          (c) =>
            c.businessName.toLowerCase().includes(q) ||
            c.specialization.some((s) => s.toLowerCase().includes(q))
        )
        .slice(0, 3),
      categories: [
        { slug: "cakes", name: "Торты" },
        { slug: "cupcakes", name: "Капкейки" },
        { slug: "bento", name: "Бенто-торты" },
        { slug: "macarons", name: "Макаронс" },
        { slug: "desserts", name: "Десерты" },
      ]
        .filter((c) => c.name.toLowerCase().includes(q))
        .slice(0, 3),
    };
  }, [query, products, confectioners]);

  const hasResults =
    results.products.length > 0 ||
    results.confectioners.length > 0 ||
    results.categories.length > 0;

  return (
    <Popover open={open && focused && query.length >= 2} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setFocused(true);
              if (query.length >= 2) setOpen(true);
            }}
            onBlur={() => {
              setTimeout(() => {
                setFocused(false);
                setOpen(false);
              }, 200);
            }}
            placeholder="Поиск: торт, медовик, бенто..."
            className="pl-10 pr-8 h-9"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setOpen(false);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0 max-h-96 overflow-y-auto" align="start">
        {hasResults ? (
          <div className="p-2">
            {/* Categories */}
            {results.categories.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1">Категории</div>
                {results.categories.map((cat) => (
                  <button
                    key={cat.slug}
                    onClick={() => {
                      navigate("catalog", { category: cat.slug });
                      setOpen(false);
                      setQuery("");
                    }}
                    className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-sm flex items-center gap-2"
                  >
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
            {/* Products */}
            {results.products.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1">Товары</div>
                {results.products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      navigate("product", { id: p.id });
                      setOpen(false);
                      setQuery("");
                    }}
                    className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-sm flex items-center gap-2"
                  >
                    <img src={p.images[0]} alt="" className="h-8 w-8 rounded object-cover" loading="lazy" decoding="async" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{formatCurrency(p.price)}</div>
                    </div>
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    <span className="text-xs text-muted-foreground">{p.rating.toFixed(1)}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Confectioners */}
            {results.confectioners.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1">Кондитеры</div>
                {results.confectioners.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      navigate("confectioner-profile", { id: c.id });
                      setOpen(false);
                      setQuery("");
                    }}
                    className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-sm flex items-center gap-2"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={c.avatar} alt={c.businessName} />
                      <AvatarFallback className="text-[10px]">{c.businessName.slice(0, 2)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{c.businessName}</div>
                      <div className="text-xs text-muted-foreground">{c.city} • ⭐ {c.rating}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Ничего не найдено по запросу «{query}»
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ==================== QUICK VIEW MODAL ====================
export function QuickViewModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const navigate = useAppStore((s) => s.navigate);
  const addToCart = useAppStore((s) => s.addToCart);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const isFavorite = useAppStore((s) => (product ? s.favorites.includes(product.id) : false));

  if (!product) return null;

  const deliveryCost = calculateDelivery(product.price);

  return (
    <Dialog open={!!product} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogTitle className="sr-only">{product.title}</DialogTitle>
        <DialogDescription className="sr-only">Быстрый просмотр товара</DialogDescription>
        <div className="grid sm:grid-cols-2 gap-0">
          {/* Image */}
          <div className="aspect-square bg-muted">
            <img src={product.images[0]} alt={product.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          </div>
          {/* Info */}
          <div className="p-5 space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">{product.confectionerName}</div>
              <h2 className="font-display font-bold text-lg line-clamp-2">{product.title}</h2>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              <span className="font-medium">{product.rating.toFixed(1)}</span>
              <span className="text-muted-foreground">({product.reviewsCount})</span>
              {product.weight && <span className="text-muted-foreground">• {product.weight}</span>}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-3">{product.description}</p>
            <div className="flex items-end justify-between pt-2">
              <div>
                {product.oldPrice && <div className="text-xs text-muted-foreground line-through">{formatCurrency(product.oldPrice)}</div>}
                <div className="font-display font-bold text-2xl text-primary">{formatCurrency(product.price)}</div>
                <div className="text-xs text-muted-foreground">доставка: {deliveryCost.cost === 0 ? "бесплатно" : formatCurrency(deliveryCost.cost)}</div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={() => { addToCart(product); onClose(); }}>
                <ShoppingCart className="h-4 w-4 mr-1" /> В корзину
              </Button>
              <Button variant="outline" size="icon" onClick={() => toggleFavorite(product.id)}>
                <Heart className={`h-4 w-4 ${isFavorite ? "fill-primary text-primary" : ""}`} />
              </Button>
              <Button variant="outline" onClick={() => { navigate("product", { id: product.id }); onClose(); }}>
                Подробнее
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ==================== RECENTLY VIEWED ====================
export function RecentlyViewed() {
  const products = useAppStore((s) => s.products);
  const navigate = useAppStore((s) => s.navigate);
  // Start with empty array on both server and client (avoids hydration mismatch).
  // Update from localStorage after mount via useEffect.
  const [viewed, setViewed] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("recentlyViewed");
    try {
      setViewed(stored ? JSON.parse(stored) : []);
    } catch {
      setViewed([]);
    }
  }, []);

  const viewedProducts = viewed
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean)
    .slice(0, 6) as Product[];

  if (viewedProducts.length === 0) return null;

  return (
    <div>
      <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
        <Clock className="h-5 w-5 text-muted-foreground" />
        Вы смотрели
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
        {viewedProducts.map((p) => (
          <Card
            key={p.id}
            onClick={() => navigate("product", { id: p.id })}
            className="shrink-0 w-36 cursor-pointer hover:shadow-md transition-shadow p-0 overflow-hidden"
          >
            <div className="aspect-square bg-muted">
              <img src={p.images[0]} alt={p.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
            </div>
            <div className="p-2">
              <div className="text-xs font-medium line-clamp-1">{p.title}</div>
              <div className="text-xs text-primary font-bold mt-1">{formatCurrency(p.price)}</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Helper: add to recently viewed
export function addRecentlyViewed(productId: string) {
  if (typeof window === "undefined") return;
  const stored = localStorage.getItem("recentlyViewed");
  let viewed: string[] = stored ? JSON.parse(stored) : [];
  viewed = [productId, ...viewed.filter((id) => id !== productId)].slice(0, 10);
  localStorage.setItem("recentlyViewed", JSON.stringify(viewed));
}

// ==================== MINI CART DROPDOWN ====================
export function MiniCartDropdown() {
  const cart = useAppStore((s) => s.cart);
  const setCartOpen = useAppStore((s) => s.setCartOpen);
  const navigate = useAppStore((s) => s.navigate);
  const [hover, setHover] = useState(false);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (cartCount === 0) return null;

  return (
    <div
      className="relative hidden sm:block"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {hover && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-lg shadow-xl z-50 p-3">
          <div className="text-sm font-semibold mb-2">Корзина ({cartCount})</div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {cart.slice(0, 3).map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <img src={item.image} alt="" className="h-8 w-8 rounded object-cover" loading="lazy" decoding="async" />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{item.title}</div>
                  <div className="text-muted-foreground">{item.quantity} × {formatCurrency(item.price)}</div>
                </div>
              </div>
            ))}
            {cart.length > 3 && (
              <div className="text-xs text-muted-foreground text-center">и ещё {cart.length - 3}...</div>
            )}
          </div>
          <div className="border-t mt-2 pt-2 flex items-center justify-between">
            <span className="text-sm font-bold">{formatCurrency(total)}</span>
            <Button size="sm" onClick={() => setCartOpen(true)}>Открыть</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== SMART EMPTY STATE ====================
export function SmartEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionView,
  recommendations,
}: {
  icon: any;
  title: string;
  description: string;
  actionLabel?: string;
  actionView?: any;
  recommendations?: Product[];
}) {
  const navigate = useAppStore((s) => s.navigate);

  return (
    <Card className="p-8 text-center">
      <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
        <Icon className="h-8 w-8 text-primary" />
      </div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">{description}</p>
      {actionLabel && actionView && (
        <Button onClick={() => navigate(actionView)} className="mb-4">
          {actionLabel}
        </Button>
      )}
      {recommendations && recommendations.length > 0 && (
        <div className="border-t pt-4 mt-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase mb-3">Популярные товары</div>
          <div className="grid grid-cols-3 gap-2">
            {recommendations.slice(0, 3).map((p) => (
              <Card
                key={p.id}
                onClick={() => navigate("product", { id: p.id })}
                className="cursor-pointer hover:shadow-md transition-shadow p-0 overflow-hidden"
              >
                <div className="aspect-square bg-muted">
                  <img src={p.images[0]} alt={p.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </div>
                <div className="p-1.5">
                  <div className="text-[10px] font-medium line-clamp-1">{p.title}</div>
                  <div className="text-[10px] text-primary font-bold">{formatCurrency(p.price)}</div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ==================== STICKY ADD TO CART BAR ====================
export function StickyAddToCart({
  product,
  finalPrice,
  onAddToCart,
}: {
  product: Product;
  finalPrice: number;
  onAddToCart: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => {
      setVisible(window.scrollY > 600);
    };
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-card/95 backdrop-blur border-t border-border shadow-lg">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img src={product.images[0]} alt="" className="h-10 w-10 rounded object-cover shrink-0" loading="lazy" decoding="async" />
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{product.title}</div>
            <div className="font-display font-bold text-primary">{formatCurrency(finalPrice)}</div>
          </div>
        </div>
        <Button onClick={onAddToCart} className="shrink-0">
          <ShoppingCart className="h-4 w-4 mr-1" /> В корзину
        </Button>
      </div>
    </div>
  );
}
