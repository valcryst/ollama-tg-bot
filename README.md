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
| Group chat     | @mention, reply to bot, or random-reply roll (if enabled)   |

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
