# Conditera — матрица трассировки сценариев

**Версия:** 0.1  
**Статус:** TRACEABILITY BASELINE / DRAFT  
**Источник сценариев:** `02_SCENARIO_REGISTER.md` (реестр является источником канонических ID и названий).  
**Назначение:** связать каждый зарегистрированный сценарий с участниками, предметным контуром, детальной спецификацией и будущими проверками до физического проектирования БД.

## 1. Правила

1. Канонические ID и названия берутся только из реестра. Не создавать локальные копии сценариев с повторно используемыми ID.
2. Эта матрица — карта трассировки, а не утверждение, что API, таблица, событие или тест уже существуют.
3. На этапе моделирования в колонке «Предметный контур» указываются концептуальные границы. Физические таблицы/колонки/enum не утверждаются до инвентаризации PG15/PG18.
4. Наличие детального документа не означает APPROVED или ACCEPTED.
5. Для каждого P0 сценария до приёмки должны быть описаны: права/tenant boundary, основной и негативный поток, состояния и переходы, атомарность/идемпотентность, события, доказательства, аудит, восстановление и тест.
6. Статус NOT MAPPED означает реальный пробел в модели, а не разрешение агенту додумать поведение.

## 2. Текущая трассировка

Всего строк сценариев, извлечённых из реестра: **130**. В реестре сохраняется приоритет P0/P1/P2. Все строки пока имеют статус `REGISTERED`; это не PASS и не признак готовности реализации.

