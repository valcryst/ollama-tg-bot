import { sanitizeModelOutput } from "../ollama/sanitize.js";

/** Prepare model output for Telegram parse_mode HTML. */
export function prepareTelegramHtml(text: string): string {
  let s = sanitizeModelOutput(text);

  s = s.replace(/<\/?(?:p|div|ul|ol|li|h[1-6]|section|article)\b[^>]*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/?spoilers?>/gi, (tag) =>
    tag.startsWith("</") ? "</tg-spoiler>" : "<tg-spoiler>",
  );

  s = s.replace(/<[^>]+>/g, (tag) =>
    isAllowedTelegramTag(tag) ? tag : "",
  );

  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function isAllowedTelegramTag(tag: string): boolean {
  const t = tag.trim();

  if (/^<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler)>$/i.test(t)) {
    return true;
  }
  if (/^<a\s+href="[^"]*"\s*>$/i.test(t)) return true;
  if (/^<span\s+class="tg-spoiler"\s*>$/i.test(t)) return true;
  if (/^<\/(?:a|code|span)>$/i.test(t)) return true;
  if (/^<pre><code\s+class="language-[\w-]+"\s*>$/i.test(t)) return true;
  if (/^<\/code>(?:<\/pre>)?$/i.test(t)) return true;
  if (/^<blockquote(?:\s+expandable)?>$/i.test(t)) return true;

  return false;
}
