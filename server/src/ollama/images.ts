import sharp from "sharp";
import { getSettings } from "../db/database.js";

const MAX_BYTES = 900_000;

/** Strip data-URI prefix and whitespace from base64. */
function parseBase64(input: string): Buffer {
  const trimmed = input.trim().replace(/\s/g, "");
  const raw = trimmed.includes(",")
    ? trimmed.slice(trimmed.indexOf(",") + 1)
    : trimmed;

  const buf = Buffer.from(raw, "base64");
  if (buf.length < 16) {
    throw new Error("Image data is too small or corrupt");
  }
  return buf;
}

/**
 * Convert any Telegram image (WebP stickers, JPEG photos, etc.) to JPEG
 * so Ollama vision backends accept it reliably.
 */
function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export async function normalizeImageForOllama(base64: string): Promise<string> {
  const buf = parseBase64(base64);
  const maxDim = getSettings().visionMaxDimension;

  if (isJpeg(buf) && buf.length <= MAX_BYTES) {
    const meta = await sharp(buf).metadata();
    if (
      (meta.width ?? 0) <= maxDim &&
      (meta.height ?? 0) <= maxDim
    ) {
      return buf.toString("base64");
    }
  }

  const pipeline = sharp(buf, { failOn: "error" })
    .rotate()
    .resize(maxDim, maxDim, {
      fit: "inside",
      withoutEnlargement: true,
    });

  let output = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();

  if (output.length > MAX_BYTES) {
    output = await sharp(output)
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
  }

  if (output.length > MAX_BYTES) {
    throw new Error("Image is too large after compression");
  }

  return output.toString("base64");
}