| ID | Сценарий из реестра | Участники из реестра | Приоритет | Предметный контур | Детальная модель / источник |
|---|---|---|---|---|---|
| ID-001 | Регистрация покупателя, подтверждение контакта и восстановление доступа | Покупатель, Auth | P0 | Identity / onboarding / authority | 01_ACTORS_AND_INTERESTS.md |
| ID-002 | Регистрация кондитера как физлица/НПД/ИП/организации | Кондитер, платформа | P0 | Identity / onboarding / authority | 01_ACTORS_AND_INTERESTS.md |
| ID-003 | Проверка личности, статуса, реквизитов и полномочий представителя | Кондитер, верификатор | P0 | Identity / onboarding / authority | 01_ACTORS_AND_INTERESTS.md |
| ID-004 | Привязка фактической производственной площадки | Изготовитель, модератор | P0 | Identity / onboarding / authority | 01_ACTORS_AND_INTERESTS.md |
| ID-005 | Повторная проверка документов, истечение статуса, изменение реквизитов | Изготовитель, платформа | P0 | Identity / onboarding / authority | 01_ACTORS_AND_INTERESTS.md |
| ID-006 | Приглашение сотрудника, делегирование, ограничение и отзыв полномочий | Владелец организации, сотрудник | P0 | Identity / onboarding / authority | 01_ACTORS_AND_INTERESTS.md |
| ID-007 | Несколько организаций/площадок у одного пользователя | Пользователь, организации | P1 | Identity / onboarding / authority | 01_ACTORS_AND_INTERESTS.md |
| ID-008 | Мультиаккаунты, подмена личности и повторная регистрация после блокировки | Злоумышленник, антифрод | P0 | Identity / onboarding / authority | 01_ACTORS_AND_INTERESTS.md |
| ID-009 | Ложное портфолио, чужие фотографии, фиктивные документы и отзывы | Кандидат в кондитеры, модератор | P0 | Identity / onboarding / authority | 01_ACTORS_AND_INTERESTS.md |
| CAT-001 | Создание карточки товара, состава, аллергенов, цены и условий | Изготовитель | P0 | Catalog / discovery / promotion | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md |
| CAT-002 | Публикация, модерация, изменение и снятие товара | Изготовитель, модератор | P1 | Catalog / discovery / promotion | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md |
| CAT-003 | Поиск, фильтры, сравнение, рекомендации и избранное | Покупатель, AI | P1 | Catalog / discovery / promotion | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md |
| CAT-004 | Продвижение, реклама, платное размещение и атрибуция | Изготовитель, платформа | P1 | Catalog / discovery / promotion | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md |
| CAT-005 | Отзывы, рейтинг, жалобы и проверка достоверности | Покупатель, модератор | P1 | Catalog / discovery / promotion | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md |
| CAT-006 | Продавец/бренд не совпадает с фактическим изготовителем | Продавец, изготовитель | P0 | Catalog / discovery / promotion | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md |
| CAT-007 | Скрытый посредник, перепродажа и непрозрачная наценка | Покупатель, продавец, изготовитель | P0 | Catalog / discovery / promotion | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md |
| CAT-008 | Копирование карточек, контента и портфолио конкурента | Участники, модератор | P1 | Catalog / discovery / promotion | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md |
| ORD-001 | Корзина и оформление стандартного заказа | Покупатель | P0 | Order / design / approval | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md; 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| ORD-002 | Индивидуальный заказ с текстовым описанием и фото-пожеланиями | Покупатель, кондитер | P0 | Order / design / approval | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md; 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| ORD-003 | Создание макета Cake Studio и прикрепление к заказу/позиции | Покупатель, кондитер | P0 | Order / design / approval | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md; 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| ORD-004 | Добавление до пяти элементов декора на макет и фиксация согласованных параметров | Покупатель, кондитер | P0 | Order / design / approval | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md; 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| ORD-005 | Версионирование макета, комментарии и повторное согласование | Покупатель, кондитер | P0 | Order / design / approval | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md; 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| ORD-006 | Расчёт цены, себестоимости, допработ, доставки и комиссии | Кондитер, платформа | P0 | Order / design / approval | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md; 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| ORD-007 | Изменение состава, цены, срока или адреса после подтверждения | Покупатель, кондитер | P0 | Order / design / approval | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md; 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| ORD-008 | Отказ, отмена, истечение срока предложения и неответ участника | Покупатель, кондитер | P0 | Order / design / approval | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md; 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| ORD-009 | Заказ нескольких изделий у одного/разных изготовителей | Покупатель, изготовители | P1 | Order / design / approval | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md; 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| ORD-010 | Фиктивный заказ, искусственное дробление и занижение суммы | Злоумышленник, антифрод | P0 | Order / design / approval | 04_PRODUCT_PORTFOLIO_CAKE_STUDIO_AND_VERTICAL_PRODUCTS.md; 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| COM-001 | Чат покупателя и кондитера, привязанный к заказу/позиции | Покупатель, кондитер | P0 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| COM-002 | Чат поддержки, эскалация и передача истории | Покупатель, поддержка | P0 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| COM-003 | AI-помощник покупателя: подбор, уточнение пожеланий и сбор спецификации | Покупатель, AI | P1 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| COM-004 | AI-помощник кондитера: рецептуры, калькуляция, производство и закупки | Кондитер, AI | P1 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| COM-005 | AI-помощник поддержки/администратора с ограниченными инструментами | Сотрудник, AI | P1 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| COM-006 | Вложения, фото, документы, доступ, срок хранения и удаление | Все роли | P0 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| COM-007 | Извлечение фактов из диалога в структурированный контекст заказа | AI, участники | P1 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| COM-008 | Кандидат в RAG, проверка, утверждение, индексация и отзыв знания | Эксперт, AI | P1 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| COM-009 | Изоляция RAG по пользователю/организации и предотвращение утечки | Все роли | P0 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| COM-010 | Prompt injection через сообщение, вложение, ссылку или найденный документ | Злоумышленник, AI | P0 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| COM-011 | AI предлагает действие, требующее подтверждения человека | AI, уполномоченный участник | P0 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| COM-012 | Удаление/исправление источника, переиндексация и удаление embeddings | Владелец данных, платформа | P1 | Communication / AI / RAG | 05_COMMUNICATIONS_AI_AND_RAG.md |
| PRD-001 | Принятие заказа в производство и назначение фактического исполнителя | Кондитер, сотрудник | P0 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-002 | Производственное задание и спецификация из утверждённого макета | Кондитер | P0 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-003 | Рецептура, версия, нормы расхода, выход и себестоимость | Кондитер | P0 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-004 | Резервирование, списание, замена и возврат сырья | Кондитер, склад | P0 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-005 | Партии ингредиентов, сроки годности, поставщик и прослеживаемость | Кондитер, поставщик | P0 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-006 | Учет декора как каталожной позиции и расходуемого материала | Кондитер | P1 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-007 | Контроль этапов, отклонений, брака и переделки | Кондитер | P0 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-008 | Фотофиксация промежуточных этапов и готового изделия | Кондитер | P0 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-009 | Фото разреза, упаковки и комплектации | Кондитер | P1 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-010 | Сравнение фактического изделия с согласованным макетом | Кондитер, покупатель | P1 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-011 | Производство фактически сторонней площадкой/неизвестным подрядчиком | Изготовитель, антифрод | P0 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-012 | Подмена ингредиентов, партии, веса, состава или готового изделия | Злоумышленник, контроль качества | P0 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| PRD-013 | Несанкционированное списание, фиктивный расход и манипуляция остатками | Сотрудник, антифрод | P0 | Manufacturing / inventory / quality / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| REG-001 | Классификация изделия и определение применимости обязательной маркировки | Изготовитель, комплаенс | P0 | Compliance / traceability | 00_TARGET_OPERATING_MODEL.md (regulatory requirements; legal review pending) |
| REG-002 | Регистрация участника и получение необходимых идентификаторов | Изготовитель, оператор маркировки | P0 | Compliance / traceability | 00_TARGET_OPERATING_MODEL.md (regulatory requirements; legal review pending) |
| REG-003 | Получение, нанесение и проверка кода маркировки, когда требуется | Изготовитель | P0 | Compliance / traceability | 00_TARGET_OPERATING_MODEL.md (regulatory requirements; legal review pending) |
| REG-004 | Ввод в оборот и передача сведений, когда требуется | Изготовитель/продавец | P0 | Compliance / traceability | 00_TARGET_OPERATING_MODEL.md (regulatory requirements; legal review pending) |
| REG-005 | Приёмка, передача, вывод из оборота и возврат, когда применимо | Продавец, покупатель, система | P0 | Compliance / traceability | 00_TARGET_OPERATING_MODEL.md (regulatory requirements; legal review pending) |
| REG-006 | Контрактное производство: распределение обязанностей по маркировке | Заказчик производства, изготовитель | P0 | Compliance / traceability | 00_TARGET_OPERATING_MODEL.md (regulatory requirements; legal review pending) |
| REG-007 | Ошибка внешней системы, неподтверждённый статус, повтор обмена | Интеграция, участник | P0 | Compliance / traceability | 00_TARGET_OPERATING_MODEL.md (regulatory requirements; legal review pending) |
| REG-008 | Состав, аллергены, сроки, документы качества и обязательная информация | Изготовитель, покупатель | P0 | Compliance / traceability | 00_TARGET_OPERATING_MODEL.md (regulatory requirements; legal review pending) |
| REG-009 | Кассовый чек, корректировка, возврат и фискальные документы | Продавец, ОФД/ККТ | P0 | Compliance / traceability | 00_TARGET_OPERATING_MODEL.md (regulatory requirements; legal review pending) |
| REG-010 | Налоговый статус, документы и изменение режима участника | Изготовитель, платформа | P0 | Compliance / traceability | 00_TARGET_OPERATING_MODEL.md (regulatory requirements; legal review pending) |
| DLV-001 | Готовность, упаковка и фотофиксация перед передачей | Кондитер | P0 | Handoff / delivery / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| DLV-002 | Назначение, проверка и принятие курьером | Курьер, платформа | P0 | Handoff / delivery / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| DLV-003 | Передача курьеру с фиксацией времени, состава и доказательств | Кондитер, курьер | P0 | Handoff / delivery / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| DLV-004 | Маршрут, изменение адреса, задержка и отказ курьера | Курьер, покупатель | P1 | Handoff / delivery / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| DLV-005 | Подтверждение получения покупателем | Покупатель, курьер | P0 | Handoff / delivery / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| DLV-006 | Отсутствие покупателя, отказ принять и повторная доставка | Покупатель, курьер | P0 | Handoff / delivery / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| DLV-007 | Подмена, повреждение, вскрытие и фиктивное подтверждение доставки | Курьер, покупатель, антифрод | P0 | Handoff / delivery / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| DLV-008 | Сговор курьера и участника, поддельное фото/геоподтверждение | Антифрод | P0 | Handoff / delivery / evidence | 06_PRODUCTION_QUALITY_AND_ORDER_EVIDENCE.md |
| FIN-001 | Оплата, подтверждение провайдером и идемпотентная обработка webhook | Покупатель, провайдер | P0 | Payments / ledger / settlement | 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| FIN-002 | Комиссия платформы и распределение суммы между участниками | Платформа, продавец | P0 | Payments / ledger / settlement | 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| FIN-003 | Удержание/escrow и условия освобождения средств | Платформа, продавец, покупатель | P0 | Payments / ledger / settlement | 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| FIN-004 | Частичная/полная отмена и возврат | Покупатель, продавец | P0 | Payments / ledger / settlement | 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| FIN-005 | Выплата, изменение реквизитов и подтверждение получателя | Продавец, финансы | P0 | Payments / ledger / settlement | 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| FIN-006 | Сверка платежей, чеков, возвратов, комиссий и банковских поступлений | Финансы | P0 | Payments / ledger / settlement | 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| FIN-007 | Chargeback, спор с банком и доказательная база | Покупатель, платформа | P0 | Payments / ledger / settlement | 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| FIN-008 | Фиктивная оплата, повторный webhook и подмена суммы | Злоумышленник, антифрод | P0 | Payments / ledger / settlement | 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| FIN-009 | Скрытая наценка посредника и несоответствие получателя/изготовителя | Посредник, изготовитель | P0 | Payments / ledger / settlement | 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| FIN-010 | Увод повторных заказов за пределы платформы | Покупатель, продавец | P1 | Payments / ledger / settlement | 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| FIN-011 | Экономика заказа, CAC, LTV, contribution margin и когортный анализ | Руководство | P1 | Payments / ledger / settlement | 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| SUP-001 | Обращение, назначение, SLA, переписка и вложения | Покупатель, поддержка | P0 | Support / disputes / refunds | 05_COMMUNICATIONS_AI_AND_RAG.md; 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| SUP-002 | Претензия к качеству/составу/комплектации | Покупатель, изготовитель | P0 | Support / disputes / refunds | 05_COMMUNICATIONS_AI_AND_RAG.md; 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| SUP-003 | Спор по макету, согласованию и фактическому изделию | Покупатель, кондитер | P0 | Support / disputes / refunds | 05_COMMUNICATIONS_AI_AND_RAG.md; 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| SUP-004 | Спор по доставке и фото-доказательствам | Покупатель, курьер | P0 | Support / disputes / refunds | 05_COMMUNICATIONS_AI_AND_RAG.md; 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| SUP-005 | Возврат, компенсация, частичное возмещение и удержание | Поддержка, финансы | P0 | Support / disputes / refunds | 05_COMMUNICATIONS_AI_AND_RAG.md; 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| SUP-006 | Ложная претензия, повторные злоупотребления и сговор | Антифрод | P0 | Support / disputes / refunds | 05_COMMUNICATIONS_AI_AND_RAG.md; 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| SUP-007 | Апелляция на блокировку/верификацию/антифрод-решение | Участник, независимый проверяющий | P0 | Support / disputes / refunds | 05_COMMUNICATIONS_AI_AND_RAG.md; 07_FINANCIAL_LIFECYCLE_AND_RECONCILIATION.md |
| FRD-001 | Выявление мнимого кондитера и отсутствующего производства | Антифрод, модератор | P0 | Trust / fraud / appeals | 01_ACTORS_AND_INTERESTS.md; 03_MANUFACTURER_ONBOARDING_AND_ANTI_FRAUD.md |
| FRD-002 | Выявление сетки связанных аккаунтов/фиктивных отзывов | Антифрод | P0 | Trust / fraud / appeals | 01_ACTORS_AND_INTERESTS.md; manufacturer onboarding model (file path must be verified) |
| FRD-003 | Проверка совпадений личности, реквизитов, устройств и площадок в рамках закона | Антифрод | P0 | Trust / fraud / appeals | 01_ACTORS_AND_INTERESTS.md; manufacturer onboarding model (file path must be verified) |
| FRD-004 | Выявление нераскрытого субподряда и подмены изготовителя | Антифрод, комплаенс | P0 | Trust / fraud / appeals | 01_ACTORS_AND_INTERESTS.md; manufacturer onboarding model (file path must be verified) |
| FRD-005 | Выявление фиктивных заказов, платежей, доставок и возвратов | Антифрод | P0 | Trust / fraud / appeals | 01_ACTORS_AND_INTERESTS.md; manufacturer onboarding model (file path must be verified) |
| FRD-006 | Выявление сговора покупатель-продавец-курьер-сотрудник | Антифрод | P0 | Trust / fraud / appeals | 01_ACTORS_AND_INTERESTS.md; manufacturer onboarding model (file path must be verified) |
| FRD-007 | Выявление обхода комиссии и перевода клиентов во внешние каналы | Антифрод, аналитика | P1 | Trust / fraud / appeals | 01_ACTORS_AND_INTERESTS.md; manufacturer onboarding model (file path must be verified) |
| FRD-008 | Выявление посреднических цепочек и потери маржи | Аналитика, финансы | P0 | Trust / fraud / appeals | 01_ACTORS_AND_INTERESTS.md; manufacturer onboarding model (file path must be verified) |
| FRD-009 | Риск-скоринг, ручная проверка, санкции и апелляция | Антифрод, модератор | P0 | Trust / fraud / appeals | 01_ACTORS_AND_INTERESTS.md; manufacturer onboarding model (file path must be verified) |
| FRD-010 | Внутреннее мошенничество и злоупотребление привилегиями | Безопасность, аудит | P0 | Trust / fraud / appeals | 01_ACTORS_AND_INTERESTS.md; manufacturer onboarding model (file path must be verified) |
| ADM-001 | Управление пользователями, ролями, организациями и допусками | Администратор | P0 | Admin / CMS / reporting / governance | 00_TARGET_OPERATING_MODEL.md |
| ADM-002 | Модерация товаров, документов, отзывов и контента | Модератор | P1 | Admin / CMS / reporting / governance | 00_TARGET_OPERATING_MODEL.md |
| ADM-003 | CMS, дизайн, главная, публикации и медиатека | Администратор | P1 | Admin / CMS / reporting / governance | 00_TARGET_OPERATING_MODEL.md |
| ADM-004 | Управление тарифами, комиссиями, бонусами и правилами | Администратор, финансы | P0 | Admin / CMS / reporting / governance | 00_TARGET_OPERATING_MODEL.md |
| ADM-005 | Управление антифрод-правилами и расследованиями | Антифрод, администратор | P0 | Admin / CMS / reporting / governance | 00_TARGET_OPERATING_MODEL.md |
| ADM-006 | Отчётность по заказам, деньгам, марже, качеству и рискам | Руководство | P0 | Admin / CMS / reporting / governance | 00_TARGET_OPERATING_MODEL.md |
| ADM-007 | Аудит действий сотрудников и экстренный привилегированный доступ | Безопасность | P0 | Admin / CMS / reporting / governance | 00_TARGET_OPERATING_MODEL.md |
| ADM-008 | Инцидент, утечка, восстановление, уведомление и постмортем | Безопасность, администрация | P0 | Admin / CMS / reporting / governance | 00_TARGET_OPERATING_MODEL.md |
| NFR-001 | RLS/IDOR: запрет чтения и изменения чужих заказов/файлов/чатов | Все роли | P0 | Security / resilience / integrations | 00_TARGET_OPERATING_MODEL.md; 05_COMMUNICATIONS_AI_AND_RAG.md |
| NFR-002 | CSRF, XSS, SSRF, rate limit, session hijack и повтор запроса | Злоумышленник, платформа | P0 | Security / resilience / integrations | 00_TARGET_OPERATING_MODEL.md; 05_COMMUNICATIONS_AI_AND_RAG.md |
| NFR-003 | Конкурентное изменение заказа, резерва, выплаты или макета | Несколько участников | P0 | Security / resilience / integrations | 00_TARGET_OPERATING_MODEL.md; 05_COMMUNICATIONS_AI_AND_RAG.md |
| NFR-004 | Частичный отказ между Storage и PostgreSQL | Платформа | P0 | Security / resilience / integrations | 00_TARGET_OPERATING_MODEL.md; 05_COMMUNICATIONS_AI_AND_RAG.md |
| NFR-005 | Недоступность PG, Storage, чата, AI, n8n или внешнего API | Платформа | P0 | Security / resilience / integrations | 00_TARGET_OPERATING_MODEL.md; 05_COMMUNICATIONS_AI_AND_RAG.md |
| NFR-006 | Очереди, повторная доставка событий, dead-letter и сверка | Платформа | P0 | Security / resilience / integrations | 00_TARGET_OPERATING_MODEL.md; 05_COMMUNICATIONS_AI_AND_RAG.md |
| NFR-007 | Резервная копия, восстановление, миграция и rollback | Операторы | P0 | Security / resilience / integrations | 00_TARGET_OPERATING_MODEL.md; 05_COMMUNICATIONS_AI_AND_RAG.md |
| NFR-008 | Изоляция tenant/org и предотвращение межорганизационной утечки | Все роли | P0 | Security / resilience / integrations | 00_TARGET_OPERATING_MODEL.md; 05_COMMUNICATIONS_AI_AND_RAG.md |
| NFR-009 | Удаление/экспорт персональных данных и сроки хранения доказательств | Пользователь, платформа | P0 | Security / resilience / integrations | 00_TARGET_OPERATING_MODEL.md; 05_COMMUNICATIONS_AI_AND_RAG.md |
| NFR-010 | Логи, метрики, трассировка и расследование инцидента | Операторы | P0 | Security / resilience / integrations | 00_TARGET_OPERATING_MODEL.md; 05_COMMUNICATIONS_AI_AND_RAG.md |
| ONS-001 | Кондитер включает режим «Кондитер на выезде» и указывает типы услуг | Кондитер | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-002 | Исполнитель задаёт зону выезда, радиус, исключения и стоимость логистики | Кондитер | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-003 | Исполнитель задаёт календарь, слоты, минимальный срок бронирования и capacity | Кондитер | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-004 | Заказчик ищет выездного кондитера по локации, дате, услуге и требованиям | Заказчик | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-005 | Стороны согласуют, что предоставляет исполнитель, а что — заказчик | Заказчик, кондитер | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-006 | Проверка готовности площадки, оборудования, доступа и условий безопасности | Заказчик, кондитер | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-007 | Выезд, прибытие, начало и завершение работ подтверждаются событиями | Кондитер, заказчик | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-008 | Дополнительные работы/изменение объёма на месте требуют новой сметы и согласия | Заказчик, кондитер | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-009 | Отмена до выезда, после выезда, неявка и неподготовленная площадка | Заказчик, кондитер | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-010 | Частичная приёмка, претензия и расчёт фактически выполненной части | Заказчик, кондитер, поддержка | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-011 | Разграничение финального декорирования, обслуживания мероприятия и производства на площадке | Платформа, комплаенс | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-012 | Сбор геолокации/маршрута только в необходимом объёме и в допустимый момент | Исполнитель, платформа | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-013 | Подмена исполнителя, фиктивное прибытие, часы, расходы или акт приёмки | Антифрод | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |
| ONS-014 | Комиссия/сервисный сбор/подписка с выездной услуги и корректное распределение денег | Финансы, платформа | P0 | B2B procurement / onsite service | 08_B2B_LOCAL_REQUESTS_AND_ONSITE_CONFECTIONER.md |

