import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "только что";
  if (minutes < 60) {
    const last = minutes % 10;
    const last2 = minutes % 100;
    if (last2 >= 11 && last2 <= 14) return `${minutes} минут назад`;
    if (last === 1) return `${minutes} минуту назад`;
    if (last >= 2 && last <= 4) return `${minutes} минуты назад`;
    return `${minutes} минут назад`;
  }
  if (hours < 24) {
    const last = hours % 10;
    const last2 = hours % 100;
    if (last2 >= 11 && last2 <= 14) return `${hours} часов назад`;
    if (last === 1) return `${hours} час назад`;
    if (last >= 2 && last <= 4) return `${hours} часа назад`;
    return `${hours} часов назад`;
  }
  if (days < 7) {
    const last = days % 10;
    const last2 = days % 100;
    if (last2 >= 11 && last2 <= 14) return `${days} дней назад`;
    if (last === 1) return `${days} день назад`;
    if (last >= 2 && last <= 4) return `${days} дня назад`;
    return `${days} дней назад`;
  }
  return date.toLocaleDateString("ru-RU");
}
