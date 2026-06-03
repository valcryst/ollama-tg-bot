import { Bot } from "grammy";
import { requireBotToken } from "../config.js";
import { registerHandlers } from "./handlers.js";

let botInstance: Bot | null = null;
let botUsername = "";

export function getBot(): Bot {
  if (!botInstance) throw new Error("Bot not initialized");
  return botInstance;
}

export function getBotUsername(): string {
  return botUsername;
}

export async function startBot(): Promise<Bot> {
  const token = requireBotToken();
  const bot = new Bot(token);
  botInstance = bot;

  const me = await bot.api.getMe();
  botUsername = me.username ?? `bot${me.id}`;

  registerHandlers(bot, botUsername);

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  void bot.start({
    onStart: () => {
      console.log(`Bot @${botUsername} is running`);
      console.log(
        "Groups: @mention the bot, reply to its messages, or use /cmd@botname. " +
          "If @mentions are ignored, send /setprivacy to @BotFather and choose Disable.",
      );
    },
  });

  return bot;
}

export async function stopBot(): Promise<void> {
  if (botInstance) {
    await botInstance.stop();
    botInstance = null;
  }
}
