/**
 * Geocoder — расширяем определение координат по произвольному адресу/городу.
 *
 * Стратегия (fallback chain):
 *   1. Если переданы точные координаты (lat/lng) — используем напрямую.
 *   2. Пробуем словарь CITY_COORDS (быстро, без API-вызовов, ~120 городов РФ).
 *   3. Если установлен DADATA_API_KEY — запрашиваем DaData Suggestions API (адрес→координаты).
 *   4. Если установлен YANDEX_GEOCODER_API_KEY — запрашиваем Яндекс.Геокодер.
 *   5. Если ничего не помогло — возвращаем null (UI скажет "укажите город точнее").
 *
 * Соответствие 152-ФЗ: внешние запросы делаются только по адресу пользователя,
 * который он ввёл вручную. IP-адрес не передаётся третьим сторонам.
 */

export interface GeoCoords {
  lat: number;
  lng: number;
  source: "city_dict" | "dadata" | "yandex" | "passed_coords";
  formatted?: string; // нормализованное название (например, "г. Москва")
}

// ===== 1. Словарь координат: столицы субъектов РФ + крупные города =====
// Источник: открытые данные Яндекс.Карт / ФИАС, координаты центра города.
export const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  // === Города федерального значения ===
  "москва": { lat: 55.7558, lng: 37.6173 },
  "мск": { lat: 55.7558, lng: 37.6173 },
  "санкт-петербург": { lat: 59.9343, lng: 30.3351 },
  "спб": { lat: 59.9343, lng: 30.3351 },
  "петербург": { lat: 59.9343, lng: 30.3351 },
  "питер": { lat: 59.9343, lng: 30.3351 },
  "севастополь": { lat: 44.6166, lng: 33.5254 },
  // === Столицы областей (центральный округ) ===
  "белгород": { lat: 50.5956, lng: 36.5873 },
  "брянск": { lat: 53.2433, lng: 34.3637 },
  "владимир": { lat: 56.1290, lng: 40.4066 },
  "воронеж": { lat: 51.6608, lng: 39.2003 },
  "иваново": { lat: 57.0004, lng: 40.9734 },
  "калуга": { lat: 54.5293, lng: 36.2754 },
  "кострома": { lat: 57.7679, lng: 40.9269 },
  "курск": { lat: 51.7373, lng: 36.1871 },
  "липецк": { lat: 52.6031, lng: 39.5708 },
  "орёл": { lat: 52.9676, lng: 36.0692 },
  "орел": { lat: 52.9676, lng: 36.0692 },
  "рязань": { lat: 54.6265, lng: 39.7446 },
  "смоленск": { lat: 54.7825, lng: 32.0453 },
  "тамбов": { lat: 52.7212, lng: 41.4523 },
  "тверь": { lat: 56.8587, lng: 35.9006 },
  "тула": { lat: 54.1961, lng: 37.6182 },
  "ярославль": { lat: 57.6261, lng: 39.8845 },
  // === Столицы областей (северо-запад) ===
  "архангельск": { lat: 64.5394, lng: 40.5170 },
  "великий новгород": { lat: 58.5214, lng: 31.2710 },
  "вологда": { lat: 59.2184, lng: 39.8916 },
  "калининград": { lat: 54.7065, lng: 20.5110 },
  "петрозаводск": { lat: 61.7849, lng: 34.3469 },
  "мурманск": { lat: 68.9585, lng: 33.0827 },
  "псков": { lat: 57.8193, lng: 28.3325 },
  "сыктывкар": { lat: 61.6666, lng: 50.8336 },
  "narjan-mar": { lat: 67.6386, lng: 53.0202 },
  "нарьян-мар": { lat: 67.6386, lng: 53.0202 },
  // === Столицы регионов (южный и северо-кавказский) ===
  "майкоп": { lat: 44.6098, lng: 40.1001 },
  "астрахань": { lat: 46.3497, lng: 48.0336 },
  "волгоград": { lat: 48.7080, lng: 44.5133 },
  "краснодар": { lat: 45.0355, lng: 38.9753 },
  "ростов-на-дону": { lat: 47.2357, lng: 39.7015 },
  "ростов": { lat: 47.2357, lng: 39.7015 },
  "элиста": { lat: 46.3078, lng: 44.2554 },
  "ставрополь": { lat: 45.0433, lng: 41.9691 },
  "грозный": { lat: 43.3178, lng: 44.8304 },
  "махачкала": { lat: 42.9849, lng: 47.5047 },
  "владикавказ": { lat: 43.0367, lng: 44.6678 },
  "нальчик": { lat: 43.4938, lng: 43.6189 },
  "черкесск": { lat: 44.2233, lng: 42.0578 },
  "магас": { lat: 43.1681, lng: 44.8076 },
  // === Столицы регионов (приволжский) ===
  "киров": { lat: 58.6035, lng: 49.6679 },
  "йошкар-ола": { lat: 56.6388, lng: 47.8907 },
  "казань": { lat: 55.8304, lng: 49.0661 },
  "нижний новгород": { lat: 56.2965, lng: 43.9361 },
  "нижний": { lat: 56.2965, lng: 43.9361 },
  "чебоксары": { lat: 56.1439, lng: 47.2489 },
  "пенза": { lat: 53.1959, lng: 45.0207 },
  "самара": { lat: 53.1959, lng: 50.1008 },
  "саранск": { lat: 54.1838, lng: 45.1749 },
  "саратов": { lat: 51.5336, lng: 46.0343 },
  "ульяновск": { lat: 54.3171, lng: 48.3981 },
  "ижевск": { lat: 56.8527, lng: 53.2115 },
  "уфа": { lat: 54.7388, lng: 55.9721 },
  "кизляр": { lat: 43.8497, lng: 46.7194 },
  "пермь": { lat: 58.0105, lng: 56.2502 },
  "кунгур": { lat: 57.4329, lng: 56.9447 },
  "биробиджан": { lat: 48.7939, lng: 132.9235 },
  // === Столицы регионов (уральский) ===
  "екатеринбург": { lat: 56.8389, lng: 60.6057 },
  "екб": { lat: 56.8389, lng: 60.6057 },
  "челябинск": { lat: 55.1644, lng: 61.4368 },
  "тюмень": { lat: 57.1522, lng: 65.5272 },
  "курган": { lat: 55.4433, lng: 65.3400 },
  // === Столицы регионов (сибирский) ===
  "барнаул": { lat: 53.3468, lng: 83.7768 },
  "горно-алтайск": { lat: 51.9608, lng: 85.9574 },
  "иркутск": { lat: 52.2978, lng: 104.2964 },
  "кемерово": { lat: 55.3547, lng: 86.0866 },
  "красноярск": { lat: 56.0153, lng: 92.8932 },
  "новосибирск": { lat: 55.0084, lng: 82.9357 },
  "новосиб": { lat: 55.0084, lng: 82.9357 },
  "омск": { lat: 54.9893, lng: 73.3682 },
  "томск": { lat: 56.4847, lng: 84.9476 },
  "абакан": { lat: 53.7216, lng: 91.4433 },
  "кызыл": { lat: 51.7143, lng: 94.4534 },
  // === Столицы регионов (дальневосточный) ===
  "благовещенск": { lat: 50.2907, lng: 127.5272 },
  "владивосток": { lat: 43.1198, lng: 131.8869 },
  "хабаровск": { lat: 48.4726, lng: 135.0577 },
  "ялта": { lat: 44.4953, lng: 34.1663 },
  "южно-сахалинск": { lat: 46.9596, lng: 142.7388 },
  "магадан": { lat: 59.5639, lng: 150.8035 },
  "петропавловск-камчатский": { lat: 53.0452, lng: 158.6483 },
  "петропавловск": { lat: 53.0452, lng: 158.6483 },
  "анадырь": { lat: 64.7336, lng: 177.5088 },
  "якутск": { lat: 62.0281, lng: 129.7326 },
  "ханты-мансийск": { lat: 61.0031, lng: 69.0225 },
  "салехард": { lat: 66.5300, lng: 66.6086 },
  "находка": { lat: 42.8230, lng: 132.8733 },
  "уссурийск": { lat: 43.7978, lng: 131.9531 },
  // === Крупные города Подмосковья ===
  "балашиха": { lat: 55.8089, lng: 37.9660 },
  "химки": { lat: 55.8898, lng: 37.4018 },
  "подольск": { lat: 55.4310, lng: 37.5450 },
  "королёв": { lat: 55.9164, lng: 37.8496 },
  "королев": { lat: 55.9164, lng: 37.8496 },
  "мытищи": { lat: 55.9116, lng: 37.7308 },
  "люберцы": { lat: 55.6797, lng: 37.9027 },
  "электросталь": { lat: 55.7847, lng: 38.4453 },
  "красногорск": { lat: 55.8316, lng: 37.3328 },
  "коломна": { lat: 55.0794, lng: 38.7908 },
  "одинцово": { lat: 55.6700, lng: 37.2789 },
  "серпухов": { lat: 54.9227, lng: 37.4116 },
  "орехово-зуево": { lat: 55.8018, lng: 38.9730 },
  "раменское": { lat: 55.5647, lng: 38.2219 },
  "долгопрудный": { lat: 55.8945, lng: 37.5131 },
  "жуковский": { lat: 55.6036, lng: 38.1161 },
  "пушкино": { lat: 56.0053, lng: 37.8497 },
  "ногинск": { lat: 55.8561, lng: 38.4413 },
  "реутов": { lat: 55.7568, lng: 37.8591 },
  "сергиев посад": { lat: 56.3004, lng: 38.1340 },
  "воскресенск": { lat: 55.3179, lng: 38.6578 },
  "лобня": { lat: 56.4888, lng: 37.4740 },
  "клин": { lat: 56.3373, lng: 36.7240 },
  "дубна": { lat: 56.7317, lng: 37.1672 },
  "волоколамск": { lat: 56.9555, lng: 35.9567 },
  // === Крупные города Ленинградской области ===
  "выборг": { lat: 60.7116, lng: 28.7466 },
  "гатчина": { lat: 59.5624, lng: 30.1261 },
  "всеволожск": { lat: 59.9784, lng: 30.6447 },
  "тикиви": { lat: 60.0050, lng: 30.6400 },
  "кронштадт": { lat: 59.9867, lng: 29.7667 },
  // === Прочие крупные города РФ ===
  "сочи": { lat: 43.5855, lng: 39.7231 },
  "анапа": { lat: 44.8910, lng: 37.3199 },
  "новороссийск": { lat: 44.7235, lng: 37.7689 },
  "симферополь": { lat: 44.9521, lng: 34.1024 },
  "керчь": { lat: 45.3558, lng: 36.4731 },
  "евпатория": { lat: 45.2010, lng: 33.3631 },
  "набережные челны": { lat: 55.7326, lng: 52.4244 },
  "нижнекамск": { lat: 55.6333, lng: 51.8167 },
  "альметьевск": { lat: 54.9020, lng: 52.2967 },
  "новокузнецк": { lat: 53.7563, lng: 87.1361 },
  "прокопьевск": { lat: 53.8769, lng: 86.7147 },
  "бииск": { lat: 52.5414, lng: 85.2147 },
  "ангарск": { lat: 52.5449, lng: 103.9080 },
  "братск": { lat: 56.1514, lng: 101.6342 },
  "усолье-сибирское": { lat: 52.7333, lng: 103.6500 },
  "норильск": { lat: 69.3421, lng: 88.2010 },
  "миасс": { lat: 55.0453, lng: 60.1075 },
  "магнитогорск": { lat: 53.4072, lng: 58.9787 },
  "златоуст": { lat: 55.1716, lng: 59.6619 },
  "первоуральск": { lat: 56.9061, lng: 59.9447 },
  "каменск-уральский": { lat: 56.4253, lng: 61.3475 },
  "нижний тагил": { lat: 57.9189, lng: 59.9700 },
  "верхняя салда": { lat: 57.9950, lng: 60.5383 },
  "новочеркасск": { lat: 47.4118, lng: 40.1028 },
  "шахты": { lat: 47.7133, lng: 40.2147 },
  "волгодонск": { lat: 47.5136, lng: 42.1439 },
  "новошахтинск": { lat: 47.7589, lng: 39.9522 },
  "таганрог": { lat: 47.2214, lng: 38.9269 },
  "рубцовск": { lat: 51.3144, lng: 81.2250 },
  "бийск": { lat: 52.5414, lng: 85.2147 },
  "сызрань": { lat: 53.1496, lng: 48.4747 },
  "новомосковск": { lat: 54.0167, lng: 38.2833 },
  "щёкино": { lat: 54.0089, lng: 37.5264 },
  "щекино": { lat: 54.0089, lng: 37.5264 },
  "алексин": { lat: 54.2067, lng: 37.0633 },
  "урюпинск": { lat: 50.7925, lng: 42.0186 },
  "мичуринск": { lat: 52.9167, lng: 40.4833 },
  "рассказово": { lat: 52.6333, lng: 41.8667 },
  "волжский": { lat: 48.7858, lng: 44.7764 },
  "камышин": { lat: 50.0833, lng: 45.4167 },
  "москва-сити": { lat: 55.7494, lng: 37.5377 },
  // === Крупные города Башкортостана / Татарстана ===
  "стерлитамак": { lat: 53.6294, lng: 55.9544 },
  "салават": { lat: 53.3500, lng: 55.9333 },
  "нефтекамск": { lat: 56.0833, lng: 54.2333 },
  "октябрьский": { lat: 54.4833, lng: 53.4667 },
  "бугульма": { lat: 54.5333, lng: 52.7833 },
  "елитовка": { lat: 53.3500, lng: 55.9333 },
  "азнакаево": { lat: 54.3833, lng: 53.0667 },
  "заинск": { lat: 55.2833, lng: 52.0000 },
  // === Прочие ===
  "старый оскол": { lat: 51.2933, lng: 37.8358 },
  "губкин": { lat: 51.2811, lng: 37.1872 },
  "шевченко": { lat: 51.2933, lng: 37.8358 },
  "великие луки": { lat: 56.3373, lng: 30.5533 },
  "северодвинск": { lat: 64.5833, lng: 39.8333 },
  "новодвинск": { lat: 64.4131, lng: 40.8328 },
  "ухта": { lat: 63.5531, lng: 53.6872 },
  "воркута": { lat: 67.5497, lng: 64.0831 },
  "инта": { lat: 65.9911, lng: 60.0969 },
  "сосногорск": { lat: 63.5864, lng: 53.9242 },
  "усинск": { lat: 65.9833, lng: 57.3833 },
  "печора": { lat: 65.1333, lng: 57.1167 },
};

