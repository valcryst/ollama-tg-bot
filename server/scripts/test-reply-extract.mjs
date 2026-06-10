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
