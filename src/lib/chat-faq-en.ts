/**
 * English version of FAQ-бот for international customers.
 *
 * Same topics as in chat-faq.ts but with English keywords/answers.
 * Matcher detects language by Cyrillic/Latin ratio and picks the right set.
 *
 * Future: add more languages (es, de, fr, zh) — same structure.
 */

export interface FaqTopicEn {
  id: string;
  keywords: string[];
  answer: string;
  quickReplies?: { label: string; action: string; payload?: any }[];
}

export const FAQ_TOPICS_EN: FaqTopicEn[] = [
  {
    id: "delivery_time",
    keywords: ["when", "delivery", "deliver", "ship", "shipping", "arrive", "how long"],
    answer:
      "📅 Delivery times depend on order readiness:\n" +
      "  • Moscow — same day or next day after readiness\n" +
      "  • Russia — 2-7 days via CDEK/Boxberry\n" +
      "  • Self-pickup — immediately after readiness\n\n" +
      "You'll see exact time in chat when confectioner hands order to courier.",
    quickReplies: [
      { label: "Track order", action: "faq:track_order" },
      { label: "Self-pickup", action: "faq:self_pickup" },
    ],
  },
  {
    id: "payment",
    keywords: ["pay", "payment", "card", "sbp", "cash", "installment", "how to pay"],
    answer:
      "💳 Payment methods:\n" +
      "  • Bank card (Visa, Mastercard, MIR) — via YooKassa\n" +
      "  • SBP — QR code payment\n" +
      "  • Cash on delivery (not all confectioners)\n" +
      "  • Installment: Split, Tinkoff, Sber, Alfa, VTB\n" +
      "  • Gift certificate\n\n" +
      "🔒 All online payments are 3-D Secure protected.",
    quickReplies: [
      { label: "What is escrow?", action: "faq:escrow" },
      { label: "Installment", action: "faq:installment" },
    ],
  },
  {
    id: "escrow",
    keywords: ["escrow", "safe", "secure", "guarantee", "protection"],
    answer:
      "🛡️ Escrow is an intermediate account where your money stays for 24 hours after delivery.\n\n" +
      "How it works:\n" +
      "  1. You pay → money goes to escrow\n" +
      "  2. You receive and check the order\n" +
      "  3. If all good → after 24h money goes to confectioner\n" +
      "  4. If problem → open dispute, money stays in escrow until resolved",
    quickReplies: [
      { label: "Open dispute", action: "dispute:open" },
      { label: "Refund timeline", action: "faq:refund" },
    ],
  },
  {
    id: "modify_order",
    keywords: ["change", "modify", "edit", "update", "alter", "different filling"],
    answer:
      "✏️ You can modify order only before confectioner starts cooking (CONFIRMED status).\n\n" +
      "What you can change:\n" +
      "  • Filling, coating, decor\n" +
      "  • Inscription on cake\n" +
      "  • Delivery date (by agreement)\n\n" +
      "What you cannot:\n" +
      "  • Weight (need new order)\n" +
      "  • Product itself (need to cancel and reorder)\n\n" +
      "Message your confectioner directly in this chat.",
    quickReplies: [
      { label: "Message confectioner", action: "human:confectioner" },
      { label: "Cancel order", action: "order:cancel" },
    ],
  },
  {
    id: "cancel_order",
    keywords: ["cancel", "refund", "stop", "don't need"],
    answer:
      "❌ Cancellation depends on status:\n\n" +
      "  • PENDING / CONFIRMED — full refund\n" +
      "  • IN_PROGRESS — only with deduction for expenses\n" +
      "  • READY / DELIVERING — cannot cancel (already cooked)\n" +
      "  • After delivery — open dispute within 24h\n\n" +
      "Refund: 3 business days to the same card used for payment.",
    quickReplies: [
      { label: "Cancel order", action: "order:cancel" },
      { label: "Contact support", action: "human:operator" },
    ],
  },
  {
    id: "bonuses",
    keywords: ["bonus", "points", "loyalty", "cashback", "level", "discount"],
    answer:
      "🎁 Loyalty program:\n\n" +
      "  • 1 point per 100₽ spent\n" +
      "  • 1 point = 1₽ on next order\n\n" +
      "Levels:\n" +
      "  🥉 Bronze — from 0₽, ×1 multiplier\n" +
      "  🥈 Silver — from 5000₽, ×1.2, 3% discount\n" +
      "  🥇 Gold — from 15000₽, ×1.5, 5% discount\n" +
      "  💎 Platinum — from 50000₽, ×2, 10% discount\n\n" +
      "Points expire after 12 months of inactivity.",
    quickReplies: [
      { label: "My bonuses", action: "loyalty:my" },
      { label: "How to spend", action: "faq:spend_bonuses" },
    ],
  },
  {
    id: "allergens",
    keywords: ["allerg", "ingredient", "gluten", "lactose", "nut", "sugar free", "vegan", "pp"],
    answer:
      "🥗 Allergens and ingredients:\n\n" +
      "  • Full ingredient list on each product page\n" +
      "  • Possible allergens: gluten, milk, eggs, nuts, soy\n" +
      "  • Diet options: sugar-free (stevia/erythritol)\n" +
      "  • Vegan cakes — on plant milk\n" +
      "  • Gluten-free — almond/rice flour\n\n" +
      "If you have severe allergy — mention it in order comments.",
    quickReplies: [
      { label: "Diet catalog", action: "catalog:pp" },
      { label: "Gluten-free", action: "catalog:gluten_free" },
    ],
  },
  {
    id: "custom_cake",
    keywords: ["custom", "individual", "builder", "build cake", "unique", "personalized"],
    answer:
      "🎂 Cake Builder — build your custom cake:\n\n" +
      "  • Choose shape, size, filling, coating, decor\n" +
      "  • Inscription on cake\n" +
      "  • System matches confectioners who can fulfill\n" +
      "  • Request discount from multiple confectioners\n\n" +
      "Open Cake Builder on home page.",
    quickReplies: [
      { label: "Open builder", action: "cake_builder:open" },
    ],
  },
  {
    id: "corporate",
    keywords: ["corporate", "b2b", "invoice", "office", "employees", "business"],
    answer:
      "🏢 Corporate orders:\n\n" +
      "  • Volume orders from 10kg or 50+ portions\n" +
      "  • Invoice payment with/without VAT\n" +
      "  • Contract and closing documents\n" +
      "  • 5-15% discount depending on volume\n" +
      "  • Regular deliveries (weekly/monthly)\n\n" +
      "Go to 'Corporate Events' section and submit a request.",
    quickReplies: [
      { label: "Corporate request", action: "corporate:request" },
      { label: "Contact support", action: "human:operator" },
    ],
  },
  {
    id: "complaint",
    keywords: ["complaint", "bad", "taste", "spoiled", "broken", "cracked", "wrong", "mistake"],
    answer:
      "😞 Sorry your order didn't meet expectations. Let's resolve this.\n\n" +
      "What to do:\n" +
      "  1. Take photos of the issue\n" +
      "  2. Open dispute within 24 hours of delivery\n" +
      "  3. Describe problem and attach photos\n" +
      "  4. Moderator reviews within 24h\n\n" +
      "Possible outcomes: refund, partial compensation, or replacement.",
    quickReplies: [
      { label: "Open dispute", action: "dispute:open" },
      { label: "Contact support", action: "human:operator" },
    ],
  },
];

