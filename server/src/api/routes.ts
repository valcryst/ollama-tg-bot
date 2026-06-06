import { Router } from "express";
import { getBotUsername, getBot } from "../bot/index.js";
import { resolveOwnerUsername } from "../bot/resolve-owner.js";
import {
  getStickerCatalogState,
  getStickerPreviewFileId,
  refreshStickerCatalog,
  syncStickerCatalogFromSettings,
} from "../bot/sticker-catalog.js";
import { getTelegramFilePath } from "../bot/files.js";
import { requireBotToken } from "../config.js";
import {
  clearErrors,
  getSettings,
  getStats,
  updateSettings,
  type Settings,
} from "../db/database.js";
import { checkHealth, listModels } from "../ollama/client.js";
import { isTavilyConfigured } from "../tavily/client.js";
import { buildBaseSystemPrompt } from "../prompts.js";
import { getHistoryLimits } from "../settings-limits.js";
import {
  clearGroupFactsForGroup,
  createGroupFact,
  deleteGroupFactById,
  listAllGroupFacts,
  updateGroupFactById,
} from "../db/group-memory.js";
import {
  MAX_FACT_LENGTH,
  MIN_FACT_LENGTH,
  normalizeEntityId,
  normalizeFactText,
} from "../db/memory-facts.js";
import {
  clearAllGeneralFacts,
  createGeneralFact,
  deleteGeneralFactById,
  listGeneralFacts,
  updateGeneralFactById,
} from "../db/general-memory.js";
import {
  clearUserFactsForUser,
  createUserFact,
  deleteUserFactById,
  listAllUserFacts,
  updateUserFactById,
} from "../db/user-memory.js";
import { listRecentErrors } from "../db/error-log.js";
import { getDataTable, listDataTables } from "../db/data-browser.js";

const startedAt = new Date();

function stickerCatalogResponse() {
  const settings = getSettings();
  const catalog = getStickerCatalogState();
  return {
    enabled: settings.stickersEnabled,
    packName: catalog.packName || settings.stickerPackName,
    stickers: catalog.stickers,
    loaded: catalog.loaded,
    error: catalog.error,
  };
}

