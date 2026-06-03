import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
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

  const dashboardPath = config.dashboardDist;
  if (fs.existsSync(path.join(dashboardPath, "index.html"))) {
    app.use(express.static(dashboardPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(dashboardPath, "index.html"));
    });
    console.log(`Dashboard served from ${dashboardPath}`);
  } else {
    console.log(
      "Dashboard build not found — run `npm run build` or use dashboard dev server on :5173",
    );
  }

  await startBot();

  const server = app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });

  const shutdown = async () => {
    console.log("Shutting down...");
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
