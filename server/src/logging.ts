import { config } from "./config.js";

export type LoggingLevel = "ERROR" | "DEBUG" | "VERBOSE";

export function getLoggingLevel(): LoggingLevel {
  return config.loggingLevel;
}

export function isDebugLogging(): boolean {
  return config.loggingLevel === "DEBUG" || config.loggingLevel === "VERBOSE";
}

export function isVerboseLogging(): boolean {
  return config.loggingLevel === "VERBOSE";
}

/** Non-error operational messages (startup, shutdown). */
export function logInfo(message: string): void {
  if (isDebugLogging()) console.log(message);
}

function sectionLine(kind: "BEGIN" | "END", part: "REQUEST" | "ANSWER", label: string): string {
  return `---- ${kind} ${part} ${label} ----`;
}

/** VERBOSE: labeled request block (messages sent to the LLM). */
export function logModelRequestBlock(label: string, body: string): void {
  if (!isVerboseLogging()) return;
  console.log(sectionLine("BEGIN", "REQUEST", label));
  console.log(body);
  console.log(sectionLine("END", "REQUEST", label));
  console.log("");
}

/** VERBOSE: labeled answer block (response from the LLM). */
export function logModelAnswerBlock(label: string, body: string): void {
  if (!isVerboseLogging()) return;
  console.log(sectionLine("BEGIN", "ANSWER", label));
  console.log(body);
  console.log(sectionLine("END", "ANSWER", label));
  console.log("");
}