export function createApiRouter(): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/settings", (_req, res) => {
    try {
      const settings = getSettings();
      res.json({
        ...settings,
        baseSystemPrompt: buildBaseSystemPrompt(settings),
        derivedHistoryLimits: getHistoryLimits(settings),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to load settings",
      });
    }
  });

  router.patch("/settings", async (req, res) => {
    try {
      const body = req.body as Partial<Settings>;
      const allowed: (keyof Settings)[] = [
        "ollamaHost",
        "model",
        "customSystemPrompt",
        "randomReplyEnabled",
        "randomReplyChance",
        "reactToEveryImage",
        "numPredict",
        "numCtx",
        "temperature",
        "chatTimeoutSec",
        "visionMaxDimension",
        "ownerUsername",
        "stickersEnabled",
        "stickerPackName",
        "stickerReplyChance",
      ];
      const patch: Partial<Settings> = {};
      for (const key of allowed) {
        if (body[key] !== undefined) patch[key] = body[key] as never;
      }

      if (body.ownerUsername !== undefined) {
        const raw = String(body.ownerUsername).trim();
        if (raw === "") {
          patch.ownerUsername = "";
          patch.ownerUserId = "";
        } else {
          const bot = getBot();
          patch.ownerUserId = await resolveOwnerUsername(bot.api, raw);
        }
      }

      const updated = updateSettings(patch);

      if (
        body.stickersEnabled !== undefined ||
        body.stickerPackName !== undefined
      ) {
        try {
          const bot = getBot();
          await syncStickerCatalogFromSettings(bot.api);
        } catch {
          // Bot may not be running during early setup; catalog syncs on startup.
        }
      }

      res.json({
        ...updated,
        baseSystemPrompt: buildBaseSystemPrompt(updated),
        derivedHistoryLimits: getHistoryLimits(updated),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Invalid settings",
      });
    }
  });

  router.get("/models", async (req, res) => {
    try {
      const host =
        typeof req.query.host === "string" ? req.query.host : undefined;
      const models = await listModels(host);
      res.json({ models });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch models";
      const status = message.includes("not configured") ? 400 : 502;
      res.status(status).json({ error: message });
    }
  });

  router.get("/tavily/status", (_req, res) => {
    res.json({ configured: isTavilyConfigured(), ok: isTavilyConfigured() });
  });

  router.get("/stickers", (_req, res) => {
    try {
      res.json(stickerCatalogResponse());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to load stickers",
      });
    }
  });

  router.get("/stickers/:index/preview", async (req, res) => {
    try {
      const index = Number.parseInt(req.params.index, 10);
      if (!Number.isInteger(index) || index < 0) {
        res.status(400).json({ error: "Invalid sticker index" });
        return;
      }

      const fileId = getStickerPreviewFileId(index);
      if (!fileId) {
        res.status(404).json({ error: "Sticker not found" });
        return;
      }

      const token = requireBotToken();
      const filePath = await getTelegramFilePath(token, fileId);
      if (!filePath) {
        res.status(404).json({ error: "Sticker file not available" });
        return;
      }

      const ext = filePath.split(".").pop()?.toLowerCase() ?? "webp";
      const contentType =
        ext === "png"
          ? "image/png"
          : ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "gif"
              ? "image/gif"
              : "image/webp";

      const fileRes = await fetch(
        `https://api.telegram.org/file/bot${token}/${filePath}`,
      );
      if (!fileRes.ok) {
        res.status(502).json({ error: "Failed to fetch sticker from Telegram" });
        return;
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(Buffer.from(await fileRes.arrayBuffer()));
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to load preview",
      });
    }
  });

  router.post("/stickers/refresh", async (_req, res) => {
    try {
      const settings = getSettings();
      if (!settings.stickerPackName.trim()) {
        res.status(400).json({ error: "Sticker pack name is not configured" });
        return;
      }
      const bot = getBot();
      const result = await refreshStickerCatalog(
        bot.api,
        settings.stickerPackName,
      );
      const payload = stickerCatalogResponse();
      if (!result.ok) {
        res.status(400).json({
          ...payload,
          error: result.error ?? payload.error ?? "Failed to load sticker set",
        });
        return;
      }
      res.json(payload);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to refresh stickers",
      });
    }
  });

  router.get("/ollama/health", async (req, res) => {
    try {
      const host =
        typeof req.query.host === "string" ? req.query.host : undefined;
      const ok = await checkHealth(host);
      res.json({ ok });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : "Ollama host is not configured",
      });
    }
  });

  router.get("/memories", (_req, res) => {
    try {
      const facts = listAllUserFacts();
      res.json({ facts, total: facts.length });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to load memories",
      });
    }
  });

  router.post("/memories", (req, res) => {
    try {
      const userId = normalizeEntityId(
        (req.body as { userId?: string })?.userId,
      );
      const fact = normalizeFactText((req.body as { fact?: string })?.fact);
      if (!userId) {
        res.status(400).json({ error: "userId is required" });
        return;
      }
      if (!fact) {
        res.status(400).json({
          error: `fact must be ${MIN_FACT_LENGTH}–${MAX_FACT_LENGTH} characters`,
        });
        return;
      }
      const created = createUserFact(userId, fact);
      if (!created) {
        res.status(400).json({ error: "Could not create memory" });
        return;
      }
      res.status(201).json({ fact: created });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to create memory",
      });
    }
  });

  router.patch("/memories/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Invalid memory id" });
        return;
      }
      const fact = normalizeFactText((req.body as { fact?: string })?.fact);
      if (!fact) {
        res.status(400).json({
          error: `fact must be ${MIN_FACT_LENGTH}–${MAX_FACT_LENGTH} characters`,
        });
        return;
      }
      const updated = updateUserFactById(id, fact);
      if (updated === "duplicate") {
        res.status(409).json({ error: "That fact already exists for this user" });
        return;
      }
      if (!updated) {
        res.status(404).json({ error: "Memory not found" });
        return;
      }
      res.json({ fact: updated });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to update memory",
      });
    }
  });

  router.delete("/memories/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Invalid memory id" });
        return;
      }
      if (!deleteUserFactById(id)) {
        res.status(404).json({ error: "Memory not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to delete memory",
      });
    }
  });

  router.delete("/memories/user/:userId", (req, res) => {
    try {
      const userId = req.params.userId?.trim();
      if (!userId) {
        res.status(400).json({ error: "userId is required" });
        return;
      }
      const deleted = clearUserFactsForUser(userId);
      res.json({ ok: true, deleted });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to clear user memory",
      });
    }
  });

  router.get("/group-memories", (_req, res) => {
    try {
      const facts = listAllGroupFacts();
      res.json({ facts, total: facts.length });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to load group memories",
      });
    }
  });

  router.post("/group-memories", (req, res) => {
    try {
      const groupId = normalizeEntityId(
        (req.body as { groupId?: string })?.groupId,
      );
      const fact = normalizeFactText((req.body as { fact?: string })?.fact);
      if (!groupId) {
        res.status(400).json({ error: "groupId is required" });
        return;
      }
      if (!fact) {
        res.status(400).json({
          error: `fact must be ${MIN_FACT_LENGTH}–${MAX_FACT_LENGTH} characters`,
        });
        return;
      }
      const created = createGroupFact(groupId, fact);
      if (!created) {
        res.status(400).json({ error: "Could not create memory" });
        return;
      }
      res.status(201).json({ fact: created });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to create group memory",
      });
    }
  });

  router.patch("/group-memories/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Invalid memory id" });
        return;
      }
      const fact = normalizeFactText((req.body as { fact?: string })?.fact);
      if (!fact) {
        res.status(400).json({
          error: `fact must be ${MIN_FACT_LENGTH}–${MAX_FACT_LENGTH} characters`,
        });
        return;
      }
      const updated = updateGroupFactById(id, fact);
      if (updated === "duplicate") {
        res
          .status(409)
          .json({ error: "That fact already exists for this group" });
        return;
      }
      if (!updated) {
        res.status(404).json({ error: "Memory not found" });
        return;
      }
      res.json({ fact: updated });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to update group memory",
      });
    }
  });

  router.delete("/group-memories/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Invalid memory id" });
        return;
      }
      if (!deleteGroupFactById(id)) {
        res.status(404).json({ error: "Memory not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to delete group memory",
      });
    }
  });

  router.delete("/group-memories/group/:groupId", (req, res) => {
    try {
      const groupId = req.params.groupId?.trim();
      if (!groupId) {
        res.status(400).json({ error: "groupId is required" });
        return;
      }
      const deleted = clearGroupFactsForGroup(groupId);
      res.json({ ok: true, deleted });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to clear group memory",
      });
    }
  });

  router.get("/general-memories", (_req, res) => {
    try {
      const facts = listGeneralFacts();
      res.json({ facts, total: facts.length });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to load general memories",
      });
    }
  });

  router.post("/general-memories", (req, res) => {
    try {
      const fact = normalizeFactText((req.body as { fact?: string })?.fact);
      if (!fact) {
        res.status(400).json({
          error: `fact must be ${MIN_FACT_LENGTH}–${MAX_FACT_LENGTH} characters`,
        });
        return;
      }
      const created = createGeneralFact(fact);
      if (!created) {
        res.status(400).json({ error: "Could not create memory" });
        return;
      }
      res.status(201).json({ fact: created });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to create general memory",
      });
    }
  });

  router.patch("/general-memories/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Invalid memory id" });
        return;
      }
      const fact = normalizeFactText((req.body as { fact?: string })?.fact);
      if (!fact) {
        res.status(400).json({
          error: `fact must be ${MIN_FACT_LENGTH}–${MAX_FACT_LENGTH} characters`,
        });
        return;
      }
      const updated = updateGeneralFactById(id, fact);
      if (updated === "duplicate") {
        res.status(409).json({ error: "That fact already exists" });
        return;
      }
      if (!updated) {
        res.status(404).json({ error: "Memory not found" });
        return;
      }
      res.json({ fact: updated });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to update general memory",
      });
    }
  });

  router.delete("/general-memories", (_req, res) => {
    try {
      const deleted = clearAllGeneralFacts();
      res.json({ ok: true, deleted });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to clear general memories",
      });
    }
  });

  router.delete("/general-memories/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Invalid memory id" });
        return;
      }
      if (!deleteGeneralFactById(id)) {
        res.status(404).json({ error: "Memory not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to delete general memory",
      });
    }
  });

  router.get("/data", (_req, res) => {
    try {
      res.json({ tables: listDataTables() });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to list data tables",
      });
    }
  });

  router.get("/data/:tableId", (req, res) => {
    try {
      const table = getDataTable(req.params.tableId);
      if (!table) {
        res.status(404).json({ error: "Unknown table" });
        return;
      }
      res.json(table);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to load table data",
      });
    }
  });

  router.delete("/errors", (_req, res) => {
    try {
      const deleted = clearErrors();
      res.json({ ok: true, deleted });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to clear errors",
      });
    }
  });

  router.get("/stats", (_req, res) => {
    try {
      const stats = getStats();
      let botRunning = false;
      try {
        getBot();
        botRunning = true;
      } catch {
        botRunning = false;
      }

      res.json({
        ...stats,
        botUsername: getBotUsername() || null,
        botRunning,
        uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
        startedAt: startedAt.toISOString(),
        recentErrors: listRecentErrors(20),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to load stats",
      });
    }
  });

  router.use((_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  return router;
}
