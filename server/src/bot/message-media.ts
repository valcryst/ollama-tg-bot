import type { Message, Sticker } from "@grammyjs/types";
import { downloadTelegramFile, type ImagePayload } from "./files.js";
import {
  loadStickerForVision,
  stickerUnavailableText,
} from "./stickers.js";

export interface LoadedVisionMedia {
  images: ImagePayload[];
  /** Present when vision input came from a sticker message. */
  sourceSticker?: Sticker;
  visionHint?: string;
  /** Set when a sticker could not be loaded for vision. */
  unavailableText?: string;
}

/** Download photo, image document, or sticker from a Telegram message for model API vision. */
export async function loadVisionFromMessage(
  token: string,
  message: Message,
): Promise<LoadedVisionMedia> {
  if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];
    const img = await downloadTelegramFile(token, photo.file_id);
    return { images: img ? [img] : [] };
  }

  if (message.sticker) {
    const loaded = await loadStickerForVision(token, message.sticker);
    if (!loaded) {
      return {
        images: [],
        unavailableText: stickerUnavailableText(message.sticker),
      };
    }
    return {
      images: [loaded.payload],
      sourceSticker: message.sticker,
      visionHint: loaded.visionHint,
    };
  }

  if (message.document?.mime_type?.startsWith("image/")) {
    const img = await downloadTelegramFile(token, message.document.file_id);
    return { images: img ? [img] : [] };
  }

  return { images: [] };
}

/** First message in a reply chain (up to depth) that carries vision-capable media. */
export function findReplyMediaMessage(
  message: Message,
  maxDepth = 4,
): Message | null {
  let current: Message | undefined = message.reply_to_message;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (messageHasVisionMedia(current)) return current;
    current = current.reply_to_message;
    depth++;
  }

  return null;
}

export function messageHasVisionMedia(message: Message): boolean {
  if (message.photo?.length) return true;
  if (message.sticker) return true;
  if (message.document?.mime_type?.startsWith("image/")) return true;
  return false;
}

/** Photo or image file in the message itself (not stickers). */
export function messageHasUserImage(message: Message): boolean {
  if (message.photo?.length) return true;
  if (message.document?.mime_type?.startsWith("image/")) return true;
  return false;
}
