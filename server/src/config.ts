import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");

dotenv.config({ path: path.join(rootDir, ".env") });

/** API listen port. `PORT` in `.env` applies in production (Docker) only; local dev uses 3000 for Vite proxy. */
function resolvePort(): number {
  if (process.env.NODE_ENV === "production") {
    return Number(process.env.PORT ?? 3000);
  }
  return 3000;
}

function resolveTavilyApiKey(): string {
  return (process.env.TAVILY_API_KEY ?? "").trim();
}

export const config = {
  botToken: process.env.BOT_TOKEN ?? "",
  host: "0.0.0.0",
  port: resolvePort(),
  databasePath:
    process.env.DATABASE_PATH ?? path.join(rootDir, "data", "bot.db"),
  dashboardDist: path.join(rootDir, "dashboard", "dist"),
  /** Tavily API key from env (TAVILY_API_KEY). Empty = web search off. */
  tavilyApiKey: resolveTavilyApiKey(),
};

export function requireBotToken(): string {
  if (!config.botToken) {
    throw new Error("BOT_TOKEN environment variable is required");
  }
  return config.botToken;
}
