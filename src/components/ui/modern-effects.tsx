"use client";

import { useRef, useState, useEffect, type ReactNode, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

// ==================== 3D Tilt Card ====================
// Карточка с наклоном при движении мыши (как Apple card)
export function TiltCard({
  children,
  className,
  maxTilt = 8,
}: {
  children: ReactNode;
  className?: string;
  maxTilt?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState("");
  const [spotlight, setSpotlight] = useState({ x: "50%", y: "50%" });

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -maxTilt;
    const rotateY = ((x - centerX) / centerX) * maxTilt;
    setTransform(
      `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`
    );
    setSpotlight({
      x: `${(x / rect.width) * 100}%`,
      y: `${(y / rect.height) * 100}%`,
    });
  };

  const handleMouseLeave = () => {
    setTransform("perspective(800px) rotateX(0) rotateY(0) scale3d(1, 1, 1)");
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform,
        transition: "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        transformStyle: "preserve-3d",
        willChange: "transform",
        // @ts-ignore — CSS custom property
        "--mouse-x": spotlight.x,
        "--mouse-y": spotlight.y,
      }}
      className={cn("spotlight", className)}
    >
      {children}
    </div>
  );
}

// ==================== Magnetic Button ====================
// Кнопка притягивается к курсору
export function MagneticButton({
  children,
  className,
  onClick,
  strength = 0.3,
  ...props
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  strength?: number;
  [key: string]: any;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: MouseEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setPos({ x: x * strength, y: y * strength });
  };

  const handleMouseLeave = () => {
    setPos({ x: 0, y: 0 });
  };

  return (
    <button
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        transition: "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
}

// ==================== Spotlight Card ====================
// Карточка с подсветкой за курсором
export function SpotlightCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty("--mouse-x", `${x}%`);
    el.style.setProperty("--mouse-y", `${y}%`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={cn("spotlight", className)}
    >
      {children}
    </div>
  );
}

// ==================== Glass Card ====================
// Матовое стекло
export function GlassCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("glass-card rounded-2xl", className)}>
      {children}
    </div>
  );
}

// ==================== 3D Button ====================
// Объёмная 3D-кнопка
export function Button3D({
  children,
  onClick,
  variant = "primary",
  className,
  size = "default",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "light";
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  const sizeClass = {
    sm: "px-3 py-1.5 text-xs",
    default: "px-4 py-2.5 text-sm",
    lg: "px-6 py-3 text-base",
  }[size];

  const variantClass = variant === "primary" ? "btn-3d text-white" : "btn-3d-light text-foreground";

  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl font-medium transition-all select-none",
        sizeClass,
        variantClass,
        className
      )}
    >
      {children}
    </button>
  );
}

// ==================== Gradient Border Card ====================
// Карточка с анимированной градиентной рамкой
export function GradientBorderCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("gradient-border p-px", className)}>
      <div className="rounded-[0.7rem] h-full w-full bg-card p-4">
        {children}
      </div>
    </div>
  );
}

// ==================== Animated Counter ====================
// Счётчик с анимацией (count-up) — безопасный для SSR
export function AnimatedCounter({
  value,
  duration = 1500,
  suffix = "",
  prefix = "",
  className,
}: {
  value: number;
  duration?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    let rafId: number;
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayValue(Math.round(value * eased));
      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      }
    };
    // Start animation after a short delay (only on client)
    const timer = setTimeout(() => {
      setDisplayValue(0);
      rafId = requestAnimationFrame(animate);
    }, 100);
    return () => {
      clearTimeout(timer);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [value, duration]);

  return (
    <span className={className}>
      {prefix}
      {displayValue.toLocaleString("ru-RU")}
      {suffix}
    </span>
  );
}

// ==================== Float Animation Wrapper ====================
// Плавающий 3D-эффект для декоративных элементов
export function FloatWrapper({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("animate-float-3d", className)}>
      {children}
    </div>
  );
}

// ==================== Confetti Effect ====================
// Конфетти для дня рождения / праздника
export function Confetti({ count = 50 }: { count?: number }) {
  const colors = [
    "oklch(0.55 0.18 25)",
    "oklch(0.70 0.14 70)",
    "oklch(0.55 0.12 305)",
    "oklch(0.65 0.10 145)",
    "oklch(0.78 0.16 80)",
  ];
  const pieces = Array.from({ length: count }).map((_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 3}s`,
    duration: `${3 + Math.random() * 3}s`,
    color: colors[i % colors.length],
    size: `${4 + Math.random() * 8}px`,
  }));

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {pieces.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            left: p.left,
            top: "-20px",
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: "2px",
            animation: `confetti-fall ${p.duration} ease-in ${p.delay} forwards`,
          }}
        />
      ))}
    </div>
  );
}
