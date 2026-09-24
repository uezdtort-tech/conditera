Deno.serve(async (req: Request) => {
  const { to, subject, html, text } = await req.json();
  const SMTP_HOST = Deno.env.get("SMTP_HOST");
  if (!SMTP_HOST) return new Response(JSON.stringify({ error: "SMTP not configured" }), { status: 500 });
  // В production: использовать Deno.smtp или внешний SMTP relay
  console.log(`[send-email] To: ${to}, Subject: ${subject}`);
  return new Response(JSON.stringify({ ok: true, to, subject }), { headers: { "Content-Type": "application/json" } });
});
