import { isIP } from "node:net";

/** http(s) URLs in plain text (Telegram bodies and reply context). */
const URL_PATTERN = /https?:\/\/[^\s<>"')\]}]+/gi;

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)]+$/u, "");
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIp(host: string): boolean {
  const kind = isIP(host);
  if (kind === 4) {
    const octets = host.split(".").map((n) => Number.parseInt(n, 10));
    if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
    return isPrivateIpv4(octets);
  }
  if (kind === 6) {
    const h = host.toLowerCase();
    if (h === "::1") return true;
    if (h.startsWith("fc") || h.startsWith("fd")) return true;
    if (h.startsWith("fe80:")) return true;
  }
  return false;
}

/** Block SSRF targets (localhost, docker host gateway, private IPs). */
export function isSafePublicUrl(urlStr: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;

  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "host.docker.internal") return false;

  if (isIP(host)) {
    return !isPrivateIp(host);
  }

  return true;
}

function normalizeUrl(raw: string): string | null {
  const trimmed = trimTrailingPunctuation(raw.trim());
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/** Unique safe http(s) URLs from one or more text blobs. */
export function extractUrls(
  ...texts: (string | null | undefined)[]
): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const text of texts) {
    if (!text?.trim()) continue;
    for (const match of text.matchAll(URL_PATTERN)) {
      const normalized = normalizeUrl(match[0]);
      if (!normalized || !isSafePublicUrl(normalized)) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
    }
  }

  return urls;
}
