const baseUrl = process.env.LLM_BASE_URL?.trim();
const model = process.env.LLM_MODEL?.trim();
if (!baseUrl) {
  console.error("Missing required env var: LLM_BASE_URL");
  process.exit(1);
}
if (!model) {
  console.error("Missing required env var: LLM_MODEL");
  process.exit(1);
}

const { default: OpenAI } = await import("openai");
const { buildBaseSystemPrompt } = await import("../dist/prompts.js");
const { extractTelegramReply } = await import("../dist/response-format.js");
const { localAiChatExtensions } = await import("../dist/llm/openai-compat.js");

/** Fixed test harness settings (not env). */
const settings = {
  numCtx: 8192,
  topK: 40,
  repeatPenalty: 1.1,
  temperature: 0.7,
  topP: 0.9,
  numPredict: 512,
  thinkingEnabled: false,
};

const client = new OpenAI({
  apiKey: (process.env.OPENAI_API_KEY ?? "").trim() || "not-needed",
  baseURL: baseUrl,
  maxRetries: 0,
});

function parseMessage(choice) {
  const msg = choice?.message ?? {};
  const content =
    typeof msg.content === "string" ? msg.content.trim() : "";
  const reasoning = (
    msg.reasoning_content ??
    msg.reasoning ??
    ""
  ).trim();
  return { content, reasoning };
}

async function oneTurn(userText, history = []) {
  const system = buildBaseSystemPrompt(settings);
  const ext = localAiChatExtensions(settings, false);
  const r = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: system },
        ...history,
        { role: "user", content: `[user:georg:123 said] ${userText}` },
      ],
      max_completion_tokens: settings.numPredict,
      temperature: settings.temperature,
      top_p: settings.topP,
      ...ext,
    },
    { timeout: 120_000 },
  );
  const { content, reasoning } = parseMessage(r.choices[0]);
  const reply = extractTelegramReply(content);
  return { content, reasoning, reply, ok: Boolean(reply.trim()) };
}

const prompts = ["аллоха", "привіт", "даров", "здаров", "hello"];
let pass = 0;
let fail = 0;
const failures = [];

const history = Array.from({ length: 6 }, (_, i) => [
  { role: "user", content: `[user:georg:123 said] msg${i}` },
  {
    role: "assistant",
    content: `[assistant said] [REPLY]reply ${i}[/REPLY]`,
  },
]).flat();

for (let run = 0; run < 10; run++) {
  for (const p of prompts) {
    try {
      const r = await oneTurn(p, history);
      if (r.ok) {
        pass++;
      } else {
        fail++;
        failures.push({
          prompt: p,
          contentHead: r.content.slice(0, 120),
          reasoningHead: r.reasoning.slice(0, 120),
        });
      }
    } catch (e) {
      fail++;
      failures.push({ prompt: p, error: String(e) });
    }
  }
}

console.log(`Results: ${pass} pass, ${fail} fail`);
if (failures.length) {
  console.log("Failures sample:");
  console.log(JSON.stringify(failures.slice(0, 5), null, 2));
}
process.exit(fail > 0 ? 1 : 0);
