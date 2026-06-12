import { config } from "./config.js";

export type LoggingLevel = "ERROR" | "DEBUG";

export function getLoggingLevel(): LoggingLevel {
  return config.loggingLevel;
}

export function isDebugLogging(): boolean {
  return config.loggingLevel === "DEBUG";
}

/** Non-error operational messages (startup, shutdown). */
export function logInfo(message: string): void {
  if (isDebugLogging()) console.log(message);
}
