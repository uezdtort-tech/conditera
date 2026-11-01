"use client";

/**
 * CakeVisualPreview — живое SVG-превью кондитерского изделия из реальной
 * конфигурации конструктора (CakeBuilderConfig).
 *
 * ADAPT инновации Qwen «VisualConstructor» (qwentopt bfb2c04): портирована
 * ТЕХНИКА — слоистая композиция ellipse+rect, форма через path, тень-эллипс,
 * декор поверх верха, надпись <text>. НЕ перенесено: их mock-стор и
 * клиентский расчёт цены (в Conditera цену считает только сервер).
 *
 * Маппинг конфига → цвета/формы: src/lib/cake-visual-map.ts (чистый, тестируемый).
 * Анимация — только CSS transition на fill (без framer-motion).
 * Палитра согласована с дизайн-системой: бордо #8b2635, крем-фон.
 */

import { useId, useMemo } from "react";
import type { CakeBuilderConfig } from "@/lib/cake-builder-pricing";
import { configToVisual, inscriptionColorOn, type CakeVisual } from "@/lib/cake-visual-map";

const BERRY = "#8b2635";
const CREAM_BG = "#faf6ee";
const PLATE_COLOR = "#e8dcc6";
const CUP_COLOR = "#d9a05b";

const SHAPE_LABELS: Record<CakeVisual["shape"], string> = {
  round: "круглый торт",
  square: "квадратный торт",
  heart: "торт-сердце",
  cupcakes: "ряд капкейков",
  other: "стилизованный десерт",
};

/** Длина/глубина подтёков глазури — детерминированный «случайный» узор. */
const DRIP_CAPSULES = [
  { dx: -62, h: 18 },
  { dx: -44, h: 26 },
  { dx: -24, h: 14 },
  { dx: 0, h: 30 },
  { dx: 22, h: 20 },
  { dx: 42, h: 24 },
  { dx: 60, h: 15 },
] as const;

/** Подтёки глазури: полоса под верхней кромкой + свисающие капсулы. */
function Drips({ cx, y, fill }: { cx: number; y: number; fill: string }) {
  return (
    <g fill={fill} style={{ transition: "fill 400ms ease" }} aria-hidden="true">
      {DRIP_CAPSULES.map(({ dx, h }) => (
        <rect key={dx} x={cx + dx - 4.5} y={y} width={9} height={h} rx={4.5} />
      ))}
    </g>
  );
}

/** Декор-глифы вдоль верха изделия. */
function DecorGlyphs({ icons, y, xs, fontSize = 21 }: { icons: string[]; y: number; xs?: number[]; fontSize?: number }) {
  if (icons.length === 0) return null;
  const positions =
    xs ??
    Array.from({ length: Math.min(icons.length, 5) }, (_, i) => 150 + (i - (icons.length - 1) / 2) * 34);
  return (
    <g aria-hidden="true">
      {icons.slice(0, positions.length).map((glyph, i) => (
        <text
          key={`${glyph}-${i}`}
          x={positions[i]}
          y={y}
          fontSize={fontSize}
          textAnchor="middle"
          style={{ userSelect: "none" }}
        >
          {glyph}
        </text>
      ))}
    </g>
  );
}

/** Круглый торт: цилиндр (ellipse+rect), начинка-полоса, верх-покрытие, подтёки. */
function RoundBody({ v }: { v: CakeVisual }) {
  const twoTier = v.tiers === 2;
  return (
    <g>
      {/* нижний (или единственный) ярус */}
      <rect x={78} y={152} width={144} height={84} rx={8} fill={v.baseColor} style={{ transition: "fill 400ms ease" }} />
      <rect x={78} y={196} width={144} height={13} fill={v.fillingAccent} style={{ transition: "fill 400ms ease" }} />
      <ellipse cx={150} cy={152} rx={72} ry={17} fill={v.coatingColor} style={{ transition: "fill 400ms ease" }} />
      {v.drip && <Drips cx={150} y={156} fill={v.coatingColor} />}
      {twoTier && (
        <>
          <rect x={104} y={92} width={92} height={58} rx={7} fill={v.baseColor} style={{ transition: "fill 400ms ease" }} />
          <rect x={104} y={122} width={92} height={11} fill={v.fillingAccent} style={{ transition: "fill 400ms ease" }} />
          <ellipse cx={150} cy={92} rx={46} ry={12} fill={v.coatingColor} style={{ transition: "fill 400ms ease" }} />
          {v.drip && <Drips cx={150} y={96} fill={v.coatingColor} />}
        </>
      )}
    </g>
  );
}

