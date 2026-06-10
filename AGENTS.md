# AGENTS.md

Guidance for AI agents working in this repository.

## Project summary

Telegram bot backed by **OpenAI-compatible API**, with a **React dashboard** for configuration. One Node process runs the Grammy bot, Express API, and (in production) serves the built dashboard.

| Workspace | Role |
|-----------|------|
| `server/` | Bot, LLM client, SQLite, REST API |
| `dashboard/` | Vite + React admin UI |

## Commands

```bash
npm install
cp .env.example .env          # BOT_TOKEN required
npm run dev                   # server :3000 + dashboard :5173 (API proxied)
npm run build                 # dashboard dist + server tsc
npm run start                 # production server only
```

Per-workspace:

```bash
npm run dev -w server
npm run build -w server
npm run build -w dashboard
```

Docker: `docker compose up -d --build` (see `README.md`).

**Node:** `>=22.13.0` (see `.nvmrc`).

## Environment

| Variable | Purpose |
|----------|---------|
| `BOT_TOKEN` | Telegram bot token (required) |
| `VRAM_AVAILABLE` | GPU VRAM in GB (required); derives context window budget |
| `OPENAI_API_KEY` | Optional API key for authenticated OpenAI-compatible endpoints |
| `LOGGING_LEVEL` | `ERROR` (default), `DEBUG` (lifecycle events), or `VERBOSE` (+ LLM I/O) |
| `TAVILY_API_KEY` | Optional web search via Tavily |
| `PORT` | Docker/production listen port only — not for local dev |
| `DATABASE_PATH` | Optional SQLite path (default `data/bot.db`) |

API base URL, model, prompts, owner, and performance limits live in **dashboard settings** (SQLite), not `.env`.

## Architecture

```
Telegram → Grammy handlers → chat-turn → LLM
                ↓
         SQLite (settings, history, memories, stats)
                ↑
         Express /api ← dashboard (Vite dev proxy)
```

### Message flow

1. **`server/src/bot/handlers.ts`** — Register **commands before** the catch-all `bot.on("message")`. Generic message handlers must not block command handlers (Grammy middleware order).
2. **`server/src/bot/chat-turn.ts`** — One user turn: optional link fetch (Playwright), optional Tavily search, build messages, LLM chat, Telegram reply, history + memory scheduling.
3. **`server/src/bot/conversation.ts`** — Assembles system prompt, history, reply context, group speaker wrapping.
4. **`server/src/prompts.ts`** — Base system prompt; custom prompt from settings appended.

### LLM

- Client: `server/src/llm/client.ts` (OpenAI SDK → `/v1/chat/completions`)
- Chat options: `server/src/settings-limits.ts` (`temperature`, `topP`, `topK`, `repeatPenalty`, `numCtx` via `getProviderExtensions()`)
- **Chat history limits are derived** from `numCtx` and `numPredict` via `getHistoryLimits()` — not separate settings. Dashboard preview: `dashboard/src/derivedHistoryLimits.ts` (keep in sync with server).

### Memory

Three layers, extracted in a **background pass** (`server/src/memory-extract.ts`), not in the main reply:

- Per-user, per-group, general — see `server/src/db/*-memory.ts`
- User/group memories are merged into one entity document during persistence.

### Group behavior

- Bot responds when @mentioned, replied to, named (LLM check), or on random/image toggles.
- Per-member history in groups (`conversationKey` includes `userId`).
- Owner account: `ownerUsername` in settings; id resolved via Telegram API + `known_users` table.

### Response format

Model replies use `[REPLY]…[/REPLY]` (Telegram HTML subset). Parser: `server/src/response-format.ts`. Only `[REPLY]` is sent to users.

**LLM response fields:** User-facing text comes from the API `content` field. Chain-of-thought / reasoning comes from the separate `reasoning` (or `reasoning_content`) field — sent to Telegram only when `sendThinkingEnabled` is on. Never merge reasoning into the reply body.

## Code conventions

- **ESM** throughout; server imports use `.js` extensions (`"type": "module"`).
- **Minimal diffs** — match existing style, naming, and patterns in the file you edit.
- **No drive-by refactors** or unrelated changes.
- **Do not commit** unless the user asks. Do not put secrets in git (`.env`, tokens).
- **No ad-hoc output heuristics** — do not strip or classify model text with hardcoded keyword lists, magic regex, or guessed “reasoning leak” patterns. Use API response fields (`content` vs `reasoning`) and the project’s structured block protocol (`[REPLY]`, `[SEARCH]`, `[STICKER]`, etc. — tag names in `response-format.ts` and each side-pass spec). Side passes parse **closed** blocks only.
- **SQLite settings** — add new keys to `DEFAULT_SETTINGS` in `server/src/db/database.ts`, validation in `settings-limits.ts`, allowed PATCH keys in `server/src/api/routes.ts`, and dashboard `Settings` in `dashboard/src/api.ts`.

## Dashboard pages

| Route | Purpose |
|-------|---------|
| `/` | Overview, stats, error log |
| `/character` | Default + custom system prompts |
| `/settings` | LLM, model, owner, performance, vision |
| `/memories` | User / group / general facts |

State: `dashboard/src/context/DashboardContext.tsx`. API client: `dashboard/src/api.ts`.

## Telegram specifics

- Entity offsets are **UTF-16 code units** (same as JS strings) — see `sliceEntity` in `server/src/bot/addressed.ts`.
- Group commands often need `/cmd@BotUsername` when privacy mode is on.
- Mention handling: `server/src/bot/mentions.ts` (skip self-mentions and bot mention for address detection).

## Key files

| Area | Files |
|------|-------|
| Bot entry | `server/src/bot/index.ts`, `handlers.ts` |
| Settings DB | `server/src/db/database.ts`, `server/src/api/routes.ts` |
| History | `server/src/db/history.ts` |
| Vision | `server/src/bot/message-media.ts`, `server/src/llm/images.ts` |
| Search | `server/src/bot/search-analyze.ts`, `server/src/tavily/client.ts` |
| Link fetch | `server/src/bot/link-extract.ts`, `server/src/bot/link-fetch.ts`, `server/src/playwright/client.ts` |
| HTML replies | `server/src/telegram/html.ts` |

## Testing

No automated test suite. After server changes: `npm run build -w server`. After dashboard changes: `npm run build -w dashboard`. Manually verify bot commands (`/start`, `/id`, `/reset`) and dashboard save/load.

## Common pitfalls

1. Registering `bot.on("message")` **before** `bot.command(...)` breaks slash commands.
2. Duplicating history limit math — use `getHistoryLimits()` on server only; mirror in dashboard for UI preview only.
3. Assuming `@username` resolves without the user having messaged the bot at least once.
4. Editing only server or only dashboard types when adding a setting — update both + PATCH allowlist.
