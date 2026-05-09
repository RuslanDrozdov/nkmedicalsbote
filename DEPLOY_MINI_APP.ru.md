# Деплой Telegram Mini App (React) + Worker + D1 на Cloudflare

Кратко: один Worker обслуживает webhook бота (`POST /webhook`), JSON API для мини-приложения (`/api/*`) и статику React из каталога `mini-app/dist` (путь в браузере: `/app/`).

## Предварительные условия

- Установлены [Node.js](https://nodejs.org/) 18+ и npm.
- Аккаунт Cloudflare и установленный Wrangler (`npm i` в корне репозитория подтянет devDependency `wrangler`).
- Токен бота у [@BotFather](https://t.me/BotFather).

## 1. Зависимости

В корне репозитория:

```bash
npm install
```

В каталоге мини-приложения (либо только перед сборкой — корневой скрипт `build:mini-app` сам вызывает сборку):

```bash
cd mini-app
npm install
cd ..
```

## 2. База D1 (схема)

Один раз для **удалённой** базы (имя и `database_id` должны совпадать с вашим `wrangler.toml`):

```bash
npm run db:init:remote
```

Локально при `wrangler dev`:

```bash
npm run db:init:local
```

## 3. Секреты и переменные Worker

Через Wrangler (интерактивно вводится значение):

```bash
npx wrangler secret put BOT_TOKEN
```

Опционально, если используете проверку webhook по секрету (см. `scripts/set-webhook.mjs` и комментарии в `wrangler.toml`):

```bash
npx wrangler secret put WEBHOOK_SECRET
```

**Обязательно для кнопки «Открыть приложение» в `/start`:** полный HTTPS-URL мини-приложения с завершающим слэшем, например:

```bash
npx wrangler secret put MINI_APP_URL
```

Введите значение вида `https://<имя-воркера>.workers.dev/app/` (подставьте реальный хост после первого деплоя или свой кастомный домен).

Для локальной разработки скопируйте `BOT_TOKEN`, при необходимости `WEBHOOK_SECRET` и `MINI_APP_URL` в файл **`.dev.vars`** в корне (файл не коммитится).

## 4. Сборка фронтенда и деплой

Из корня:

```bash
npm run deploy
```

Скрипт выполняет `npm run build:mini-app` (сборка Vite в `mini-app/dist`) и затем `wrangler deploy`. Статика подключается в `wrangler.toml` секцией `[assets]` с `run_worker_first = true`: сначала выполняется ваш `worker.js`, который обрабатывает `/api/*` и `/webhook`, остальные `GET`/`HEAD` передаются в раздачу файлов из `mini-app/dist`.

## 5. Webhook Telegram

У одного бота **нельзя** одновременно использовать long polling (`npm start` / `bot.js`) и webhook на тот же токен. Для продакшена на Cloudflare задайте webhook:

```bash
set WEBHOOK_URL=https://<ваш-воркер>.workers.dev/webhook
npm run webhook:set
```

Если задан `WEBHOOK_SECRET`, тот же `secret_token` должен быть указан при `setWebhook` (см. ваш скрипт и документацию Bot API).

## 6. BotFather и домен Mini App

1. В [@BotFather](https://t.me/BotFather) откройте своего бота → **Bot Settings** → **Configure Mini App** (или аналогичный пункт в меню) и укажите **домен** приложения: для `*.workers.dev` это домен вида `<имя>.workers.dev` без пути (Cloudflare должен быть в списке доверенных у Telegram; для `workers.dev` это обычно так).
2. Убедитесь, что `MINI_APP_URL` в секретах Worker совпадает с реальным URL, по которому открывается собранное приложение (`…/app/`).
3. Команда `/start` в чате отправляет приветствие и inline-кнопку **Web App** с этим URL.

## 7. Проверка после деплоя

- `GET https://<хост>/health` — ответ `ok`.
- `GET https://<хост>/` — JSON с подсказкой эндпоинтов и полем `mini_app`.
- Откройте в Telegram мини-приложение по кнопке с `/start` и пройдите сценарий; запросы к `/api/me` и др. должны уходить с заголовком `X-Telegram-Init-Data` (его выставляет клиент из `Telegram.WebApp.initData`).

## 8. Локальная отладка Mini App

Telegram открывает Web App только по **HTTPS**. Для туннеля используйте `wrangler dev` (в т.ч. с публичным URL trycloudflare), задайте в `.dev.vars` актуальный `MINI_APP_URL` на этот URL и при необходимости временно пропишите домен в BotFather.

## Полезные команды

| Команда | Назначение |
|--------|------------|
| `npm run build:mini-app` | Только сборка React в `mini-app/dist` |
| `npm run deploy` | Сборка + `wrangler deploy` |
| `npm run dev:worker` | Локальный Worker + D1 local |
| `npm run db:init:remote` | Применить `schema.sql` к удалённой D1 |