/** Квадратный торт: скруглённые слои + верхняя плита покрытия. */
function SquareBody({ v }: { v: CakeVisual }) {
  const twoTier = v.tiers === 2;
  return (
    <g>
      <rect x={80} y={154} width={140} height={80} rx={10} fill={v.baseColor} style={{ transition: "fill 400ms ease" }} />
      <rect x={80} y={198} width={140} height={13} fill={v.fillingAccent} style={{ transition: "fill 400ms ease" }} />
      <rect x={80} y={146} width={140} height={20} rx={10} fill={v.coatingColor} style={{ transition: "fill 400ms ease" }} />
      {v.drip && <Drips cx={150} y={160} fill={v.coatingColor} />}
      {twoTier && (
        <>
          <rect x={106} y={94} width={88} height={54} rx={9} fill={v.baseColor} style={{ transition: "fill 400ms ease" }} />
          <rect x={106} y={122} width={88} height={11} fill={v.fillingAccent} style={{ transition: "fill 400ms ease" }} />
          <rect x={106} y={88} width={88} height={17} rx={9} fill={v.coatingColor} style={{ transition: "fill 400ms ease" }} />
          {v.drip && <Drips cx={150} y={98} fill={v.coatingColor} />}
        </>
      )}
    </g>
  );
}

/** Сердце: path + clipPath, покрытие — «глазурная шапка» по верхним дугам. */
const HEART_PATH =
  "M150 244 C 96 202 60 164 60 126 A 45 45 0 0 1 150 110 A 45 45 0 0 1 240 126 C 240 164 204 202 150 244 Z";

function HeartBody({ v, uid }: { v: CakeVisual; uid: string }) {
  // Глазурная шапка: верхние дуги сердца + волнистая кромка (8 гребней, 176px)
  const icingPath =
    "M62 124 A45 45 0 0 1 150 110 A45 45 0 0 1 238 124 L238 140 " +
    "q-11 12 -22 0 q-11 14 -22 0 q-11 10 -22 0 q-11 14 -22 0 q-11 10 -22 0 q-11 12 -22 0 q-11 10 -22 0 q-11 12 -22 0 Z";
  return (
    <g>
      <defs>
        <clipPath id={`${uid}-heart-clip`}>
          <path d={HEART_PATH} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid}-heart-clip)`}>
        <rect x={55} y={100} width={190} height={150} fill={v.baseColor} style={{ transition: "fill 400ms ease" }} />
        <rect x={55} y={182} width={190} height={13} fill={v.fillingAccent} style={{ transition: "fill 400ms ease" }} />
        <path d={icingPath} fill={v.coatingColor} style={{ transition: "fill 400ms ease" }} />
      </g>
      <path d={HEART_PATH} fill="none" stroke={BERRY} strokeOpacity={0.18} strokeWidth={2} />
    </g>
  );
}

/** Капкейки: ряд из трёх (гофрированный стакан + шапка крема + акцентная ягода). */
function CupcakesBody({ v }: { v: CakeVisual }) {
  const xs = [85, 150, 215];
  return (
    <g>
      {xs.map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy={200} rx={33} ry={24} fill={v.coatingColor} style={{ transition: "fill 400ms ease" }} />
          <circle cx={cx} cy={180} r={6} fill={v.fillingAccent} style={{ transition: "fill 400ms ease" }} />
          <path
            d={`M${cx - 30} 202 L${cx + 30} 202 L${cx + 22} 248 L${cx - 22} 248 Z`}
            fill={CUP_COLOR}
          />
          <g stroke="#000" strokeOpacity={0.08} strokeWidth={2}>
            <line x1={cx - 12} y1={204} x2={cx - 15} y2={246} />
            <line x1={cx} y1={204} x2={cx} y2={246} />
            <line x1={cx + 12} y1={204} x2={cx + 15} y2={246} />
          </g>
        </g>
      ))}
    </g>
  );
}

/** Other: стилизованный муссовый десерт на подставке (купол + слои через clip). */
function OtherBody({ v, uid }: { v: CakeVisual; uid: string }) {
  const domePath = "M92 214 A58 58 0 0 1 208 214 Z";
  return (
    <g>
      <defs>
        <clipPath id={`${uid}-dome-clip`}>
          <path d={domePath} />
        </clipPath>
      </defs>
      <rect x={146} y={216} width={8} height={26} fill="#c9b18c" />
      <ellipse cx={150} cy={244} rx={52} ry={10} fill={PLATE_COLOR} />
      <g clipPath={`url(#${uid}-dome-clip)`}>
        <rect x={90} y={152} width={120} height={64} fill={v.baseColor} style={{ transition: "fill 400ms ease" }} />
        <rect x={90} y={152} width={120} height={36} fill={v.coatingColor} style={{ transition: "fill 400ms ease" }} />
        <rect x={90} y={188} width={120} height={12} fill={v.fillingAccent} style={{ transition: "fill 400ms ease" }} />
      </g>
      <ellipse cx={150} cy={214} rx={58} ry={10} fill="none" stroke={BERRY} strokeOpacity={0.18} strokeWidth={2} />
    </g>
  );
}

