/**
 * GET /api/products/[id]/slice-3d-config
 *
 * Возвращает конфигурацию 3D-сцены торта на основе слоёв среза.
 * Используется AR-viewer для генерации динамической 3D-модели из SliceConfig,
 * если у продукта нет готовой GLB-модели.
 *
 * Логика маппинга:
 *   - Каждый слой SliceConfig → цилиндр в 3D-сцене
 *   - coating → внешний материал (вертикальные стенки)
 *   - decoration → топпинг на верхней грани
 *   - height (1-5) → масштаб по Y (×0.2 единицы)
 *
 * Возвращает Three.js-совместимую конфигурацию (JSON),
 * которую AR-viewer рендерит через dynamic import three.js
 * (fallback когда нет готовой GLB).
 *
 * Безопасность:
 *   • GET: public endpoint.
 *   • При сбое БД — fallback на генерацию из названия начинки.
 *   • Type-safe interfaces для всех возвращаемых данных.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleRouteError, HttpError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface SupabaseError {
  message: string;
}

interface SliceLayer {
  type: string;
  color: string;
  label: string;
  height: number;
}

interface SliceConfig {
  layers: SliceLayer[];
  coating?: { color: string; label: string };
  decoration?: { type: string; color: string };
  shape?: string;
}

interface ProductSliceRow {
  id: string;
  filling_name: string;
  image: string | null;
  config: unknown;
  sort_order: number;
  created_at: string;
}

interface ProductRow {
  id: string;
  title: string;
  fillings: unknown;
  model_url: string | null;
  model_usdz_url: string | null;
  ar_enabled: boolean | null;
}

interface Filling {
  name: string;
  [key: string]: unknown;
}

interface Mesh3D {
  type: string;
  geometry: Record<string, unknown>;
  material: Record<string, unknown>;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y?: number; z?: number };
  scale?: { x: number; y: number; z: number };
  label?: string;
  layerType?: string;
  layerIndex?: number;
}

interface Scene3D {
  version: string;
  source: string;
  fillingName: string;
  totalHeight: number;
  radius: number;
  meshes: Mesh3D[];
  camera: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    fov: number;
  };
  lights: Array<Record<string, unknown>>;
  environment: string;
  autoRotate: boolean;
  autoRotateSpeed: number;
}

const LAYER_HEIGHT_UNIT = 0.2;
const LAYER_RADIUS = 1.0;
const COATING_THICKNESS = 0.05;

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: productId } = await params;
    if (!productId) throw new HttpError(400, "Product ID required");

    let product: ProductRow | null = null;
    let slices: ProductSliceRow[] = [];

    try {
      const [productResult, slicesResult] = await Promise.all([
        supabaseAdmin
          .from("products")
          .select("id, title, fillings, model_url, model_usdz_url, ar_enabled")
          .eq("id", productId)
          .maybeSingle() as unknown as Promise<{ data: ProductRow | null; error: SupabaseError | null }>,
        supabaseAdmin
          .from("product_slices")
          .select("id, filling_name, image, config, sort_order, created_at")
          .eq("product_id", productId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }) as unknown as Promise<{ data: ProductSliceRow[] | null; error: SupabaseError | null }>,
      ]);

      if (productResult.error) throw productResult.error;
      product = productResult.data;

      if (slicesResult.error) throw slicesResult.error;
      slices = slicesResult.data || [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[slice-3d-config] DB query failed:", msg);
    }

    // Если у продукта уже есть GLB-модель — 3D-генерация не нужна
    if (product?.model_url) {
      return NextResponse.json({
        productId,
        productName: product.title,
        hasModel: true,
        modelUrl: product.model_url,
        modelUsdzUrl: product.model_usdz_url,
        scene3d: null,
        message: "У продукта есть готовая 3D-модель — генерация из среза не требуется",
      });
    }

    // Если есть срезы — берём первый с config
    let sliceConfig: SliceConfig | null = null;
    let fillingName = "";

    if (slices.length > 0) {
      const sliceWithConfig = slices.find((s) => s.config);
      if (sliceWithConfig) {
        sliceConfig = sliceWithConfig.config as SliceConfig;
        fillingName = sliceWithConfig.filling_name;
      } else if (slices[0]?.image) {
        // Если есть только фото — используем как текстуру
        return NextResponse.json({
          productId,
          productName: product?.title,
          hasModel: false,
          scene3d: null,
          sliceImage: slices[0].image,
          message: "Есть фото среза — можно использовать как текстуру на 3D-модели",
        });
      }
    }

    // Fallback: генерируем базовую сцену из fillings продукта
    if (!sliceConfig && product?.fillings) {
      const fillings = product.fillings as Filling[];
      if (Array.isArray(fillings) && fillings.length > 0) {
        fillingName = fillings[0].name;
        sliceConfig = generateConfigFromName(fillingName);
      }
    }

    if (!sliceConfig) {
      return NextResponse.json({
        productId,
        hasModel: false,
        scene3d: null,
        message: "Недостаточно данных для генерации 3D-сцены",
      });
    }

    // === Маппинг SliceConfig → 3D-сцена ===
    const scene3d = mapSliceTo3DScene(sliceConfig, fillingName);

    return NextResponse.json({
      productId,
      productName: product?.title,
      hasModel: false,
      scene3d,
      source: {
        type: slices.length > 0 ? "product_slice" : "filling_name",
        fillingName,
        layersCount: sliceConfig.layers.length,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// Генерация 3D-сцены из SliceConfig
function mapSliceTo3DScene(config: SliceConfig, fillingName: string): Scene3D {
  let currentY = 0;
  const meshes: Mesh3D[] = [];

  // Слои (снизу вверх)
  config.layers.forEach((layer, i) => {
    const layerHeight = (layer.height || 1) * LAYER_HEIGHT_UNIT;
    meshes.push({
      type: "cylinder",
      geometry: {
        radiusTop: LAYER_RADIUS,
        radiusBottom: LAYER_RADIUS,
        height: layerHeight,
        radialSegments: 64,
      },
      material: {
        color: layer.color,
        roughness: getRoughnessByType(layer.type),
        metalness: getMetalnessByType(layer.type),
      },
      position: { x: 0, y: currentY + layerHeight / 2, z: 0 },
      label: layer.label,
      layerType: layer.type,
      layerIndex: i,
    });
    currentY += layerHeight;
  });

  // Покрытие (внешний слой — тонкая оболочка по бокам)
  if (config.coating) {
    meshes.push({
      type: "cylinder_shell",
      geometry: {
        radius: LAYER_RADIUS + COATING_THICKNESS,
        height: currentY + COATING_THICKNESS * 2,
        thickness: COATING_THICKNESS,
        radialSegments: 64,
      },
      material: {
        color: config.coating.color,
        roughness: 0.6,
        metalness: 0.0,
      },
      position: { x: 0, y: currentY / 2, z: 0 },
      label: config.coating.label,
      layerType: "coating",
    });

    // Тонкий диск покрытия сверху
    meshes.push({
      type: "cylinder",
      geometry: {
        radiusTop: LAYER_RADIUS + COATING_THICKNESS,
        radiusBottom: LAYER_RADIUS + COATING_THICKNESS,
        height: COATING_THICKNESS,
        radialSegments: 64,
      },
      material: {
        color: config.coating.color,
        roughness: 0.6,
      },
      position: { x: 0, y: currentY + COATING_THICKNESS / 2, z: 0 },
      label: `${config.coating.label} (верх)`,
      layerType: "coating_top",
    });
  }

  // Декор сверху
  if (config.decoration) {
    const decorationMeshes = generateDecorationMeshes(
      config.decoration,
      LAYER_RADIUS,
      currentY + COATING_THICKNESS
    );
    meshes.push(...decorationMeshes);
  }

  // Подложка (тарелка)
  meshes.push({
    type: "cylinder",
    geometry: {
      radiusTop: LAYER_RADIUS + 0.3,
      radiusBottom: LAYER_RADIUS + 0.3,
      height: 0.05,
      radialSegments: 64,
    },
    material: {
      color: "#f3f4f6",
      roughness: 0.3,
      metalness: 0.1,
    },
    position: { x: 0, y: -0.025, z: 0 },
    label: "Подложка",
    layerType: "plate",
  });

  return {
    version: "1.0",
    source: "slice_config",
    fillingName,
    totalHeight: currentY + COATING_THICKNESS * 2 + (config.decoration ? 0.1 : 0),
    radius: LAYER_RADIUS + COATING_THICKNESS,
    meshes,
    camera: {
      position: { x: 2.5, y: 2.0, z: 2.5 },
      target: { x: 0, y: currentY / 2, z: 0 },
      fov: 35,
    },
    lights: [
      { type: "ambient", intensity: 0.6, color: "#ffffff" },
      { type: "directional", intensity: 0.8, color: "#ffffff", position: { x: 3, y: 5, z: 3 } },
      { type: "directional", intensity: 0.4, color: "#ffe4c4", position: { x: -3, y: 3, z: -2 } },
    ],
    environment: "neutral",
    autoRotate: true,
    autoRotateSpeed: 0.5,
  };
}

function getRoughnessByType(type: string): number {
  switch (type) {
    case "chocolate": return 0.4;
    case "cream": return 0.3;
    case "mousse": return 0.2;
    case "berry": return 0.6;
    case "caramel": return 0.2;
    case "biscuit": return 0.7;
    default: return 0.5;
  }
}

function getMetalnessByType(type: string): number {
  switch (type) {
    case "chocolate": return 0.1;
    case "caramel": return 0.2;
    case "mousse": return 0.05;
    default: return 0.0;
  }
}

function generateDecorationMeshes(
  decoration: { type: string; color: string },
  _radius: number,
  topY: number
): Mesh3D[] {
  const meshes: Mesh3D[] = [];

  if (decoration.type === "berries") {
    const positions = [
      { x: -0.4, z: 0 },
      { x: 0, z: -0.3 },
      { x: 0.3, z: 0.2 },
      { x: -0.1, z: 0.4 },
    ];
    positions.forEach((pos, i) => {
      meshes.push({
        type: "sphere",
        geometry: { radius: 0.12, widthSegments: 32, heightSegments: 32 },
        material: { color: decoration.color, roughness: 0.4 },
        position: { x: pos.x, y: topY + 0.1, z: pos.z },
        label: `Ягода ${i + 1}`,
        layerType: "decoration_berry",
      });
    });
  } else if (decoration.type === "chocolate") {
    meshes.push({
      type: "torus",
      geometry: { radius: 0.6, tube: 0.05, radialSegments: 16, tubularSegments: 64 },
      material: { color: decoration.color, roughness: 0.4, metalness: 0.1 },
      position: { x: 0, y: topY + 0.05, z: 0 },
      rotation: { x: Math.PI / 2 },
      label: "Шоколадная волна",
      layerType: "decoration_chocolate",
    });
  } else if (decoration.type === "nuts") {
    const positions = [
      { x: -0.3, z: -0.2 },
      { x: 0.2, z: -0.3 },
      { x: 0.3, z: 0.2 },
      { x: -0.2, z: 0.3 },
    ];
    positions.forEach((pos, i) => {
      meshes.push({
        type: "sphere",
        geometry: { radius: 0.08, widthSegments: 16, heightSegments: 16 },
        material: { color: decoration.color, roughness: 0.8 },
        position: { x: pos.x, y: topY + 0.06, z: pos.z },
        scale: { x: 1, y: 1.3, z: 0.8 },
        label: `Орех ${i + 1}`,
        layerType: "decoration_nut",
      });
    });
  } else if (decoration.type === "sprinkles") {
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const r = 0.3 + (i % 3) * 0.15;
      meshes.push({
        type: "cylinder",
        geometry: { radiusTop: 0.02, radiusBottom: 0.02, height: 0.08, radialSegments: 8 },
        material: { color: decoration.color, roughness: 0.5 },
        position: {
          x: Math.cos(angle) * r,
          y: topY + 0.04,
          z: Math.sin(angle) * r,
        },
        rotation: { x: (Math.random() - 0.5) * 0.5, z: (Math.random() - 0.5) * 0.5 },
        label: `Посыпка ${i + 1}`,
        layerType: "decoration_sprinkle",
      });
    }
  }

  return meshes;
}

function generateConfigFromName(name: string): SliceConfig {
  const n = name.toLowerCase();
  if (n.includes("шоколад") || n.includes("chocolate")) {
    return {
      layers: [
        { type: "chocolate", color: "#3d2817", label: "Шоколадный бисквит", height: 3 },
        { type: "cream", color: "#1a0d08", label: "Ганаш", height: 1 },
        { type: "chocolate", color: "#3d2817", label: "Шоколадный бисквит", height: 3 },
      ],
      coating: { color: "#1a0d08", label: "Ганаш" },
      decoration: { type: "chocolate", color: "#3d2817" },
      shape: "round",
    };
  }
  return {
    layers: [
      { type: "biscuit", color: "#f4e4c1", label: "Бисквит", height: 3 },
      { type: "cream", color: "#fffaeb", label: "Крем", height: 2 },
      { type: "biscuit", color: "#f4e4c1", label: "Бисквит", height: 3 },
    ],
    coating: { color: "#fffaeb", label: "Крем" },
    shape: "round",
  };
}
