import type { Sticker } from "@grammyjs/types";
import { downloadTelegramFile, type ImagePayload } from "./files.js";

export type StickerVisionResult = {
  payload: ImagePayload;
  /** Extra context for the vision model when the image is only a preview frame. */
  visionHint?: string;
};

export async function loadStickerForVision(
  token: string,
  sticker: Sticker,
): Promise<StickerVisionResult | null> {
  if (sticker.is_animated || sticker.is_video) {
    const thumbId = sticker.thumbnail?.file_id;
    if (!thumbId) return null;

    const payload = await downloadTelegramFile(token, thumbId);
    if (!payload) return null;

    return {
      payload,
      visionHint: sticker.is_video
        ? "The user sent a video sticker. This image is a still preview frame from it."
        : "The user sent an animated sticker. This image is a still preview frame from it.",
    };
  }

  const payload = await downloadTelegramFile(token, sticker.file_id);
  if (!payload) return null;
  return { payload };
}

export function stickerUnavailableText(sticker: Sticker): string {
  if ((sticker.is_animated || sticker.is_video) && !sticker.thumbnail) {
    return "This animated sticker has no preview image available.";
  }
  if (sticker.is_animated) {
    return "Could not load the preview for this animated sticker.";
  }
  if (sticker.is_video) {
    return "Could not load the preview for this video sticker.";
  }
  return "Could not download this sticker.";
}
