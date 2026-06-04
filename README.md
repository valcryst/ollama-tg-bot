# Ollama Telegram Bot

Telegram bot backed by [Ollama](https://ollama.com), with a web dashboard for configuration and stats.

## Docker

```bash
# .env or Portainer: BOT_TOKEN=...  optional PORT=3000
docker compose up -d --build
```

Open `http://localhost:3000` (or your `PORT`). Ollama on the host: `http://host.docker.internal:11434`.

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
| `BOT_TOKEN` | everywhere | required |
| `PORT` | Docker / Portainer only | `3000` |

Do not put `PORT` in `.env` for local dev — it is only for `docker-compose.yml` (`PORT:PORT` mapping + app listen).

## Features

- Group & private chats, vision (images/stickers), optional random group replies
- Dashboard: Ollama host, model, prompts, stats

## Stack

Node 22.13+, TypeScript, Grammy, Express, SQLite, React (Vite), Docker.

## License

ISC
