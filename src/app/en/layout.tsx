/**
 * Layout для маршрутов с префиксом /en/ — английская версия сайта.
 *
 * Устанавливает lang="en" на оборачивающем div (HTML-атрибут lang),
 * что помогает скринридерам и поисковикам корректно определять язык
 * содержимого. Корневой <html lang="ru"> переопределяется на уровне
 * div для EN-секции.
 *
 * @see src/lib/i18n.ts — детект языка по URL /en/
 */
export default function EnLayout({ children }: { children: React.ReactNode }) {
  return <div lang="en">{children}</div>;
}
