/**
 * Декоративные компоненты в духе дореволюционной типографики.
 *
 * Используют CSS-классы из globals.css:
 *  - .ornament-divider — три ромба с линиями (крупный разделитель секций)
 *  - .divider-fancy — линия с ромбом по центру (мини-разделитель)
 *  - .badge-fancy — «уездный» бейдж с золотистым кантом
 *  - .card-paper — карточка с «бумажной» тенью
 *  - .corner-stamp — уголок-«марка» со звездой
 *  - .stamp-verified — круглая «печать» verified
 *  - .prose-dropcap — буквица для первой буквы статьи
 *  - .small-caps — капитель для меток
 *  - .eyebrow — газетная капитель для лейблов секций
 */

interface OrnamentDividerProps {
  /** Расстояние сверху/снизу. По умолчанию 2rem. */
  marginY?: string;
}

/** Крупный разделитель секций: три ромба с линиями. */
export function OrnamentDivider({ marginY = "2rem" }: OrnamentDividerProps) {
  return (
    <div
      className="ornament-divider"
      style={{ marginTop: marginY, marginBottom: marginY }}
      aria-hidden="true"
    >
      <span />
    </div>
  );
}

/** Мини-разделитель: линия с ромбом по центру. */
export function FancyDivider() {
  return <div className="divider-fancy" aria-hidden="true" />;
}

/** Бейдж в духе старых вывесок: золото + бордо.
 *  variant: "default" | "hit" | "new"
 */
export function FancyBadge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "hit" | "new";
}) {
  const variantClass =
    variant === "hit" ? " badge-hit" : variant === "new" ? " badge-new" : "";
  return <span className={`badge-fancy${variantClass}`}>{children}</span>;
}

/** Eyebrow — газетная капитель над заголовком секции. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

/** Контейнер для статей с буквицей на первом абзаце. */
export function ProseWithDropcap({ children }: { children: React.ReactNode }) {
  return <article className="prose-dropcap">{children}</article>;
}