export const DEFAULT_QUICK_REPLIES_EN = [
  { label: "How to order?", action: "faq:how_to_order" },
  { label: "Payment methods", action: "faq:payment" },
  { label: "Delivery times", action: "faq:delivery_time" },
  { label: "Loyalty program", action: "faq:bonuses" },
  { label: "Contact support", action: "human:operator" },
];

export const UNKNOWN_QUERY_MESSAGE_EN =
  "🤔 I'm not sure I understood the question. Could you rephrase, or pick a topic below:";

export const ESCALATION_MESSAGE_EN =
  "👩‍💼 I've forwarded your request to support. Average response time is 5-10 minutes during business hours (10:00-22:00 MSK). Outside hours — up to 12 hours.";

/**
 * Detect language by Cyrillic vs Latin characters.
 * Returns "ru" or "en".
 */
export function detectLanguage(text: string): "ru" | "en" {
  const cyrillic = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  return cyrillic > latin ? "ru" : "en";
}

/**
 * Get localized message + quick replies based on language.
 */
export function getLocalizedStrings(lang: "ru" | "en") {
  if (lang === "en") {
    return {
      unknown: UNKNOWN_QUERY_MESSAGE_EN,
      escalation: ESCALATION_MESSAGE_EN,
      defaultQuickReplies: DEFAULT_QUICK_REPLIES_EN,
    };
  }
  // Russian — импортируем лениво, чтобы не дублировать
  return {
    unknown: "🤔 Я не уверен, что правильно понял вопрос. Переформулируйте, пожалуйста, или выберите тему ниже:",
    escalation: "👩‍💼 Я передал ваш запрос оператору поддержки. Среднее время ответа — 5-10 минут в рабочее время (10:00-22:00 МСК).",
    defaultQuickReplies: [
      { label: "Как сделать заказ?", action: "faq:how_to_order" },
      { label: "Способы оплаты", action: "faq:payment" },
      { label: "Сроки доставки", action: "faq:delivery_time" },
      { label: "Программа лояльности", action: "faq:bonuses" },
      { label: "Соединить с оператором", action: "human:operator" },
    ],
  };
}
