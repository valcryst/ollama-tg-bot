import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { logInfo } from "./logging.js";
import { initDatabase } from "./db/database.js";
import { createApiRouter } from "./api/routes.js";
import { startBot, stopBot } from "./bot/index.js";

async function main(): Promise<void> {
  initDatabase();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", createApiRouter());

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    console.error("API error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  });

  const indexHtml = path.join(config.dashboardDist, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.dashboardDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(indexHtml);
    });
    logInfo(`Dashboard: ${config.dashboardDist}`);
  } else if (!process.env.NODE_ENV || process.env.NODE_ENV === "development") {
    logInfo("No dashboard build — run npm run dev -w dashboard (Vite)");
  }

  await startBot();

  const server = app.listen(config.port, config.host, () => {
    logInfo(`Listening on http://${config.host}:${config.port}`);
  });

  const shutdown = async () => {
    logInfo("Shutting down...");
    await stopBot();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
