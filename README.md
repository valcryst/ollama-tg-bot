# Ollama Telegram Bot

Telegram bot backed by [Ollama](https://ollama.com), with a web dashboard for configuration and stats.

## Features

- **Group & private chats** — responds when @mentioned, when you reply to the bot, or in private messages
- **Vision** — understands photos, image documents, and stickers (animated/video stickers use Telegram’s static preview frame)
- **Random group replies** — optional chance to reply to unrelated group messages
- **Dashboard** — Ollama host, model picker, system prompt, random-reply settings, live stats

## Stack

- Node.js 22.13+ + TypeScript (Grammy, Express, built-in `node:sqlite`)
- React + TypeScript (Vite)
- SQLite
- Docker / Docker Compose

## Quick start (Docker)

1. Copy env and set your bot token:

   ```bash
   cp .env.example .env
   # Edit .env — set BOT_TOKEN from @BotFather
   ```

2. Start Ollama on the host (or uncomment the `ollama` service in `docker-compose.yml`).

3. Run:

   ```bash
   docker compose up -d --build
   ```

4. Open **http://localhost:3000** for the dashboard.

5. Set **Ollama host** to `http://host.docker.internal:11434` (default) when Ollama runs on your machine outside Docker.

6. Click **Refresh** under Model, pick a model (e.g. `llama3.2` or a vision model for images), and **Save**.

### Portainer / remote stack deploy

`.env` is not in git. Do **not** rely on a `.env` file on the server unless you create it manually.

1. Deploy the stack from this repo’s `docker-compose.yml`.
2. In the stack **Environment variables**, add:
   - `BOT_TOKEN` = your token from @BotFather
   - (optional) `PORT` = `3000`
3. Redeploy the stack.

Alternatively, create `.env` next to `docker-compose.yml` on the host (copy from `.env.example`) — Compose will use it for `${BOT_TOKEN}` substitution.

## Requirements

- **Node.js 22.13+** (uses the built-in `node:sqlite` module — no native addons)
- Run `nvm use` in the project root if you use nvm (see `.nvmrc`)

## Local development

```bash
npm install
cp .env.example .env   # set BOT_TOKEN

# Terminal 1 — API + bot
npm run dev -w server

# Terminal 2 — dashboard (proxies /api to :3000)
npm run dev -w dashboard
```

Or both: `npm run dev`

- Dashboard: http://localhost:5173  
- API: http://localhost:3000  

## Environment variables

| Variable        | Required | Description                          |
|----------------|----------|--------------------------------------|
| `BOT_TOKEN`    | Yes      | Telegram bot token from @BotFather   |
| `PORT`         | No       | HTTP port (default `3000`)           |
| `DATABASE_PATH`| No       | SQLite file path                     |

Ollama URL, model, prompts, and random-reply settings are stored in SQLite and edited via the dashboard.

## Bot behavior

| Context        | Triggers a reply when…                                      |
|----------------|-------------------------------------------------------------|
| Private chat   | Any text or image/sticker                                   |
| Group chat     | @mention, reply to bot, `/cmd@botname`, or random-reply roll (if enabled) |

**Groups & privacy mode:** By default @BotFather enables *privacy mode* — the bot only sees @mentions, replies to it, and commands. That matches the triggers above. If @mentions still do nothing, open @BotFather → `/setprivacy` → **Disable**, restart the bot, and ensure it can **send messages** in the group (not restricted).

Pull a vision model for image understanding:

```bash
ollama pull llava
```

Then select it in the dashboard.

## Project layout

```
server/       Bot + REST API + SQLite
dashboard/    React admin UI
data/         SQLite DB (created at runtime)
```

## License

ISC
