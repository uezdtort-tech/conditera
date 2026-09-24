"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CreditCard, Smartphone, Banknote, Wallet, Building2, Link as LinkIcon,
  Shield, ShieldCheck, AlertTriangle, Check, Info, FileText, Receipt,
  Calculator, Clock, Lock, Zap, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

export function ConfectionerPaymentTaxTab({
  confectionerId,
  legalStatus,
  taxMode,
}: {
  confectionerId: string;
  legalStatus: string;
  taxMode: string;
}) {
  const [settings, setSettings] = useState({
    // Платформа
    acceptCard: true,
    acceptSbp: true,
    acceptSplit: true,
    acceptInstallment: false,
    // Наличные
    acceptCash: true,
    // Независимые
    acceptDirectTransfer: false,
    directCardNumber: "",
    directBankTransfer: false,
    bankAccount: "",
    acceptCrypto: false,
    acceptExternalLink: false,
    externalPaymentUrl: "",
    // Эскроу
    useEscrow: true,
    escrowHoldHours: 24,
    // Налоги
    taxResponsibilityAccepted: false,
    npdReceiptRequired: true,
    npdReceiptReminder: true,
    kkmRequired: false,
    kkmModel: "",
    selfReportTaxes: true,
  });

  const [showTaxDisclaimer, setShowTaxDisclaimer] = useState(false);
  const [activeSection, setActiveSection] = useState<"platform" | "independent" | "escrow" | "tax">("platform");

  const handleSave = () => {
    if (!settings.taxResponsibilityAccepted) {
      toast.error("Необходимо принять налоговую ответственность");
      setActiveSection("tax");
      return;
    }
    toast.success("Настройки оплаты сохранены");
  };

  const handleAcceptTax = () => {
    setSettings({ ...settings, taxResponsibilityAccepted: true });
    setShowTaxDisclaimer(false);
    toast.success("Налоговая ответственность принята");
  };

  const isNPD = taxMode === "NPD" || legalStatus === "NPD";
  const isIP = legalStatus === "IP";
  const isOOO = legalStatus === "OOO";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          Оплата и налоговая ответственность
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Настройте способы оплаты и подтвердите осведомлённость о налоговых обязательствах
        </p>
      </div>

      {/* Секции */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {[
          { id: "platform", l: "Через платформу", icon: Shield, color: "text-emerald-500" },
          { id: "independent", l: "Независимые", icon: Wallet, color: "text-amber-500" },
          { id: "escrow", l: "Эскроу", icon: Lock, color: "text-blue-500" },
          { id: "tax", l: "Налоги", icon: Calculator, color: "text-rose-500" },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id as any)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center gap-1.5 whitespace-nowrap ${
              activeSection === s.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <s.icon className={`h-4 w-4 ${activeSection === s.id ? "text-primary" : s.color}`} />
            {s.l}
            {s.id === "tax" && !settings.taxResponsibilityAccepted && (
              <Badge className="bg-rose-500 text-white text-[10px] ml-1">!</Badge>
            )}
          </button>
        ))}
      </div>

      {/* ===== ЧЕРЕЗ ПЛАТФОРМУ ===== */}
      {activeSection === "platform" && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
            <h3 className="font-semibold">Оплата через платформу (рекомендуется)</h3>
            <Badge className="bg-emerald-500 text-white text-[10px]">Эскроу-защита</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Платёж проходит через YooKassa. Средства холдируются на эскроу-счёте 24 часа после получения заказа.
            Комиссия платформы автоматически вычитается. Налоги рассчитываются автоматически.
          </p>

          <div className="space-y-3">
            <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-accent/30 cursor-pointer">
              <input type="checkbox" checked={settings.acceptCard} onChange={(e) => setSettings({ ...settings, acceptCard: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-blue-500" />
                  <span className="font-medium text-sm">Банковская карта</span>
                  <Badge variant="outline" className="text-[10px]">2.5%</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Visa, Mastercard, МИР. Через YooKassa с эскроу-защитой.</p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-accent/30 cursor-pointer">
              <input type="checkbox" checked={settings.acceptSbp} onChange={(e) => setSettings({ ...settings, acceptSbp: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-purple-500" />
                  <span className="font-medium text-sm">СБП — Система быстрых платежей</span>
                  <Badge variant="outline" className="text-[10px]">1.5%</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Оплата по QR-коду. Самый низкий процент комиссии.</p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-accent/30 cursor-pointer">
              <input type="checkbox" checked={settings.acceptSplit} onChange={(e) => setSettings({ ...settings, acceptSplit: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-indigo-500" />
                  <span className="font-medium text-sm">Сплит (разделение платежа)</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Оплата частями между несколькими участниками.</p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-accent/30 cursor-pointer">
              <input type="checkbox" checked={settings.acceptInstallment} onChange={(e) => setSettings({ ...settings, acceptInstallment: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-rose-500" />
                  <span className="font-medium text-sm">Рассрочка</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">0% на 3 мес (Сплит), 4% на 6 мес (Тинькофф), 8% на 12 мес.</p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-accent/30 cursor-pointer">
              <input type="checkbox" checked={settings.acceptCash} onChange={(e) => setSettings({ ...settings, acceptCash: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-emerald-500" />
                  <span className="font-medium text-sm">Наличные при получении</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Оплата наличными курьеру или при самовывозе. Без комиссии платформы.</p>
              </div>
            </label>
          </div>
        </Card>
      )}

      {/* ===== НЕЗАВИСИМЫЕ ===== */}
      {activeSection === "independent" && (
        <div className="space-y-4">
          <Card className="p-4 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-300">Внимание! Независимые способы оплаты — вне эскроу</p>
                <p className="text-amber-700 dark:text-amber-400 mt-1">
                  При оплате вне платформы вы самостоятельно несёте ответственность за сделку.
                  Платформа не гарантирует возврат средств. Все налоговые обязательства — на вас.
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Wallet className="h-5 w-5 text-amber-500" />
              Независимые способы оплаты
            </h3>

            <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer">
              <input type="checkbox" checked={settings.acceptDirectTransfer} onChange={(e) => setSettings({ ...settings, acceptDirectTransfer: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
              <div className="flex-1">
                <div className="font-medium text-sm">Прямой перевод на карту</div>
                <p className="text-xs text-muted-foreground mt-0.5">Покупатель переводит деньги на вашу карту напрямую</p>
                {settings.acceptDirectTransfer && (
                  <Input
                    value={settings.directCardNumber}
                    onChange={(e) => setSettings({ ...settings, directCardNumber: e.target.value })}
                    placeholder="0000 0000 0000 0000 (будет маскирован)"
                    className="mt-2"
                  />
                )}
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer">
              <input type="checkbox" checked={settings.directBankTransfer} onChange={(e) => setSettings({ ...settings, directBankTransfer: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
              <div className="flex-1">
                <div className="font-medium text-sm">Банковский перевод (для юрлиц)</div>
                <p className="text-xs text-muted-foreground mt-0.5">Безналичный расчёт по счёту для ИП и ООО</p>
                {settings.directBankTransfer && (
                  <Textarea
                    value={settings.bankAccount}
                    onChange={(e) => setSettings({ ...settings, bankAccount: e.target.value })}
                    placeholder="ИНН, КПП, р/с, БИК, банк..."
                    rows={3}
                    className="mt-2 text-xs"
                  />
                )}
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer">
              <input type="checkbox" checked={settings.acceptCrypto} onChange={(e) => setSettings({ ...settings, acceptCrypto: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
              <div className="flex-1">
                <div className="font-medium text-sm">Криптовалюта (USDT)</div>
                <p className="text-xs text-muted-foreground mt-0.5">Оплата в USDT (TRC-20). Адрес запрашивается у покупателя.</p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer">
              <input type="checkbox" checked={settings.acceptExternalLink} onChange={(e) => setSettings({ ...settings, acceptExternalLink: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
              <div className="flex-1">
                <div className="font-medium text-sm">Внешняя ссылка на оплату</div>
                <p className="text-xs text-muted-foreground mt-0.5">Stripe, ЮMoney, Robokassa и другие</p>
                {settings.acceptExternalLink && (
                  <Input
                    value={settings.externalPaymentUrl}
                    onChange={(e) => setSettings({ ...settings, externalPaymentUrl: e.target.value })}
                    placeholder="https://pay.example.com/..."
                    className="mt-2"
                  />
                )}
              </div>
            </label>
          </Card>
        </div>
      )}

      {/* ===== ЭСКРОУ ===== */}
      {activeSection === "escrow" && (
        <Card className="p-5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Lock className="h-5 w-5 text-blue-500" />
            Эскроу-холдирование
          </h3>
          <p className="text-sm text-muted-foreground">
            Среды покупателя холдируются на счёте платформы. Вы получаете payout после подтверждения получения заказа.
          </p>

          <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer">
            <input type="checkbox" checked={settings.useEscrow} onChange={(e) => setSettings({ ...settings, useEscrow: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
            <div className="flex-1">
              <div className="font-medium text-sm">Использовать эскроу (рекомендуется)</div>
              <p className="text-xs text-muted-foreground mt-0.5">Повышает доверие покупателей. Защищает от необоснованных возвратов.</p>
            </div>
          </label>

          {settings.useEscrow && (
            <div>
              <Label>Время холдирования</Label>
              <select
                value={settings.escrowHoldHours}
                onChange={(e) => setSettings({ ...settings, escrowHoldHours: +e.target.value })}
                className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm mt-1"
              >
                <option value={24}>24 часа (стандарт)</option>
                <option value={48}>48 часов (премиум-заказы)</option>
                <option value={72}>72 часа (корпоративные заказы)</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                После получения заказа у покупателя есть это время на проверку. Если претензий нет — средства автоматически переводятся вам.
              </p>
            </div>
          )}

          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 text-sm">
            <div className="flex items-center gap-2 mb-1">
              <Info className="h-4 w-4 text-blue-500" />
              <span className="font-medium text-blue-700 dark:text-blue-300">Как работает эскроу</span>
            </div>
            <ol className="text-xs text-blue-600 dark:text-blue-400 space-y-1 ml-6 list-decimal">
              <li>Покупатель оплачивает заказ → средства на эскроу-счёте</li>
              <li>Вы получаете уведомление и начинаете готовить заказ</li>
              <li>Заказ доставлен → таймер холдирования запущен</li>
              <li>Через {settings.escrowHoldHours}ч (без претензий) → автоматический payout</li>
              <li>При претензии → рассмотрение администрацией</li>
            </ol>
          </div>
        </Card>
      )}

      {/* ===== НАЛОГИ ===== */}
      {activeSection === "tax" && (
        <div className="space-y-4">
          {/* Критическое уведомление */}
          {!settings.taxResponsibilityAccepted && (
            <Card className="p-5 border-2 border-rose-300 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800">
              <div className="flex items-start gap-3 mb-3">
                <AlertTriangle className="h-6 w-6 text-rose-500 shrink-0" />
                <div>
                  <h3 className="font-bold text-rose-800 dark:text-rose-300">
                    ⚠️ Налоговая ответственность
                  </h3>
                  <p className="text-sm text-rose-700 dark:text-rose-400 mt-1">
                    Внимание! Вы несёте <b>самостоятельную ответственность</b> перед фискальными органами РФ
                    за уплату налогов с доходов, полученных через платформу.
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-sm text-rose-700 dark:text-rose-400 ml-9 mb-4">
                <p>📋 Платформа <b>не является</b> налоговым агентом и не удерживает налоги автоматически.</p>
                <p>📋 Вы <b>обязаны самостоятельно</b> декларировать доходы и уплачивать налоги в соответствии с вашим юр. статусом:</p>
                <ul className="ml-4 space-y-1 list-disc">
                  {isNPD && <li>{"Самозанятый (НПД): 4% с физлиц, 6% с юрлиц. Чек через «Мой налог» обязателен."}</li>}
                  {isIP && <li>{"ИП: УСН 6%/15% или ОСНО. Декларация ежеквартально/год."}</li>}
                  {isOOO && <li>{"ООО: УСН/ОСНО + НДС. Бухгалтерия + онлайн-касса (54-ФЗ)."}</li>}
                  <li>{"Физлицо: НДФЛ 13%. При доходе свыше 600 000₽/год — обязательная регистрация."}</li>
                </ul>
                <p>📋 За неуплату налогов предусмотрена <b>административная и уголовная ответственность</b> (ст. 198 УК РФ).</p>
                <p>📋 Платформа <b>вправе передать</b> данные о ваших доходах в ФНС по официальному запросу.</p>
              </div>

              <Button className="w-full bg-rose-500 hover:bg-rose-600" onClick={() => setShowTaxDisclaimer(true)}>
                <FileText className="h-4 w-4 mr-2" />Ознакомиться и принять
              </Button>
            </Card>
          )}

          {settings.taxResponsibilityAccepted && (
            <Card className="p-4 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800">
              <div className="flex items-center gap-2">
                <Check className="h-5 w-5 text-emerald-500" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  Налоговая ответственность принята
                </span>
              </div>
            </Card>
          )}

          {/* Настройки по типу */}
          {isNPD && (
            <Card className="p-5 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Receipt className="h-5 w-5 text-emerald-500" />
                Настройки для самозанятого (НПД)
              </h3>

              <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer">
                <input type="checkbox" checked={settings.npdReceiptRequired} onChange={(e) => setSettings({ ...settings, npdReceiptRequired: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
                <div className="flex-1">
                  <div className="font-medium text-sm">Обязан формировать чеки в «Мой налог»</div>
                  <p className="text-xs text-muted-foreground mt-0.5">После каждой продажи необходимо сформировать чек в приложении «Мой налог» и передать покупателю.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer">
                <input type="checkbox" checked={settings.npdReceiptReminder} onChange={(e) => setSettings({ ...settings, npdReceiptReminder: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
                <div className="flex-1">
                  <div className="font-medium text-sm">Напоминать о формировании чеков</div>
                  <p className="text-xs text-muted-foreground mt-0.5">Платформа будет напоминать после каждого заказа о необходимости сформировать чек.</p>
                </div>
              </label>

              <div className="p-3 rounded-lg bg-muted/40 text-sm">
                <div className="font-medium mb-1">Ставки НПД (2026):</div>
                <ul className="text-xs text-muted-foreground space-y-0.5 ml-4 list-disc">
                  <li>4% — продажа физическим лицам</li>
                  <li>6% — продажа юридическим лицам и ИП</li>
                  <li>3% / 4% — сниженные ставки при вычете 10 000₽ (первые доходы)</li>
                  <li>0% — первые 3 месяца для новых самозанятых (пилот)</li>
                </ul>
              </div>
            </Card>
          )}

          {(isIP || isOOO) && (
            <Card className="p-5 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-500" />
                Настройки для {isIP ? "ИП" : "ООО"}
              </h3>

              <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer">
                <input type="checkbox" checked={settings.kkmRequired} onChange={(e) => setSettings({ ...settings, kkmRequired: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
                <div className="flex-1">
                  <div className="font-medium text-sm">Использовать онлайн-кассу (54-ФЗ)</div>
                  <p className="text-xs text-muted-foreground mt-0.5">Обязательно для приёма электронных платежей. Кассовый чек выдаётся каждому покупателю.</p>
                </div>
              </label>

              {settings.kkmRequired && (
                <div>
                  <Label>Модель ККМ</Label>
                  <Input
                    value={settings.kkmModel}
                    onChange={(e) => setSettings({ ...settings, kkmModel: e.target.value })}
                    placeholder="Например: Атол 90Ф"
                    className="mt-1"
                  />
                </div>
              )}

              <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer">
                <input type="checkbox" checked={settings.selfReportTaxes} onChange={(e) => setSettings({ ...settings, selfReportTaxes: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
                <div className="flex-1">
                  <div className="font-medium text-sm">Самостоятельно подаю декларации</div>
                  <p className="text-xs text-muted-foreground mt-0.5">Платформа не подаёт декларации за вас. Вы сами несёте ответственность за сроки и корректность.</p>
                </div>
              </label>
            </Card>
          )}

          <Card className="p-4 bg-muted/30">
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" />
              Полезные ссылки
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <a href="https://lknpd.nalog.ru/" target="_blank" className="text-primary hover:underline flex items-center gap-1">
                «Мой налог» (НПД) <ChevronRight className="h-3 w-3" />
              </a>
              <a href="https://www.nalog.gov.ru/" target="_blank" className="text-primary hover:underline flex items-center gap-1">
                ФНС России <ChevronRight className="h-3 w-3" />
              </a>
              <a href="https://www.nalog.gov.ru/rn77/ip/subscribe/" target="_blank" className="text-primary hover:underline flex items-center gap-1">
                Личный кабинет ИП <ChevronRight className="h-3 w-3" />
              </a>
              <a href="https://www.nalog.gov.ru/rn77/ooo/" target="_blank" className="text-primary hover:underline flex items-center gap-1">
                Личный кабинет ООО <ChevronRight className="h-3 w-3" />
              </a>
            </div>
          </Card>
        </div>
      )}

      {/* Сохранить */}
      <div className="flex gap-2">
        <Button onClick={handleSave} className="flex-1" size="lg">
          <Check className="h-4 w-4 mr-2" />Сохранить настройки
        </Button>
      </div>

      {/* Модальное окно — полное налоговое уведомление */}
      {showTaxDisclaimer && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowTaxDisclaimer(false)}>
          <Card className="max-w-2xl max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-500" />
              Налоговая ответственность продавца
            </h2>

            <div className="space-y-4 text-sm text-muted-foreground">
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900">
                <p className="font-medium text-rose-800 dark:text-rose-300">
                  ⚠️ Уведомление о самостоятельной ответственности перед фискальными органами
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-1">1. Общие положения</h4>
                <p>Платформа «Уездный кондитер» (ООО «Уездный кондитер») является информационным посредником и <b>не является налоговым агентом</b>. Платформа не удерживает НДФЛ, НПД, налог на прибыль или иные налоги из выплат продавцам.</p>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-1">2. Обязанности продавца</h4>
                <p>Продавец <b>обязан самостоятельно</b>:</p>
                <ul className="ml-4 list-disc space-y-0.5 mt-1">
                  <li>Регистрировать доходы в налоговом органе</li>
                  <li>Формировать чеки (НПД — через «Мой налог», ИП/ООО — через ККМ по 54-ФЗ)</li>
                  <li>Подавать налоговые декларации в установленные сроки</li>
                  <li>Уплачивать налоги в полном объёме</li>
                  <li>Вести учёт доходов и расходов</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-1">3. Ставки налогов (2026)</h4>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-1.5">Статус</th>
                      <th className="py-1.5">Ставка</th>
                      <th className="py-1.5">Лимит</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <tr><td className="py-1.5">НПД (физлица)</td><td>4%</td><td>2.4 млн ₽/год</td></tr>
                    <tr><td className="py-1.5">НПД (юрлица)</td><td>6%</td><td>2.4 млн ₽/год</td></tr>
                    <tr><td className="py-1.5">УСН «Доходы»</td><td>6%</td><td>250 млн ₽/год</td></tr>
                    <tr><td className="py-1.5">УСН «Доходы − расходы»</td><td>15%</td><td>250 млн ₽/год</td></tr>
                    <tr><td className="py-1.5">ОСНО + НДС</td><td>20% + 20%</td><td>без лимита</td></tr>
                    <tr><td className="py-1.5">НДФЛ (физлицо)</td><td>13-20%</td><td>600 тыс ₽/год без рег.</td></tr>
                  </tbody>
                </table>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-1">4. Передача данных в ФНС</h4>
                <p>Платформа <b>вправе передать</b> информацию о доходах продавца в налоговые органы по официальному запросу в соответствии с п. 2 ст. 93 НК РФ и ст. 31 НК РФ.</p>
              </div>

              <div>
                <h4 className="font-semibold text-foreground mb-1">5. Ответственность</h4>
                <p>За неуплату или неполную уплату налогов предусмотрена:</p>
                <ul className="ml-4 list-disc space-y-0.5 mt-1">
                  <li>Административная (ст. 15.6 КоАП РФ) — штраф 500-1000₽</li>
                  <li>Налоговая (ст. 122 НК РФ) — штраф 20-40% от неуплаченной суммы</li>
                  <li>Уголовная (ст. 198 УК РФ) — при сумме уклонения свыше 2.7 млн ₽ за 3 года</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-muted/40">
                <p className="text-xs">
                  Нажимая «Принимаю», вы подтверждаете, что ознакомлены с налоговыми обязательствами,
                  понимаете свою ответственность и обязуетесь выполнять требования законодательства РФ о налогах и сборах.
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <Button className="flex-1 bg-rose-500 hover:bg-rose-600" onClick={handleAcceptTax}>
                <Check className="h-4 w-4 mr-2" />Принимаю, ознакомлен
              </Button>
              <Button variant="outline" onClick={() => setShowTaxDisclaimer(false)}>Закрыть</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
