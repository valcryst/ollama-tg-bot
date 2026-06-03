import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.resolve(__dirname, '..', '..', ".env");

dotenv.config({
  path: envPath,
});

export const config = {
  botToken: process.env.BOT_TOKEN ?? "",
  port: Number(process.env.PORT ?? 3000),
  databasePath:
    process.env.DATABASE_PATH ??
    path.join(__dirname, "..", "..", "data", "bot.db"),
  dashboardDist:
    process.env.DASHBOARD_DIST ??
    path.join(__dirname, "..", "..", "dashboard", "dist"),
};

export function requireBotToken(): string {
  if (!config.botToken) {
    throw new Error("BOT_TOKEN environment variable is required");
  }
  return config.botToken;
}
