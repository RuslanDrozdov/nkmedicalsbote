/**
 * Установка webhook для продакшена.
 * Переменные окружения:
 *   BOT_TOKEN — токен бота
 *   WEBHOOK_URL — полный URL, например https://telegram-survey-bot.xxx.workers.dev/webhook
 *   WEBHOOK_SECRET — (опционально) тот же секрет, что в wrangler secret put WEBHOOK_SECRET
 */
import "dotenv/config";

const token = process.env.BOT_TOKEN;
const url = process.env.WEBHOOK_URL;
const secret = process.env.WEBHOOK_SECRET;

if (!token || !url) {
  console.error("Нужны BOT_TOKEN и WEBHOOK_URL в .env");
  process.exit(1);
}

const params = new URLSearchParams({ url });
if (secret) params.set("secret_token", secret);

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?${params}`);
const data = await res.json();

if (!data.ok) {
  console.error("setWebhook failed:", data);
  process.exit(1);
}

console.log("Webhook установлен:", data);
