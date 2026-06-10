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

function resolveOpenAiApiKey(): string {
  return (process.env.OPENAI_API_KEY ?? "").trim();
}

export type LoggingLevel = "ERROR" | "DEBUG" | "VERBOSE";

function resolveLoggingLevel(): LoggingLevel {
  const raw = (process.env.LOGGING_LEVEL ?? "ERROR").trim().toUpperCase();
  if (raw === "DEBUG" || raw === "VERBOSE") return raw;
  return "ERROR";
}

interface StartupEnv {
  botToken: string;
  vramAvailableGb: number;
}

let startupEnv: StartupEnv | undefined;

function collectRequiredEnvErrors(): string[] {
  const errors: string[] = [];

  const botToken = (process.env.BOT_TOKEN ?? "").trim();
  if (!botToken) {
    errors.push("BOT_TOKEN environment variable is required");
  }

  const vramRaw = (process.env.VRAM_AVAILABLE ?? "").trim();
  if (!vramRaw) {
    errors.push(
      "VRAM_AVAILABLE environment variable is required (GPU VRAM in gigabytes, e.g. 24)",
    );
  } else {
    const value = Number(vramRaw);
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(
        "VRAM_AVAILABLE must be a positive number of gigabytes (e.g. 24)",
      );
    }
  }

  return errors;
}

function resolveStartupEnv(): StartupEnv {
  const errors = collectRequiredEnvErrors();
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return {
    botToken: (process.env.BOT_TOKEN ?? "").trim(),
    vramAvailableGb: Number((process.env.VRAM_AVAILABLE ?? "").trim()),
  };
}

/** Validates BOT_TOKEN and VRAM_AVAILABLE. Call once before the server listens. */
export function requireStartupEnv(): StartupEnv {
  if (!startupEnv) {
    startupEnv = resolveStartupEnv();
  }
  return startupEnv;
}

export function requireBotToken(): string {
  return requireStartupEnv().botToken;
}

/** GPU VRAM from VRAM_AVAILABLE - used to derive context window from the selected model. */
export function getVramAvailableGb(): number {
  return requireStartupEnv().vramAvailableGb;
}

export const config = {
  host: "0.0.0.0",
  port: resolvePort(),
  databasePath:
    process.env.DATABASE_PATH ?? path.join(rootDir, "data", "bot.db"),
  dashboardDist: path.join(rootDir, "dashboard", "dist"),
  /** Tavily API key from env (TAVILY_API_KEY). Empty = web search off. */
  tavilyApiKey: resolveTavilyApiKey(),
  /** OpenAI-compatible API key from env (OPENAI_API_KEY). Local servers can leave it empty. */
  openAiApiKey: resolveOpenAiApiKey(),
  /** ERROR = errors only; DEBUG = lifecycle events; VERBOSE = + LLM I/O. */
  loggingLevel: resolveLoggingLevel(),
};
