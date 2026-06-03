const TELEGRAM_FILE = "https://api.telegram.org/file/bot";

export type ImagePayload = { base64: string; mimeHint: string };

export async function downloadTelegramFile(
  token: string,
  fileId: string,
): Promise<ImagePayload | null> {
  const file = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`,
  ).then((r) => r.json()) as { ok: boolean; result?: { file_path: string } };

  if (!file.ok || !file.result?.file_path) return null;

  const url = `${TELEGRAM_FILE}${token}/${file.result.file_path}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = file.result.file_path.split(".").pop()?.toLowerCase() ?? "jpg";
  const mimeHint =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : "image/jpeg";

  return { base64: buffer.toString("base64"), mimeHint };
}
