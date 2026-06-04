import type { Sticker } from "@grammyjs/types";
import {
  downloadTelegramFile,
  getTelegramFilePath,
  isRasterImagePath,
  type ImagePayload,
} from "./files.js";

export type StickerVisionResult = {
  payload: ImagePayload;
  /** Extra context for the vision model when the image is only a preview frame. */
  visionHint?: string;
};

const STICKER_VISION_INSTRUCTION =
  "The sticker artwork is attached as an image. Base your answer on what you see in that image " +
  "(characters, scene, text, colors, mood). The pack emoji is only supplementary tone — do not " +
  "reply from the emoji alone when you can see the sticker.";

function stickerEmoji(sticker: Sticker): string | null {
  const emoji = sticker.emoji?.trim();
  return emoji || null;
}

/** Short label for chat history and reply summaries. */
export function stickerHistoryLabel(sticker: Sticker): string {
  const emoji = stickerEmoji(sticker);
  return emoji
    ? `[sticker image was sent, pack emoji: ${emoji}]`
    : "[sticker image was sent]";
}

/** Pack emoji context — secondary to the attached artwork. */
export function stickerEmojiContext(sticker: Sticker): string | null {
  const emoji = stickerEmoji(sticker);
  if (!emoji) return null;
  return (
    `Telegram maps this sticker to ${emoji} in its pack. ` +
    `Use that only as extra tone after you interpret the artwork.`
  );
}

function buildVisionHint(sticker: Sticker, frameHint?: string): string | undefined {
  const parts = [frameHint, stickerEmojiContext(sticker)].filter(
    (p): p is string => Boolean(p),
  );
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

async function downloadRasterByFileId(
  token: string,
  fileId: string,
): Promise<ImagePayload | null> {
  const path = await getTelegramFilePath(token, fileId);
  if (!path || !isRasterImagePath(path)) return null;
  return downloadTelegramFile(token, fileId);
}

export async function loadStickerForVision(
  token: string,
  sticker: Sticker,
): Promise<StickerVisionResult | null> {
  if (sticker.is_animated || sticker.is_video) {
    const thumbId = sticker.thumbnail?.file_id;
    if (thumbId) {
      const payload = await downloadTelegramFile(token, thumbId);
      if (payload) {
        const frameHint = sticker.is_video
          ? "This image is a still preview frame from the user's video sticker."
          : "This image is a still preview frame from the user's animated sticker.";
        return {
          payload,
          visionHint: buildVisionHint(sticker, frameHint),
        };
      }
    }

    const fallback = await downloadRasterByFileId(token, sticker.file_id);
    if (fallback) {
      return {
        payload: fallback,
        visionHint: buildVisionHint(
          sticker,
          "This is a static preview of the sticker.",
        ),
      };
    }

    return null;
  }

  const payload = await downloadRasterByFileId(token, sticker.file_id);
  if (!payload) return null;
  return {
    payload,
    visionHint: buildVisionHint(sticker),
  };
}

/** User message text when the turn includes a sticker image for vision. */
export function stickerUserPrompt(
  sticker: Sticker,
  caption: string,
  visionHint?: string,
): string {
  const parts: string[] = [];
  if (caption) parts.push(caption);
  parts.push("The user sent a Telegram sticker. The sticker image is attached.");
  parts.push(STICKER_VISION_INSTRUCTION);
  if (visionHint) parts.push(visionHint);
  return parts.join("\n\n");
}

export function stickerUnavailableText(sticker: Sticker): string {
  const emoji = stickerEmoji(sticker);
  const suffix = emoji ? ` (${emoji})` : "";

  if ((sticker.is_animated || sticker.is_video) && !sticker.thumbnail) {
    return (
      `This animated sticker has no preview image available${suffix}. ` +
      `Try a static sticker or send a screenshot.`
    );
  }
  if (sticker.is_animated) {
    return `Could not load the preview for this animated sticker${suffix}.`;
  }
  if (sticker.is_video) {
    return `Could not load the preview for this video sticker${suffix}.`;
  }
  return `Could not download this sticker image${suffix}.`;
}
