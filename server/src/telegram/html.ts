import { sanitizeModelOutput } from "../ollama/sanitize.js";

const PAIRED_TAGS = new Set([
  "b",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "tg-spoiler",
  "a",
]);

/** Prepare model output for Telegram parse_mode HTML. */
export function prepareTelegramHtml(text: string): string {
  let s = sanitizeModelOutput(text);
  s = markdownBoldToHtml(s);

  s = s.replace(/<\/?(?:p|div|ul|ol|li|h[1-6]|section|article)\b[^>]*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/?spoilers?>/gi, (tag) =>
    tag.startsWith("</") ? "</tg-spoiler>" : "<tg-spoiler>",
  );

  s = balanceTelegramHtml(s);

  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** Plain text visible to the user after Telegram HTML tags/entities are removed. */
export function visibleTelegramText(text: string): string {
  const prepared = prepareTelegramHtml(text);
  if (!prepared) return "";

  return prepared
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();
}

/** False for empty replies and HTML shells with no visible text (e.g. `<b></b>`). */
export function hasVisibleTelegramReply(text: string): boolean {
  return visibleTelegramText(text).length > 0;
}

/** Models often use **bold** despite being told to use HTML. */
function markdownBoldToHtml(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>");
}

function balanceTelegramHtml(text: string): string {
  const parts = text.split(/(<[^>]+>)/g);
  const stack: string[] = [];
  const out: string[] = [];

  for (const part of parts) {
    if (!part) continue;

    if (!part.startsWith("<")) {
      out.push(part);
      continue;
    }

    const normalized = normalizeTelegramTag(part);
    if (!normalized) continue;

    if (normalized.startsWith("</")) {
      const name = tagNameFromNormalized(normalized);
      if (!name) continue;
      const idx = stack.lastIndexOf(name);
      if (idx === -1) continue;
      while (stack.length > idx + 1) {
        out.push(`</${stack.pop()!}>`);
      }
      stack.pop();
      out.push(normalized);
      continue;
    }

    const name = tagNameFromNormalized(normalized);
    if (name && PAIRED_TAGS.has(name)) {
      stack.push(name);
      out.push(normalized);
    }
  }

  while (stack.length > 0) {
    const name = stack.pop()!;
    out.push(`</${name}>`);
  }

  return out.join("");
}

function tagNameFromNormalized(tag: string): string | null {
  const match = tag.match(/^<\/?([a-z][a-z0-9-]*)\b/i);
  return match?.[1].toLowerCase() ?? null;
}

function normalizeTelegramTag(raw: string): string | null {
  const tag = raw.trim();

  const linkOpen = tag.match(/^<a\s+href="([^"]*)"\s*>$/i);
  if (linkOpen) return `<a href="${linkOpen[1]}">`;
  if (/^<\/a>$/i.test(tag)) return "</a>";

  const preOpen = tag.match(/^<pre>\s*<code(?:\s+class="language-([\w-]+)")?\s*>$/i);
  if (preOpen) {
    const lang = preOpen[1];
    return lang
      ? `<pre><code class="language-${lang}">`
      : "<pre><code>";
  }
  if (/^<\/code>\s*<\/pre>$/i.test(tag)) return "</code></pre>";
  if (/^<\/code>$/i.test(tag)) return "</code>";

  const blockquoteOpen = tag.match(/^<blockquote(?:\s+expandable)?\s*>$/i);
  if (blockquoteOpen) {
    return tag.toLowerCase().includes("expandable")
      ? "<blockquote expandable>"
      : "<blockquote>";
  }
  if (/^<\/blockquote>$/i.test(tag)) return "</blockquote>";

  const spoilerOpen = tag.match(
    /^<span\s+class=(?:"tg-spoiler"|'tg-spoiler'|tg-spoiler)\s*>$/i,
  );
  if (spoilerOpen) return "<tg-spoiler>";
  if (/^<\/span>$/i.test(tag)) return "</tg-spoiler>";

  const generic = tag.match(/^<\s*(\/?)\s*([a-z][a-z0-9-]*)\b[^>]*>$/i);
  if (!generic) return null;

  const closing = generic[1] === "/";
  const name = canonicalTagName(generic[2]);
  if (!name) return null;

  return closing ? `</${name}>` : `<${name}>`;
}

function canonicalTagName(name: string): string | null {
  const n = name.toLowerCase();
  if (n === "strong") return "b";
  if (n === "em") return "i";
  if (n === "ins") return "u";
  if (n === "strike" || n === "del") return "s";
  if (n === "tg_spoiler") return "tg-spoiler";
  if (
    n === "b" ||
    n === "i" ||
    n === "u" ||
    n === "s" ||
    n === "code" ||
    n === "pre" ||
    n === "blockquote" ||
    n === "tg-spoiler"
  ) {
    return n;
  }
  return null;
}
