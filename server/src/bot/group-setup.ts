export function groupSetupMessage(botUsername: string): string {
  const bot = `@${botUsername}`;
  return (
    `<b>Added to this group</b>\n\n` +
    `Telegram shows bots as <i>has no access to messages</i> until privacy is configured — that is normal.\n\n` +
    `<b>To talk to me here:</b>\n` +
    `• ${bot} + your message\n` +
    `• Reply to one of my messages\n` +
    `• <code>/start@${botUsername}</code> (not just /start)\n\n` +
    `<b>If I never respond:</b>\n` +
    `1. Open @BotFather → <code>/setprivacy</code> → <b>Disable</b>\n` +
    `2. Remove me from the group and add again\n\n` +
    `I remember facts about this group across sessions. The bot owner can clear them with <code>/forgetgroup@${botUsername}</code>.\n\n` +
    `Private chat: open ${bot} and send anything.`
  );
}

export function wasBotAddedToChat(
  oldStatus: string,
  newStatus: string,
): boolean {
  const absent = oldStatus === "left" || oldStatus === "kicked";
  const present = newStatus === "member" || newStatus === "administrator";
  return absent && present;
}