// ===== 2. DaData Suggestions API (address → coords) =====
async function geocodeWithDaData(query: string): Promise<GeoCoords | null> {
  const apiKey = process.env.DADATA_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Token ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        count: 1,
        from_bound: { value: "city" },
        to_bound: { value: "city" },
      }),
      // DaData limit: 10 req/s на бесплатном тарифе
      cache: "no-store",
    });

    if (!res.ok) return null;
    const data = await res.json();
    const suggestion = data?.suggestions?.[0];
    if (!suggestion?.data) return null;

    const lat = parseFloat(suggestion.data.geo_lat);
    const lng = parseFloat(suggestion.data.geo_lon);
    if (isNaN(lat) || isNaN(lng)) return null;

    return {
      lat,
      lng,
      source: "dadata",
      formatted: suggestion.value || suggestion.data.city || query,
    };
  } catch {
    return null;
  }
}

// ===== 3. Yandex Geocoder API (address → coords) =====
// Docs: https://yandex.ru/dev/maps/geocoder/doc/desc/concepts/input.html
async function geocodeWithYandex(query: string): Promise<GeoCoords | null> {
  const apiKey = process.env.YANDEX_GEOCODER_API_KEY;
  if (!apiKey) return null;

  try {
    const params = new URLSearchParams({
      apikey: apiKey,
      format: "json",
      geocode: query,
      lang: "ru_RU",
      results: "1",
    });
    const res = await fetch(`https://geocode-maps.yandex.ru/1.x/?${params.toString()}`, {
      cache: "no-store",
    });

    if (!res.ok) return null;
    const data = await res.json();
    const member = data?.response?.GeoObjectCollection?.featureMember?.[0];
    if (!member?.GeoObject) return null;

    // Yandex возвращает координаты в формате "lng,lat"!
    const point: string = member.GeoObject.Point?.pos || "";
    const [lngStr, latStr] = point.split(" ");
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (isNaN(lat) || isNaN(lng)) return null;

    const formatted = member.GeoObject.metaDataProperty?.GeocoderMetaData?.text || query;

    return { lat, lng, source: "yandex", formatted };
  } catch {
    return null;
  }
}

