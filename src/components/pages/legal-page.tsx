"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, Shield, FileText, Lock, Check, AlertCircle,
  Eye, Database, Mail, User, Trash2, Download,
} from "lucide-react";

type LegalPage = "privacy" | "terms" | "offer" | "consent" | "cookies";

export function LegalPage({ page }: { page: LegalPage }) {
  const navigate = useAppStore((s) => s.navigate);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    // Проверяем, принял ли пользователь
    const stored = localStorage.getItem("uk_legal_accepted");
    if (stored) {
      const data = JSON.parse(stored);
      setAccepted(data[page] === true);
    }
  }, [page]);

  const handleAccept = () => {
    const stored = localStorage.getItem("uk_legal_accepted");
    const data = stored ? JSON.parse(stored) : {};
    data[page] = true;
    data[`${page}_date`] = new Date().toISOString();
    localStorage.setItem("uk_legal_accepted", JSON.stringify(data));
    setAccepted(true);
    import("sonner").then(({ toast }) => {
      toast.success("Согласие принято");
    });
  };

  const pageInfo: Record<LegalPage, { title: string; icon: typeof Shield; updated: string }> = {
    privacy: { title: "Политика конфиденциальности", icon: Lock, updated: "01.07.2026" },
    terms: { title: "Пользовательское соглашение", icon: FileText, updated: "01.07.2026" },
    offer: { title: "Договор-оферта", icon: FileText, updated: "01.07.2026" },
    consent: { title: "Согласие на обработку персональных данных", icon: Shield, updated: "01.07.2026" },
    cookies: { title: "Политика использования cookies", icon: Database, updated: "01.07.2026" },
  };

  const info = pageInfo[page];
  const Icon = info.icon;

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <button
        onClick={() => navigate("home")}
        className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mb-4"
      >
        <ChevronLeft className="h-4 w-4" /> На главную
      </button>

      <Card className="p-6 lg:p-8">
        {/* Заголовок */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{info.title}</h1>
            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
              <span>Редакция от {info.updated}</span>
              {accepted && (
                <Badge className="bg-emerald-500 text-white text-[10px]">
                  <Check className="h-2.5 w-2.5 mr-0.5" /> Принято
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Содержимое — с буквицей на первом абзаце (дореволюционный книжный стиль) */}
        <div className="prose prose-sm dark:prose-invert max-w-none space-y-4 prose-dropcap">
          {page === "consent" && <ConsentContent />}
          {page === "privacy" && <PrivacyContent />}
          {page === "terms" && <TermsContent />}
          {page === "offer" && <OfferContent />}
          {page === "cookies" && <CookiesContent />}
        </div>

        {/* Кнопка принятия */}
        {!accepted && (page === "consent" || page === "terms" || page === "offer") && (
          <div className="mt-8 p-4 border-2 border-primary/30 rounded-xl bg-primary/5">
            <div className="flex items-start gap-3 mb-3">
              <AlertCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm">
                Для использования платформы необходимо принять {info.title.toLowerCase()}.
                Нажимая кнопку, вы подтверждаете, что ознакомились с документом и согласны с его условиями.
              </p>
            </div>
            <Button onClick={handleAccept} className="w-full">
              <Check className="h-4 w-4 mr-2" />
              Принимаю, продолжить
            </Button>
          </div>
        )}

        {accepted && (page === "consent" || page === "terms" || page === "offer") && (
          <div className="mt-6 p-3 border border-emerald-200 dark:border-emerald-900 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-500" />
            <span className="text-sm text-emerald-700 dark:text-emerald-300">
              Вы приняли {info.title.toLowerCase()}
            </span>
          </div>
        )}
      </Card>

      {/* Навигация по юр. документам */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-2">
        {(Object.keys(pageInfo) as LegalPage[]).map((p) => {
          const PIcon = pageInfo[p].icon;
          return (
            <button
              key={p}
              onClick={() => navigate("about", { legal: p })}
              className={`p-3 rounded-lg border text-left transition ${
                p === page
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-accent/30"
              }`}
            >
              <PIcon className="h-4 w-4 mb-1.5 text-muted-foreground" />
              <div className="text-xs font-medium leading-tight">{pageInfo[p].title}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ===== СОДЕРЖИМОЕ: СОГЛАСИЕ НА ОБРАБОТКУ ПД =====
function ConsentContent() {
  return (
    <>
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 rounded-lg p-4 mb-4">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
          ⚠️ Внимание! Данное согласие является обязательным для регистрации и использования платформы.
        </p>
      </div>

      <h2 className="text-lg font-bold">1. Общие положения</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Настоящее согласие на обработку персональных данных (далее — «Согласие») составлено в соответствии с
        требованиями Федерального закона от 27.07.2006 № 152-ФЗ «О персональных данных» (далее — «Закон о персональных данных»)
        и регулирует порядок обработки и использования персональных данных Пользователя платформы «Уездный кондитер»
        (далее — «Платформа»), оператором которой является ООО «Уездный кондитер» (далее — «Оператор»).
      </p>

      <h2 className="text-lg font-bold mt-4">2. Состав персональных данных</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-2">
        Пользователь, оставляя свои данные на Платформе, даёт согласие на обработку следующих персональных данных:
      </p>
      <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
        <li>Фамилия, имя, отчество (или имя)</li>
        <li>Адрес электронной почты (e-mail)</li>
        <li>Номер контактного телефона</li>
        <li>Город и регион проживания</li>
        <li>Фотография (аватар пользователя)</li>
        <li>IP-адрес и данные браузера (cookies, user-agent)</li>
        <li>Реквизиты юридического лица (для ИП и ООО): ИНН, ОГРН, название компании</li>
        <li>Фотографии загружаемых работ кондитера (торты, десерты)</li>
        <li>Данные заказов: адрес доставки, состав заказа, комментарии</li>
      </ul>

      <h2 className="text-lg font-bold mt-4">3. Цели обработки</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-2">
        Персональные данные обрабатываются в следующих целях:
      </p>
      <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
        <li>Идентификация и авторизация Пользователя на Платформе</li>
        <li>Оформление и исполнение заказов кондитерских изделий</li>
        <li>Организация доставки заказов через курьерскую службу</li>
        <li>Приём платежей через платёжный шлюз YooKassa</li>
        <li>Обеспечение коммуникации между покупателями, кондитерами и курьерами</li>
        <li>Публикация работ кондитеров в портфолио и каталоге</li>
        <li>Предоставление клиентской поддержки и разрешения споров</li>
        <li>Информирование о статусах заказов, акциях и новостях</li>
        <li>Соблюдение требований налогового законодательства (НПД, УСН)</li>
        <li>Обеспечение безопасности платформы и предотвращение мошенничества</li>
      </ul>

      <h2 className="text-lg font-bold mt-4">4. Правовое основание обработки</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Обработка персональных данных осуществляется на основе следующих правовых оснований:
      </p>
      <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
        <li>Согласие Пользователя (настоящий документ)</li>
        <li>Договор-оферта, заключаемый при регистрации</li>
        <li>Исполнение обязательств по договору (заказ, доставка, оплата)</li>
        <li>Соблюдение требований законодательства РФ (налоговый учёт, бухгалтерия)</li>
        <li>Защита законных интересов Оператора и Пользователей</li>
      </ul>

      <h2 className="text-lg font-bold mt-4">5. Сроки обработки и хранения</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4">Категория данных</th>
              <th className="py-2">Срок хранения</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr><td className="py-2 pr-4">Профиль пользователя</td><td className="py-2">До удаления аккаунта</td></tr>
            <tr><td className="py-2 pr-4">История заказов</td><td className="py-2">5 лет (налоговое законодательство)</td></tr>
            <tr><td className="py-2 pr-4">Платёжные данные</td><td className="py-2">Не хранятся (обрабатывает YooKassa)</td></tr>
            <tr><td className="py-2 pr-4">Фотографии работ</td><td className="py-2">До удаления кондитером или 3 года</td></tr>
            <tr><td className="py-2 pr-4">Чаты и сообщения</td><td className="py-2">1 год после последней активности</td></tr>
            <tr><td className="py-2 pr-4">Логи системы (IP, cookies)</td><td className="py-2">90 дней</td></tr>
            <tr><td className="py-2 pr-4">Документы (ИНН, ОГРН)</td><td className="py-2">До прекращения деятельности</td></tr>
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-bold mt-4">6. Передача данных третьим лицам</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-2">
        Оператор не передаёт персональные данные третьим лицам, за исключением:
      </p>
      <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
        <li><b>YooKassa</b> — обработка платежей (только сумма и назначение платежа)</li>
        <li><b>Курьерские службы</b> (СДЭК, Boxberry) — адрес доставки и телефон</li>
        <li><b>Кондитеры</b> — состав заказа, имя, телефон, адрес доставки</li>
        <li><b>ФНС РФ</b> — налоговая отчётность (НПД: 4%/6%) по требованию</li>
        <li><b>СФР</b> — страховые взносы (для ИП)</li>
        <li><b>Telegram</b> — уведомления (chat_id, имя, телефон)</li>
        <li><b>Уполномоченные органы</b> — по официальному запросу в рамках закона</li>
      </ul>

      <h2 className="text-lg font-bold mt-4">7. Меры безопасности</h2>
      <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
        <li>Шифрование паролей (bcrypt с salt)</li>
        <li>JWT-токены для авторизации (HS256)</li>
        <li>HTTPS/TLS для всех соединений</li>
        <li>Эскроу-холдирование средств (24-72 часа)</li>
        <li>Ограничение доступа по ролям (RBAC)</li>
        <li>Аудит действий администраторов (ActionLog)</li>
        <li>Резервное копирование БД</li>
        <li>DDoS-защита через Caddy reverse proxy</li>
      </ul>

      <h2 className="text-lg font-bold mt-4">8. Права Пользователя</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-2">
        В соответствии со ст. 15-17 Закона о персональных данных, Пользователь имеет право:
      </p>
      <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
        <li><Eye className="h-3 w-3 inline mr-1" /> Запросить доступ к своим данным</li>
        <li><Download className="h-3 w-3 inline mr-1" /> Получить копию своих данных (экспорт)</li>
        <li><User className="h-3 w-3 inline mr-1" /> Требовать уточнения (исправления) данных</li>
        <li><Lock className="h-3 w-3 inline mr-1" /> Ограничить обработку</li>
        <li><Trash2 className="h-3 w-3 inline mr-1" /> Требовать удаления данных («право на забвение»)</li>
        <li><AlertCircle className="h-3 w-3 inline mr-1" /> Отозвать настоящее согласие в любой момент</li>
        <li><Mail className="h-3 w-3 inline mr-1" /> Обжаловать действия Оператора в Роскомнадзор</li>
      </ul>
      <p className="text-sm text-muted-foreground leading-relaxed mt-2">
        Для реализации этих прав напишите на <b>privacy@conditera.ru</b> или через форму обратной связи в личном кабинете.
        Ответ предоставляется в течение 30 дней.
      </p>

      <h2 className="text-lg font-bold mt-4">9. Cookies и аналитика</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Платформа использует cookies для авторизации, сохранения корзины, предпочтений (тёмная тема, город)
        и аналитики посещаемости. Подробности — в <a href="#" className="text-primary underline">Политике cookies</a>.
      </p>

      <h2 className="text-lg font-bold mt-4">10. Отзыв согласия</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Пользователь может отозвать настоящее согласие в любой момент, направив соответствующее уведомление
        на адрес <b>privacy@conditera.ru</b> или через настройки в личном кабинете.
        Отзыв согласия влечёт удаление аккаунта и всех связанных данных в течение 30 дней,
        за исключением данных, которые Оператор обязан хранить по закону (налоговые документы — 5 лет).
      </p>

      <h2 className="text-lg font-bold mt-4">11. Контактные данные Оператора</h2>
      <div className="bg-muted/40 rounded-lg p-4 text-sm space-y-1">
        <div><b>Оператор:</b> ООО «Уездный кондитер»</div>
        <div><b>ИНН:</b> 7701234567</div>
        <div><b>ОГРН:</b> 1234567890123</div>
        <div><b>Адрес:</b> 101000, г. Москва, ул. Сладкая, д. 1</div>
        <div><b>Email:</b> privacy@conditera.ru</div>
        <div><b>Телефон:</b> 8 800 555-35-35</div>
      </div>
    </>
  );
}

// ===== СОДЕРЖИМОЕ: ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ =====
function PrivacyContent() {
  return (
    <>
      <h2 className="text-lg font-bold">1. Общие положения</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Настоящая Политика конфиденциальности определяет порядок обработки и защиты персональных данных
        пользователей платформы «Уездный кондитер» в соответствии с ФЗ-152 «О персональных данных».
      </p>
      <h2 className="text-lg font-bold mt-4">2. Сбор персональных данных</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Мы собираем только те данные, которые вы предоставляете добровольно при регистрации, оформлении заказов
        и использовании платформы: имя, email, телефон, город, фотография, реквизиты (для юрлиц).
      </p>
      <h2 className="text-lg font-bold mt-4">3. Использование данных</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Данные используются для предоставления услуг (заказ тортов, доставка, оплата), коммуникации,
        обеспечения безопасности и соблюдения налогового законодательства.
      </p>
      <h2 className="text-lg font-bold mt-4">4. Защита данных</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Мы применяем шифрование паролей (bcrypt), JWT-авторизацию, HTTPS/TLS, ролевой доступ (RBAC),
        аудит действий и регулярное резервное копирование. Платёжные данные не хранятся — их обрабатывает YooKassa.
      </p>
      <h2 className="text-lg font-bold mt-4">5. Передача третьим лицам</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Данные передаются только третьим лицам, необходимым для исполнения заказа (кондитеру, курьеру, платёжному шлюзу),
        и только в объёме, необходимом для оказания услуги.
      </p>
      <h2 className="text-lg font-bold mt-4">6. Права пользователя</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Вы вправе запросить доступ, исправление, удаление своих данных и отзыв согласия.
        Для этого напишите на privacy@conditera.ru.
      </p>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <h2 className="text-lg font-bold">1. Предмет соглашения</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Настоящее Пользовательское соглашение регулирует отношения между пользователем и платформой «Уездный кондитер»
        по использованию сервиса заказа кондитерских изделий.
      </p>
      <h2 className="text-lg font-bold mt-4">2. Регистрация</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Регистрация осуществляется добровольно. Пользователь обязуется предоставлять достоверную информацию.
        Один email — один аккаунт.
      </p>
      <h2 className="text-lg font-bold mt-4">3. Заказы и оплата</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Заказ оформляется через корзину. Оплата производится через YooKassa. Средства холдируются на эскроу-счёте
        24 часа после получения заказа. Возврат — в течение 12 часов при отмене.
      </p>
      <h2 className="text-lg font-bold mt-4">4. Права и обязанности</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Платформа обязуется обеспечить функционирование сервиса, безопасность платежей и поддержку.
        Пользователь обязуется соблюдать правила платформы и не размещать недостоверную информацию.
      </p>
    </>
  );
}

function OfferContent() {
  return (
    <>
      <h2 className="text-lg font-bold">1. Предмет оферты</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        ООО «Уездный кондитер» предлагает любому лицу (Пользователю) воспользоваться услугами платформы
        на условиях настоящего Договора-оферты. Акцепт оферты — регистрация на платформе.
      </p>
      <h2 className="text-lg font-bold mt-4">2. Услуги платформы</h2>
      <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
        <li>Каталог кондитерских изделий от частных кондитеров</li>
        <li>Конструктор тортов с расчётом стоимости</li>
        <li>Оформление заказа с эскроу-оплатой</li>
        <li>Доставка курьером или самовывоз</li>
        <li>Чат между покупателем и кондитером</li>
        <li>Отзывы и рейтинги</li>
        <li>Площадки для праздников и дополнительные услуги</li>
      </ul>
      <h2 className="text-lg font-bold mt-4">3. Комиссия платформы</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Платформа удерживает комиссию с каждой транзакции: START — 15%, PROFI — 10%, PREMIUM — 5%.
        Комиссия YooKassa — 2.5% (карта) или 1.5% (СБП).
      </p>
    </>
  );
}

function CookiesContent() {
  return (
    <>
      <h2 className="text-lg font-bold">1. Что такое cookies</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Cookies — небольшие текстовые файлы, которые сохраняются в вашем браузере для улучшения работы сайта.
      </p>
      <h2 className="text-lg font-bold mt-4">2. Какие cookies мы используем</h2>
      <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
        <li><b>Авторизация</b> — JWT-токен для входа</li>
        <li><b>Корзина</b> — товары в корзине</li>
        <li><b>Предпочтения</b> — тёмная тема, выбранный город</li>
        <li><b>Аналитика</b> — посещаемость, поведение</li>
      </ul>
      <h2 className="text-lg font-bold mt-4">3. Управление cookies</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Вы можете отключить cookies в настройках браузера, но это может повлиять на работу платформы.
      </p>
    </>
  );
}
