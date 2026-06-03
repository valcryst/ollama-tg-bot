/** Remove common model artifacts (hex byte tokens, chat template markers, etc.). */
export function sanitizeModelOutput(text: string): string {
  return text
    .replace(/(?:<0x[0-9A-Fa-f]{2}>)+/g, "")
    .replace(/<\|[^|>]*\|>/g, "")
    .replace(/<\|[^|>]*$/g, "")
    .replace(/\s*<\/s>\s*$/gi, "")
    .replace(/\[end of text\]/gi, "")
    .trim();
}