/** Тарелка и мягкая тень под изделием (техника Qwen: shadow ellipse). */
function Plate({ wide = false }: { wide?: boolean }) {
  return (
    <g aria-hidden="true">
      <ellipse cx={150} cy={252} rx={wide ? 110 : 95} ry={12} fill="#000" opacity={0.08} />
      <ellipse cx={150} cy={246} rx={wide ? 110 : 96} ry={15} fill={PLATE_COLOR} />
    </g>
  );
}

export interface CakeVisualPreviewProps {
  config: CakeBuilderConfig;
  /** Компактный режим для встраивания в шаги конструктора */
  compact?: boolean;
  className?: string;
}

export function CakeVisualPreview({ config, compact = false, className }: CakeVisualPreviewProps) {
  // useId — SSR/клиент-стабильный uid, чтобы clipPath нескольких превью
  // на одной странице не конфликтовали по id.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const v = useMemo(() => configToVisual(config), [config]);

  const ariaLabel = `Визуальное превью: ${SHAPE_LABELS[v.shape]}${
    v.inscription ? `, надпись «${v.inscription}»` : ""
  }`;

  const surfaceColor =
    v.shape === "cupcakes" || v.shape === "other" ? CREAM_BG : v.baseColor;
  const inscriptionFill = inscriptionColorOn(surfaceColor);

  const inscriptionPos: Record<CakeVisual["shape"], { x: number; y: number } | null> = {
    round: { x: 150, y: 226 },
    square: { x: 150, y: 230 },
    heart: { x: 150, y: 210 },
    cupcakes: { x: 150, y: 272 },
    other: { x: 150, y: 262 },
  };

  const decorPos: Partial<Record<CakeVisual["shape"], { y: number; xs?: number[]; fontSize?: number }>> = {
    round: { y: v.tiers === 2 ? 90 : 150, fontSize: 20 },
    square: { y: 146, fontSize: 20 },
    heart: { y: 140, fontSize: 19 },
    cupcakes: { y: 168, xs: [85, 150, 215], fontSize: 19 },
    other: { y: 146, fontSize: 19 },
  };

  const inscription = inscriptionPos[v.shape];
  const decor = decorPos[v.shape];

  return (
    <svg
      viewBox="0 0 300 300"
      width="100%"
      height={compact ? 180 : undefined}
      role="img"
      aria-label={ariaLabel}
      className={className}
      data-shape={v.shape}
    >
      {/* кремовый фон — фирменная палитра */}
      <rect x={0} y={0} width={300} height={300} rx={14} fill={CREAM_BG} />
      <rect x={1.5} y={1.5} width={297} height={297} rx={12.5} fill="none" stroke={BERRY} strokeOpacity={0.12} strokeWidth={3} />

      {v.shape !== "cupcakes" && v.shape !== "other" && <Plate />}
      {v.shape === "cupcakes" && <Plate wide />}

      {v.shape === "round" && <RoundBody v={v} />}
      {v.shape === "square" && <SquareBody v={v} />}
      {v.shape === "heart" && <HeartBody v={v} uid={uid} />}
      {v.shape === "cupcakes" && <CupcakesBody v={v} />}
      {v.shape === "other" && <OtherBody v={v} uid={uid} />}

      {decor && <DecorGlyphs icons={v.decorIcons} y={decor.y} xs={decor.xs} fontSize={decor.fontSize} />}

      {v.inscription && inscription && (
        <text
          x={inscription.x}
          y={inscription.y}
          textAnchor="middle"
          fontSize={15}
          fontWeight={600}
          fill={inscriptionFill}
          style={{
            fontFamily: "var(--font-script), 'Neucha', cursive",
            userSelect: "none",
            transition: "fill 400ms ease",
          }}
        >
          {v.inscription}
        </text>
      )}
    </svg>
  );
}
