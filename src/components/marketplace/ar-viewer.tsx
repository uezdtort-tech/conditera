"use client";

/**
 * AR / 3D preview component for cake products.
 *
 * Uses <model-viewer> web component by Google — supports:
 *  - On-page 3D rendering (rotate, zoom, pan)
 *  - AR via Scene Viewer (Android Chrome)
 *  - AR via Quick Look (iOS Safari, USDZ format)
 *
 * Falls back to static images if no model URL is provided.
 */
import { useState, useEffect, useRef, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Box, View, X, RotateCw, Smartphone, Boxes } from "lucide-react";

export interface ARViewerProps {
  /** GLB/GLTF model URL (Web) */
  modelUrl?: string | null;
  /** USDZ model URL (iOS Quick Look) */
  modelUsdzUrl?: string | null;
  /** Fallback image (poster) shown before 3D loads */
  posterImage?: string;
  /** Product title for AR prompt */
  productName: string;
  /** Whether AR is enabled for this product */
  arEnabled?: boolean;
}

export function ARViewer({
  modelUrl,
  modelUsdzUrl,
  posterImage,
  productName,
  arEnabled = false,
}: ARViewerProps) {
  const [mode, setMode] = useState<"preview" | "ar" | "fallback">("preview");
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isARSupported, setIsARSupported] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Dynamically load model-viewer web component
    import("@google/model-viewer").then(() => {
      // Custom elements registry handles the registration
      if (typeof window !== "undefined") {
        // Check AR session support
        const el = document.createElement("model-viewer") as HTMLElement & { ARjs?: boolean };
        if (typeof (el as any).ARjs === "boolean") {
          setIsARSupported((el as any).ARjs);
        }
        // For Scene Viewer on Android, AR is always available through intent
        const ua = navigator.userAgent;
        const isAndroid = /android/i.test(ua);
        const isChrome = /chrome/i.test(ua) && !/edge|edg/i.test(ua);
        const isIOS = /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua);
        if ((isAndroid && isChrome) || (isIOS && modelUsdzUrl)) {
          setIsARSupported(true);
        }
      }
    });
  }, [modelUsdzUrl]);

  // No model — show fallback image with a hint
  if (!modelUrl && !modelUsdzUrl) {
    if (posterImage) {
      return (
        <div className="relative">
          <img
            src={posterImage}
            alt={productName}
            className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute bottom-3 right-3">
            <Badge variant="secondary" className="bg-black/60 text-white backdrop-blur">
              <Box className="h-3 w-3 mr-1" /> 3D скоро
            </Badge>
          </div>
        </div>
      );
    }
    return null;
  }

  if (hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted">
        <div className="text-center p-4">
          <X className="h-10 w-10 text-destructive mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Не удалось загрузить 3D-модель
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* model-viewer is loaded via side-effect import; we cast to any to use custom element */}
      { }
      <model-viewer
        src={modelUrl || undefined}
        ios-src={modelUsdzUrl || undefined}
        poster={posterImage}
        alt={`3D модель: ${productName}`}
        ar={arEnabled}
        ar-modes={["scene-viewer", "quick-look", "webxr"]}
        camera-controls
        touch-action="pan-y"
        auto-rotate
        auto-rotate-delay={3000}
        rotation-per-second="30deg"
        shadow-intensity="1"
        shadow-softness="1"
        exposure="1"
        environment-image="neutral"
        camera-orbit="0deg 75deg 105deg"
        min-camera-orbit="auto auto 50%"
        max-camera-orbit="auto auto 200%"
        field-of-view="30deg"
        min-field-of-view="20deg"
        max-field-of-view="60deg"
        style={{ width: "100%", height: "100%", minHeight: 400, background: "transparent" }}
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
      >
        {/* Loading slot */}
        <div slot="poster" className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-50 via-pink-50 to-amber-50 dark:from-purple-950/40 dark:via-pink-950/40 dark:to-amber-950/40">
          {!isLoaded && (
            <div className="text-center">
              <div className="relative inline-block">
                <Box className="h-16 w-16 text-purple-500 mx-auto animate-pulse" />
                <RotateCw className="h-5 w-5 text-pink-500 absolute -top-1 -right-1 animate-spin" />
              </div>
              <p className="text-sm text-muted-foreground mt-3">
                Загрузка 3D-модели...
              </p>
            </div>
          )}
        </div>

        {/* AR button slot */}
        {arEnabled && isARSupported && (
          <button
            slot="ar-button"
            className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm font-medium shadow-lg hover:shadow-xl hover:scale-105 transition-all"
          >
            <Smartphone className="h-4 w-4" />
            Посмотреть в AR
          </button>
        )}
      </model-viewer>

      {/* Top badges */}
      <div className="absolute top-3 left-3 flex flex-col gap-2 pointer-events-none">
        <Badge className="bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md">
          <View className="h-3 w-3 mr-1" /> 3D превью
        </Badge>
        {arEnabled && (
          <Badge className="bg-black/60 text-white backdrop-blur">
            <Smartphone className="h-3 w-3 mr-1" /> AR готово
          </Badge>
        )}
      </div>

      {/* Controls hint */}
      {isLoaded && (
        <div className="absolute bottom-3 left-3 pointer-events-none">
          <div className="bg-black/60 text-white text-xs px-2 py-1 rounded-md backdrop-blur">
            Вращайте, чтобы рассмотреть
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact AR launcher button — for product cards / catalog.
 * Opens product page with AR tab open.
 */
export function ARLauncherButton({ onClick }: { onClick?: () => void }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/40 dark:to-pink-950/40 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40"
    >
      <Box className="h-4 w-4 mr-1" />
      3D / AR
    </Button>
  );
}

/**
 * Section wrapper used on product page.
 */
export function ARPreviewSection({
  modelUrl,
  modelUsdzUrl,
  posterImage,
  productName,
  arEnabled,
}: ARViewerProps) {
  if (!modelUrl && !modelUsdzUrl) return null;

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/40 dark:to-pink-950/40 px-4 py-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Box className="h-5 w-5 text-purple-600" />
            <h3 className="font-semibold">3D-превью и AR</h3>
          </div>
          <Badge variant="outline" className="text-purple-700 dark:text-purple-300 border-purple-300">
            Уникальная функция
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Покрутите модель мышкой, чтобы рассмотреть со всех сторон.
          {arEnabled && " Нажмите «Посмотреть в AR» — и торт появится на вашем столе!"}
        </p>
      </div>
      <div className="aspect-square w-full max-h-[500px]">
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><Box className="h-12 w-12 text-purple-400 animate-pulse" /></div>}>
          <ARViewer
            modelUrl={modelUrl}
            modelUsdzUrl={modelUsdzUrl}
            posterImage={posterImage}
            productName={productName}
            arEnabled={arEnabled}
          />
        </Suspense>
      </div>
    </Card>
  );
}
