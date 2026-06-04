import type { Sticker } from "@grammyjs/types";
import { downloadTelegramFile, type ImagePayload } from "./files.js";

export type StickerVisionResult = {
  payload: ImagePayload;
  /** Extra context for the vision model when the image is only a preview frame. */
  visionHint?: string;
};

function stickerEmoji(sticker: Sticker): string | null {
  const emoji = sticker.emoji?.trim();
  return emoji || null;
}

/** Short label for chat history and reply summaries. */
export function stickerHistoryLabel(sticker: Sticker): string {
  const emoji = stickerEmoji(sticker);
  return emoji ? `[sticker ${emoji}]` : "[sticker]";
}

/** Tells the model which emoji Telegram attached to this sticker pack entry. */
export function stickerEmojiContext(sticker: Sticker): string | null {
  const emoji = stickerEmoji(sticker);
  if (!emoji) return null;
  return (
    `This Telegram sticker is associated with the emoji ${emoji}. ` +
    `Use that emoji as part of what the user communicated (tone, reaction, or meaning).`
  );
}

function buildVisionHint(sticker: Sticker, frameHint?: string): string | undefined {
  const parts = [stickerEmojiContext(sticker), frameHint].filter(
    (p): p is string => Boolean(p),
  );
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export async function loadStickerForVision(
  token: string,
  sticker: Sticker,
): Promise<StickerVisionResult | null> {
  if (sticker.is_animated || sticker.is_video) {
    const thumbId = sticker.thumbnail?.file_id;
    if (!thumbId) return null;

    const payload = await downloadTelegramFile(token, thumbId);
    if (!payload) return null;

    const frameHint = sticker.is_video
      ? "The user sent a video sticker. This image is a still preview frame from it."
      : "The user sent an animated sticker. This image is a still preview frame from it.";

    return {
      payload,
      visionHint: buildVisionHint(sticker, frameHint),
    };
  }

  const payload = await downloadTelegramFile(token, sticker.file_id);
  if (!payload) return null;
  return {
    payload,
    visionHint: buildVisionHint(sticker),
  };
}

/** User message text when the turn is a sticker (optionally with caption). */
export function stickerUserPrompt(
  sticker: Sticker,
  caption: string,
  visionHint?: string,
): string {
  const emoji = stickerEmoji(sticker);
  const intro = emoji
    ? `The user sent a Telegram sticker (${emoji}).`
    : "The user sent a Telegram sticker.";

  const parts: string[] = [];
  if (caption) parts.push(caption);
  parts.push(intro);
  if (visionHint) parts.push(visionHint);
  else if (!caption) {
    parts.push(
      emoji
        ? "Describe what you see in the sticker and how the emoji fits what they meant."
        : "Describe what you see in this sticker.",
    );
  }

  return parts.join("\n\n");
}

export function stickerUnavailableText(sticker: Sticker): string {
  const emoji = stickerEmoji(sticker);
  const suffix = emoji ? ` (${emoji})` : "";

  if ((sticker.is_animated || sticker.is_video) && !sticker.thumbnail) {
    return `This animated sticker has no preview image available${suffix}.`;
  }
  if (sticker.is_animated) {
    return `Could not load the preview for this animated sticker${suffix}.`;
  }
  if (sticker.is_video) {
    return `Could not load the preview for this video sticker${suffix}.`;
  }
  return `Could not download this sticker${suffix}.`;
}
