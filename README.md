# OpenAI-compatible Telegram Bot

Telegram bot backed by any **OpenAI-compatible chat completions API** (LocalAI, Ollama, vLLM, OpenAI, etc.), with a web dashboard for configuration and stats.

## Docker

```bash
# .env or Portainer: BOT_TOKEN=...  optional PORT=3000
docker compose up -d --build
```

Open `http://localhost:3000` (or your `PORT`). Configure an OpenAI-compatible API base URL in Settings.

## Local dev

```bash
npm install
cp .env.example .env   # BOT_TOKEN only
npm run dev
```

- UI: http://localhost:5173 (Vite)
- API + bot: http://localhost:3000 (Vite proxies `/api` there)

## Env

| Variable | Where | Default |
|----------|-------|---------|
| `BOT_TOKEN` | everywhere | required (skip if using IRC training mode) |
| `VRAM_AVAILABLE` | everywhere | required (GPU GB, e.g. `24`) |
| `IRC_TRAINING_MODE` | everywhere | `false` — enable local IRC testing mode |
| `IRC_SERVER` | everywhere | `127.0.0.1:6667` |
| `IRC_CHANNELS` | everywhere | `#bot-training` (comma-separated) |
| `IRC_NICK` | everywhere | `ollama-bot` |
| `OPENAI_API_KEY` | optional | empty (local servers usually skip this) |
| `TAVILY_API_KEY` | optional | empty (web search off) |
| `LOGGING_LEVEL` | optional | `ERROR` (`DEBUG`) |
| `PORT` | Docker / Portainer only | `3000` |

Do not put `PORT` in `.env` for local dev — it is only for `docker-compose.yml` (`PORT:PORT` mapping + app listen).

API base URL is set in the **dashboard** (Settings). Tavily is configured via **`TAVILY_API_KEY`** in `.env`.

### Web search (Tavily)

With `TAVILY_API_KEY` set, the model decides whether a message needs a web search; the bot calls [Tavily](https://tavily.com) and injects the summary plus sources before replying.

### Link fetch (Playwright)

When an addressed message contains `http(s)` links, the bot detects them, opens up to three pages with [Playwright](https://playwright.dev), and injects title plus page text before the main reply. Docker images install Chromium automatically; for local dev run `npx playwright install chromium` once after `npm install`.

## Features

- Group & private chats, vision (images/stickers), optional random group replies
- Optional web search via Tavily (model decides when to search)
- Opens links in addressed messages via Playwright (auto-detected URLs)
- **Maintenance mode** — dashboard toggle; when on, only the configured owner can trigger LLM-backed behavior (others are ignored silently)
- **IRC training mode** — local testing with [pymcp-ircd](https://github.com/...). Set `IRC_TRAINING_MODE=true` and the bot connects to a local IRC server instead of Telegram. No internet, no `BOT_TOKEN` needed. Supports `!help`, `!reset`, `!mood`, `!remember` and more — with owner gating via `ownerUsername`.
- Dashboard: API base URL, model, owner, prompts, stats

## Stack

Node 22.13+, TypeScript, Grammy, Express, SQLite, React (Vite), Docker.

## License

ISC
