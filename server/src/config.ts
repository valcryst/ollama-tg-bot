import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");

dotenv.config({ path: path.join(rootDir, ".env") });

export const config = {
  botToken: process.env.BOT_TOKEN ?? "",
  host: "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  databasePath:
    process.env.DATABASE_PATH ?? path.join(rootDir, "data", "bot.db"),
  dashboardDist: path.join(rootDir, "dashboard", "dist"),
};

export function requireBotToken(): string {
  if (!config.botToken) {
    throw new Error("BOT_TOKEN environment variable is required");
  }
  return config.botToken;
}