## 3. Обязательные поля следующего уровня

Для каждой строки матрица должна быть дополнена после детализации, без выдумывания физической схемы:

- **Полномочия:** субъект, организация/tenant, ресурс, действие, делегирование, отзыв.
- **Доменный объект:** концептуальная сущность, идентификатор, владелец, связи и источник истины.
- **Состояния:** допустимые переходы, терминальные состояния, отмена и повтор.
- **Команды/API:** инициирующее действие, серверная проверка, транзакционная граница.
- **События:** имя/версия события, producer, consumers, idempotency key, retry/DLQ.
- **Файлы:** тип, приватность, bucket-класс, метаданные, retention, signed URL и восстановление.
- **Финансы:** сумма, валюта, база комиссии, ledger entries, refund/chargeback/payout/reconciliation.
- **Коммуникации/AI:** контекст, участники, источники, согласия/основания, approval и аудит.
- **Антифрод/комплаенс:** риск, доказательства, ручная проверка, апелляция, применимость нормы.
- **Тесты:** happy path, отказ, права, конкуренция, повтор, частичный сбой, восстановление и критерии PASS.
- **Фактическая реализация:** файл/маршрут/таблица/политика/worker, commit, результат проверки.
- **Статус:** DRAFT / MODELED / REVIEW_REQUIRED / APPROVED / MAPPED_TO_DATA / MAPPED_TO_IMPLEMENTATION / TEST_DESIGNED / ACCEPTED.

