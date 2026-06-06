import type { Api } from "grammy";
import type { Sticker } from "@grammyjs/types";
import { getSettings } from "../db/database.js";
import { logEvent, logEventError } from "../event-log.js";

export interface CatalogSticker {
  index: number;
  /** Emoji assigned to this sticker in the pack (from Telegram). */
  emoji: string;
  fileId: string;
  previewFileId: string;
}

interface StickerCatalogState {
  packName: string;
  stickers: CatalogSticker[];
  loadedAt: string;
}

let catalog: StickerCatalogState | null = null;
let lastError: string | null = null;

function normalizePackName(name: string): string {
  return name.trim().replace(/^@/, "");
}

function readStickerEmoji(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  return trimmed || "—";
}

function previewFileId(sticker: Sticker): string {
  return sticker.thumbnail?.file_id ?? sticker.file_id;
}

function normalizeEmojiMatch(value: string): string {
  return value.normalize("NFC").trim().replace(/\uFE0F/g, "");
}

function emojisMatch(a: string, b: string): boolean {
  const left = normalizeEmojiMatch(a);
  const right = normalizeEmojiMatch(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

export function stickerPromptLabel(index: number): string {
  const sticker = catalog?.stickers.find((s) => s.index === index);
  if (sticker?.emoji && sticker.emoji !== "—") return sticker.emoji;
  return String(index + 1);
}

export function getStickerCatalogState(): {
  packName: string;
  stickers: Pick<CatalogSticker, "index" | "emoji">[];
  loaded: boolean;
  error: string | null;
} {
  return {
    packName: catalog?.packName ?? "",
    stickers: (catalog?.stickers ?? []).map((s) => ({
      index: s.index,
      emoji: s.emoji,
    })),
    loaded: catalog != null && catalog.stickers.length > 0,
    error: lastError,
  };
}

export function getStickerPreviewFileId(index: number): string | null {
  const sticker = catalog?.stickers.find((s) => s.index === index);
  return sticker?.previewFileId ?? null;
}

export function clearStickerCatalog(): void {
  catalog = null;
  lastError = null;
}

export async function refreshStickerCatalog(
  api: Api,
  packName: string,
): Promise<{ ok: boolean; count: number; error?: string }> {
  const normalized = normalizePackName(packName);
  if (!normalized) {
    clearStickerCatalog();
    lastError = "Sticker pack name is empty";
    return { ok: false, count: 0, error: lastError };
  }

  try {
    const set = await api.getStickerSet(normalized);

    const stickers = set.stickers.map((sticker, index) => ({
      index,
      emoji: readStickerEmoji(sticker.emoji),
      fileId: sticker.file_id,
      previewFileId: previewFileId(sticker),
    }));

    if (stickers.length === 0) {
      catalog = null;
      lastError = "Sticker set is empty";
      logEvent("sticker_catalog_empty", { packName: normalized });
      return { ok: false, count: 0, error: lastError };
    }

    catalog = {
      packName: normalized,
      stickers,
      loadedAt: new Date().toISOString(),
    };
    lastError = null;
    logEvent("sticker_catalog_loaded", {
      packName: normalized,
      count: stickers.length,
    });
    return { ok: true, count: stickers.length };
  } catch (err) {
    catalog = null;
    lastError =
      err instanceof Error ? err.message : "Failed to load sticker set";
    logEventError("sticker_catalog_failed", err, { packName: normalized });
    return { ok: false, count: 0, error: lastError };
  }
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

export function resolveStickerFileId(raw: string): string | null {
  if (!catalog || catalog.stickers.length === 0) return null;
  const input = raw.trim();
  if (!input) return null;

  const indexMatch = input.match(/^#?(\d+)$/);
  if (indexMatch) {
    const n = Number(indexMatch[1]);
    if (Number.isInteger(n) && n >= 1 && n <= catalog.stickers.length) {
      return catalog.stickers[n - 1]!.fileId;
    }
    if (Number.isInteger(n) && n >= 0 && n < catalog.stickers.length) {
      return catalog.stickers[n]!.fileId;
    }
  }

  const byEmoji = catalog.stickers.filter((s) => emojisMatch(s.emoji, input));
  if (byEmoji.length === 1) return byEmoji[0]!.fileId;
  if (byEmoji.length > 1) return pickRandom(byEmoji)?.fileId ?? null;

  return null;
}

export function formatStickersForPrompt(): string | null {
  if (!catalog || catalog.stickers.length === 0) return null;
  const lines = catalog.stickers.map(
    (s) => `${s.index + 1}: ${stickerPromptLabel(s.index)}`,
  );
  return (
    `You may send Telegram stickers from pack "${catalog.packName}". ` +
    `Put [STICKER] after [/REPLY], never inside [REPLY]:\n\n` +
    `[REPLY]\n...\n[/REPLY]\n[STICKER]\n<emoji or number>\n[/STICKER]\n\n` +
    `Available stickers (number: pack emoji):\n${lines.join("\n")}\n\n` +
    `Use the pack emoji exactly, or the sticker number (1–${catalog.stickers.length}). ` +
    `[REPLY] may be empty when you only send a sticker. Omit [STICKER] when none fits.`
  );
}

export async function syncStickerCatalogFromSettings(
  api: Api,
): Promise<{ ok: boolean; count: number; error?: string }> {
  const settings = getSettings();
  if (!settings.stickersEnabled || !settings.stickerPackName.trim()) {
    clearStickerCatalog();
    return { ok: true, count: 0 };
  }
  return refreshStickerCatalog(api, settings.stickerPackName);
}
