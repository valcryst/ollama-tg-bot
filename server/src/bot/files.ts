const TELEGRAM_FILE = "https://api.telegram.org/file/bot";
const TELEGRAM_FILE_TIMEOUT_MS = 20_000;

export type ImagePayload = { base64: string; mimeHint: string };

const RASTER_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export function isRasterImagePath(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return RASTER_EXTENSIONS.has(ext);
}

export async function getTelegramFilePath(
  token: string,
  fileId: string,
): Promise<string | null> {
  const file = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`,
    { signal: AbortSignal.timeout(TELEGRAM_FILE_TIMEOUT_MS) },
  ).then((r) => r.json()) as { ok: boolean; result?: { file_path: string } };

  if (!file.ok || !file.result?.file_path) return null;
  return file.result.file_path;
}

export async function downloadTelegramFile(
  token: string,
  fileId: string,
): Promise<ImagePayload | null> {
  const filePath = await getTelegramFilePath(token, fileId);
  if (!filePath) return null;

  const url = `${TELEGRAM_FILE}${token}/${filePath}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TELEGRAM_FILE_TIMEOUT_MS),
  });
  if (!res.ok) return null;

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "jpg";
  const mimeHint =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : "image/jpeg";

  return { base64: buffer.toString("base64"), mimeHint };
}
