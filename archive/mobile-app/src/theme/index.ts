/**
 * Theme — colors, spacing, typography.
 * Matches the web app's design tokens.
 */
export const Colors = {
  primary: "#7c3aed", // purple-600
  primaryLight: "#a78bfa",
  primaryDark: "#5b21b6",
  accent: "#ec4899", // pink-500

  // Backgrounds
  background: "#ffffff",
  backgroundDark: "#0f0f14",
  surface: "#f9fafb",
  surfaceDark: "#1a1a22",

  // Text
  text: "#111827",
  textMuted: "#6b7280",
  textLight: "#9ca3af",
  textDark: "#f9fafb",
  textMutedDark: "#9ca3af",

  // Status
  success: "#10b981",
  warning: "#f59e0b",
  error: "#ef4444",
  info: "#3b82f6",

  // Borders
  border: "#e5e7eb",
  borderDark: "#2a2a35",

  // Loyalty level colors
  bronze: "#a16207",
  silver: "#64748b",
  gold: "#d4af37",
  platinum: "#7c3aed",
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const BorderRadius = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const Shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
};

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
};

export const formatDate = (iso: string): string => {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
};

export const formatRelative = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} дн назад`;
  if (hours > 0) return `${hours} ч назад`;
  if (minutes > 0) return `${minutes} мин назад`;
  return "только что";
};
