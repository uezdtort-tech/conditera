// Seed script — заполнение БД начальными данными
// Запуск: bun run db:seed
//
// Uses native PostgreSQL types: Json, String[], enums.
// (Same code works against PGlite in dev and real PostgreSQL in prod.)
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

async function main() {
  console.log("🌱 Начинаем заполнение БД (PostgreSQL)...");

  const customerPassword = await hashPassword("demo123");
  const adminPassword = await hashPassword("admin123");

  // ===== Пользователи =====
  const customer = await db.user.upsert({
    where: { email: "customer@demo.ru" },
    update: {},
    create: {
      email: "customer@demo.ru",
      passwordHash: customerPassword,
      name: "Анна Соколова",
      phone: "+7 916 123-45-67",
      avatar: "https://i.pravatar.cc/150?img=47",
      roles: ["CUSTOMER"],
      city: "Москва",
      loyaltyLevel: "GOLD",
      bonusBalance: 1240,
    },
  });

  const confectionerUser = await db.user.upsert({
    where: { email: "confectioner@demo.ru" },
    update: {},
    create: {
      email: "confectioner@demo.ru",
      passwordHash: customerPassword,
      name: "Мария Уездная",
      phone: "+7 905 222-33-44",
      avatar: "https://i.pravatar.cc/150?img=32",
      roles: ["CONFECTIONER", "CUSTOMER"],
      city: "Тула",
    },
  });

  const admin = await db.user.upsert({
    where: { email: "admin@demo.ru" },
    update: {},
    create: {
      email: "admin@demo.ru",
      passwordHash: adminPassword,
      name: "Администратор Платформы",
      phone: "+7 495 000-00-01",
      avatar: "https://i.pravatar.cc/150?img=68",
      roles: ["ADMIN", "SUPER_ADMIN"],
      city: "Москва",
    },
  });

  // Семафоры (уникальность email/телефона)
  await db.semaphore.upsert({
    where: { value: "customer@demo.ru" },
    update: {},
    create: { type: "email", value: "customer@demo.ru", userId: customer.id, verified: true },
  });
  await db.semaphore.upsert({
    where: { value: "+7 916 123-45-67" },
    update: {},
    create: { type: "phone", value: "+7 916 123-45-67", userId: customer.id, verified: true },
  });

  // ===== Кондитер =====
  const confectioner = await db.confectioner.upsert({
    where: { slug: "sladkaya-uezdnaya" },
    update: {},
    create: {
      userId: confectionerUser.id,
      businessName: "Сладкая уездная",
      slug: "sladkaya-uezdnaya",
      description:
        "Домашняя кондитерская из Тулы. Специализируемся на бисквитных тортах, медовиках и авторских десертах.",
      avatar: "https://i.pravatar.cc/150?img=32",
      cover: "https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=1200",
      city: "Тула",
      location: {
        country: "Россия",
        region: "Тульская область",
        city: "Тула",
        district: "Центральный",
        street: "ул. Первомайская",
        house: "12",
        lat: 54.1961,
        lng: 37.6182,
        serviceRadiusKm: 25,
        deliveryCities: ["Тула", "Щёкино", "Новомосковск", "Алексин"],
      },
      rating: 4.9,
      reviewsCount: 247,
      ordersCount: 1248,
      verified: true,
      trustLevel: "MASTER",
      tariff: "PREMIUM",
      legalInfo: {
        status: "NPD",
        inn: "710200012345",
        npdRegisteredAt: "2019-08-20",
        documentsVerified: true,
        verifiedAt: "2019-09-01",
      },
      taxMode: "NPD",
      specialization: [
        "Бисквитные торты",
        "Медовики",
        "Авторские десерты",
        "Капкейки",
      ],
      portfolioImages: [
        "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600",
        "https://images.unsplash.com/photo-1535141192574-5d4897c12636?w=600",
      ],
      followersCount: 3420,
      responseTime: "обычно отвечает в течение часа",
      selfPickup: true,
      deliveryOptions: ["own", "courier", "pickup_point"],
      paymentSettings: {
        acceptCard: true,
        acceptSbp: true,
        acceptCash: true,
        acceptSplit: true,
        acceptInstallment: true,
        installmentMinAmount: 1500,
        installmentProviders: ["split", "tinkoff"],
        installmentPlans: [
          {
            id: "ip1_c1",
            name: "Рассрочка на 3 месяца",
            months: 3,
            interestRate: 0,
            minAmount: 1500,
            downPaymentPercent: 0,
            provider: "split",
            description: "Беспроцентная рассрочка на 3 месяца через Сплит",
            isActive: true,
          },
        ],
      },
      ecoBadges: ["no_preservatives", "no_margarine", "local_ingredients", "biodegradable_packaging"],
      balance: 84200,
      totalEarnings: 1284000,
      monthlyEarnings: 184000,
    },
  });

  // ===== Товар =====
  await db.product.upsert({
    where: { slug: "conditera-classic" },
    update: {},
    create: {
      title: "Торт «Уездный классический»",
      slug: "conditera-classic",
      description:
        "Бисквитный торт с нежным кремом пломбир и варёной сгущёнкой. Пропитан сиропом, украшен свежими ягодами.",
      price: 2400,
      oldPrice: 2900,
      category: "cakes",
      images: [
        "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800",
      ],
      confectionerId: confectioner.id,
      rating: 4.9,
      reviewsCount: 87,
      weight: "1.5 кг",
      servings: 10,
      prepTime: "2 дня",
      isPopular: true,
      isHit: true,
      tags: ["бисквит", "сгущёнка", "ягоды"],
      fillings: [
        { name: "Варёная сгущёнка", priceModifier: 0 },
        { name: "Крем пломбир", priceModifier: 200 },
      ],
      coatings: [
        { name: "Крем-чиз", priceModifier: 0 },
        { name: "Ганаш белый", priceModifier: 200 },
      ],
      decorations: [
        { name: "Свежие ягоды", priceModifier: 400 },
        { name: "Безе", priceModifier: 300 },
      ],
      paymentOptions: {
        acceptCard: true,
        acceptSbp: true,
        acceptCash: true,
        acceptInstallment: true,
        availableInstallments: ["ip1_c1"],
      },
      // AR / 3D preview
      modelUrl: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
      arEnabled: true,
    },
  });

  // ===== Уведомления и предпочтения =====
  // Create default notification preferences for the customer
  await db.notificationPreferences.upsert({
    where: { userId: customer.id },
    update: {},
    create: {
      userId: customer.id,
      emailEnabled: true,
      smsEnabled: false,
      pushEnabled: true,
      telegramEnabled: false,
      inAppEnabled: true,
    },
  });

  // Welcome bonus for the customer
  await db.loyaltyTransaction.create({
    data: {
      userId: customer.id,
      type: "BONUS_WELCOME",
      points: 100,
      balanceAfter: 1340,
      description: "Приветственный бонус (100 баллов)",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // ===== Начинки для тортов (48 системных начинок) =====
  const { seedFillings } = await import("../src/lib/fillings-seed");
  await seedFillings();

  console.log("✅ БД заполнена начальными данными");
  console.log("   Пользователи:");
  console.log("   - customer@demo.ru / demo123 (покупатель)");
  console.log("   - confectioner@demo.ru / demo123 (кондитер)");
  console.log("   - admin@demo.ru / admin123 (админ)");
}

main()
  .catch((e) => {
    console.error("❌ Ошибка заполнения БД:", e);
    process.exit(1);
  })
  .finally(async () => {
    await (await import("../src/lib/db")).getDb().then((c) => c.$disconnect());
  });