## 4. Контроль полноты и обнаруженные ограничения

- Реестр является стартовым перечнем и сам предупреждает, что не гарантирует полноту.
- Документ B2B/выездных услуг должен использовать канонические B2B-001–013 и ONS-001–014. Технические тесты получают отдельный префикс `TST-`; доменные пространства SEC-/FIN- не переиспользуются.
- Документ `03_MANUFACTURER_ONBOARDING_AND_ANTI_FRAUD.md` был отсутствующим в фактическом дереве ветки, несмотря на ссылку из главного документа. Он восстановлен отдельным коммитом; содержание теперь требует обычной предметной сверки с реестром и фактическими процессами.
- В реестре есть CAT-004 «реклама и платное размещение», но это не означает, что рекламная платформа входит в текущий релиз. Маркетинговое направление зарезервировано отдельно и исключено из текущей реализации.
- Сценарии маркировки, налогов и выездного производства требуют отдельной актуальной юридической проверки; архитектурная модель не является юридическим заключением.

## 5. Очередь заполнения матрицы

1. Проверить восстановленный документ допуска изготовителя и сопоставить ID сценариев с разделом 03.
2. Проверить детальные документы 04–08 на точные ссылки на канонические ID.
3. Развернуть матрицу до уровня состояний, полномочий, событий, концептуальных сущностей и тестов для всех P0.
4. Отдельно провести ту же детализацию P1/P2, не превращая гипотезы в MVP.
5. После фиксации требований выполнить read-only инвентаризацию реальных PG15/PG18, Storage, API, фоновых задач, webhooks и runtime-конфигурации.
6. Только после сопоставления реальности и модели проектировать целевую PG17.

## 6. Границы текущей работы

Не создаются миграции и физические таблицы. Не меняются данные/volumes/production. Не выполняется cutover, merge или deploy. Защищённые upload routes не изменяются. PR #47 и PR #48 остаются вне этой ветки работ.
