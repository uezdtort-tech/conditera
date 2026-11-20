/**
 * daily-digest — временно выключенная бизнес-функция.
 *
 * Реальная бизнес-логика и сквозные тесты ещё не готовы. Возвращаем 501
 * вместо ложного { ok: true }, чтобы расписание/оператор не считал задачу
 * успешно выполненной и не терял уведомления/операции без результата.
 */

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  return Response.json(
    { ok: false, error: "not_implemented", function: "daily-digest" },
    { status: 501 },
  );
});
