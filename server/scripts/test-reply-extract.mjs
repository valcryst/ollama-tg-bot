import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "..", "dist");
if (!existsSync(distDir)) {
  console.error(
    "dist/ directory not found. Run `npm run build -w server` first.\n" +
    `Expected: ${distDir}`,
  );
  process.exit(1);
}

import { extractTelegramReply } from "../dist/response-format.js";

const cases = [
  {
    name: "closed block",
    in: "[REPLY]hello[/REPLY]",
    want: "hello",
  },
  {
    name: "unclosed block",
    in: "[REPLY]\nпривет",
    want: "привет",
  },
  {
    name: "unclosed with sticker tail",
    in: "[REPLY]\n<b>Hi</b>\n[sticker: * Analyze the user",
    want: "<b>Hi</b>",
  },
  {
    name: "assistant said echo with trailing REPLY tag",
    in: "[assistant said] Hey! How can I help you today? [REPLY]",
    want: "Hey! How can I help you today?",
  },
  {
    name: "empty closed block",
    in: "[REPLY][/REPLY]",
    want: "",
  },
  {
    name: "first closed block wins (not last)",
    in: "[REPLY]one[/REPLY] [REPLY]two[/REPLY]",
    want: "one",
  },
  {
    name: "text before and after REPLY block",
    in: "before [REPLY]inside[/REPLY] after",
    want: "inside",
  },
  {
    name: "plain text without REPLY tag falls through",
    in: "just some random text",
    want: "just some random text",
  },
  {
    name: "whitespace-only closed block",
    in: "[REPLY]   \n [/REPLY]",
    want: "",
  },
  {
    name: "multi-line closed block",
    in: "[REPLY]\nline one\nline two\n[/REPLY]",
    want: "line one\nline two",
  },
];

let fail = 0;
for (const c of cases) {
  const got = extractTelegramReply(c.in);
  if (got !== c.want) {
    fail++;
    console.log("FAIL", c.name, "got:", JSON.stringify(got), "want:", JSON.stringify(c.want));
  }
}
console.log(fail ? `${fail} unit failures` : "unit tests ok");
process.exit(fail ? 1 : 0);
