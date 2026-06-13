import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import { config, requireStartupEnv } from "./config.js";
import { logInfo } from "./logging.js";
import { initDatabase, getSettings } from "./db/database.js";
import { refreshModelContextCache } from "./llm/model-context-cache.js";
import { createApiRouter } from "./api/routes.js";
import { startBot, stopBot } from "./bot/index.js";
import { closePlaywrightBrowser } from "./playwright/client.js";
import {
  startMoodCooldownWorker,
  stopMoodCooldownWorker,
} from "./mood-cooldown.js";
import { initLiveSocket } from "./socket.js";
import { IrcClient, type IrcClientConfig } from "./bot/irc-client.js";
import { runIrcTurn } from "./bot/irc-chat-turn.js";

let ircClient: IrcClient | null = null;

/**
 * Resolve IRC configuration, preferring DB settings over env vars.
 * When `ircTrainingMode` is enabled in the database, those values win.
 * Otherwise the `.env` values from `config.irc` are used.
 */
function resolveIrcConfig(): IrcClientConfig | null {
  const bootSettings = getSettings();

  const enabled = bootSettings.ircTrainingMode || config.irc.enabled;
  if (!enabled) return null;

  const server = bootSettings.ircTrainingMode
    ? bootSettings.ircServer
    : config.irc.server;

  const channels = bootSettings.ircTrainingMode
    ? bootSettings.ircChannels
        .split(",")
        .map((ch) => ch.trim())
        .filter((ch) => ch.length > 0)
    : config.irc.channels;

  const nick = bootSettings.ircTrainingMode
    ? (bootSettings.ircNick || config.irc.nick)
    : config.irc.nick;

  const [host, portStr] = server.split(":");
  const port = portStr ? Number(portStr) : 6667;

  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    logInfo(`Invalid IRC port in ${server}, falling back to 6667`);
    return { host, port: 6667, nick, channels };
  }

  return { host, port, nick, channels };
}

/**
 * Start the IRC client and wire up message handling.
 * Runs the LLM turn for every incoming channel message.
 */
async function startIrc(): Promise<void> {
  const ircConfig = resolveIrcConfig();
  if (!ircConfig) {
    logInfo("IRC training mode disabled — skipping IRC client");
    return;
  }

  logInfo(
    `IRC training mode: ${ircConfig.nick} on ${ircConfig.host}:${ircConfig.port} ` +
      `→ ${ircConfig.channels.join(", ")}`,
  );

  ircClient = new IrcClient(ircConfig);

  ircClient.onMessage(async (msg) => {
    try {
      const result = await runIrcTurn({
        channel: msg.channel,
        nick: msg.nick,
        text: msg.text,
      });
      ircClient?.sendMessage(msg.channel, result.reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ircClient?.sendMessage(msg.channel, `Error: ${message}`);
    }
  });

  await ircClient.connect();
}

async function stopIrc(): Promise<void> {
  if (ircClient) {
    ircClient.disconnect();
    ircClient = null;
  }
}

async function main(): Promise<void> {
  requireStartupEnv();

  initDatabase();
  const bootSettings = getSettings();
  void refreshModelContextCache(bootSettings.model, bootSettings.apiBaseUrl);
  startMoodCooldownWorker();

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

  const server = app.listen(config.port, config.host, () => {
    logInfo(`Listening on http://${config.host}:${config.port}`);
  });

  const liveSocket = initLiveSocket(server);

  const ircActive = resolveIrcConfig() !== null;
  if (ircActive) {
    await startIrc();
  } else {
    await startBot();
  }

  const shutdown = async () => {
    logInfo("Shutting down...");
    stopMoodCooldownWorker();
    if (ircActive) {
      await stopIrc();
    } else {
      await stopBot();
    }
    await closePlaywrightBrowser();
    liveSocket.close();
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