// ===== Главная функция: resolveCoords =====
export async function resolveCoords(
  query: string | { lat: number; lng: number } | null | undefined,
): Promise<GeoCoords | null> {
  if (!query) return null;

  // 0. Если переданы готовые координаты
  if (typeof query === "object" && typeof query.lat === "number" && typeof query.lng === "number") {
    return { ...query, source: "passed_coords" };
  }

  if (typeof query !== "string") return null;
  const normalized = query.trim().toLowerCase();

  // 1. Пробуем словарь
  if (CITY_COORDS[normalized]) {
    return { ...CITY_COORDS[normalized], source: "city_dict", formatted: query };
  }

  // Также пробуем с префиксом "г. "
  if (normalized.startsWith("г ") || normalized.startsWith("г. ")) {
    const stripped = normalized.replace(/^г[.\s]+/, "").trim();
    if (CITY_COORDS[stripped]) {
      return { ...CITY_COORDS[stripped], source: "city_dict", formatted: query };
    }
  }

  // 2. DaData
  const dadataResult = await geocodeWithDaData(query);
  if (dadataResult) return dadataResult;

  // 3. Yandex
  const yandexResult = await geocodeWithYandex(query);
  if (yandexResult) return yandexResult;

  return null;
}

// Haversine formula — расстояние между двумя точками в км
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // км
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Список поддерживаемых городов — для UI (autocomplete)
export const SUPPORTED_CITIES: { value: string; label: string }[] = Object.keys(CITY_COORDS)
  .filter((k) => !k.includes("-")) // убираем дубли-сокращения типа "мск", "екб"
  .map((k) => ({
    value: k,
    label: k.charAt(0).toUpperCase() + k.slice(1),
  }))
  .sort((a, b) => a.label.localeCompare(b.label, "ru"));
