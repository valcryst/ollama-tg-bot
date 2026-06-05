import { Bot } from "grammy";
import { requireBotToken } from "../config.js";
import { logInfo } from "../logging.js";
import { setBotIdentity } from "./bot-identity.js";
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
  setBotIdentity(me, botUsername);

  registerHandlers(bot, botUsername);

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  void bot.start({
    allowed_updates: ["message", "message_reaction", "my_chat_member"],
    onStart: () => {
      logInfo(`Bot @${botUsername} is running`);
      logInfo(
        "Groups: @mention, reply, name, or react to the bot's messages. " +
          "Other messages are checked by the model for indirect address. " +
          "Emoji reactions in groups require the bot to be an admin. " +
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
