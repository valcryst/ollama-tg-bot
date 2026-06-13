/**
 * Minimal IRC client for pymcp-ircd (RFC 2812 subset).
 *
 * Uses raw TCP via Node's `net` module. No external dependencies.
 * Handles NICK, USER, JOIN, PRIVMSG, PING/PONG, and graceful disconnect.
 */
import { createConnection, type Socket } from "node:net";
import { logInfo } from "../logging.js";

/** Parsed IRC message from the wire. */
export interface IrcMessage {
  /** Raw line without trailing CRLF. */
  raw: string;
  /** Sender prefix (nick!user@host) or empty string for server messages. */
  prefix: string;
  /** IRC command (PRIVMSG, PING, JOIN, etc.). */
  command: string;
  /** Command parameters (first is usually the target). */
  params: string[];
  /** Trailing parameter (everything after the colon). */
  trailing: string;
}

/** Parsed PRIVMSG sent to a channel. */
export interface IrcChannelMessage {
  /** Sender nickname. */
  nick: string;
  /** Target channel. */
  channel: string;
  /** Message text. */
  text: string;
}

/** Configuration for a single IRC client connection. */
export interface IrcClientConfig {
  /** IRC server host. */
  host: string;
  /** IRC server port. */
  port: number;
  /** Bot nickname. */
  nick: string;
  /** Channels to join after registration. */
  channels: string[];
}

/**
 * Parse a raw IRC line into a structured message.
 *
 * Format: `[:prefix] COMMAND [param1 [param2 ...]] [:trailing]`
 *
 * Handles pymcp-ircd's RFC 2812 §2.3.1 behaviour where single-word
 * trailing parameters omit the colon.
 */
function parseLine(line: string): IrcMessage {
  let rest = line;
  let prefix = "";

  if (rest.startsWith(":")) {
    const spaceIdx = rest.indexOf(" ");
    prefix = rest.slice(1, spaceIdx);
    rest = rest.slice(spaceIdx + 1);
  }

  const trailingIdx = rest.indexOf(" :");
  let trailing = "";
  if (trailingIdx !== -1) {
    trailing = rest.slice(trailingIdx + 2);
    rest = rest.slice(0, trailingIdx);
  }

  const parts = rest.split(" ");
  const command = parts[0] ?? "";
  const params = parts.slice(1);

  // When no colon-delimited trailing param was found, the last non-empty
  // param for PRIVMSG is the message text (pymcp-ircd omits the colon for
  // single-word messages). Move it to trailing for uniform access.
  if (trailing.length === 0 && command === "PRIVMSG" && params.length > 1) {
    trailing = params.pop() ?? "";
  }

  return { raw: line, prefix, command, params, trailing };
}

/**
 * Extract nickname from an IRC prefix (`nick!user@host` → `nick`).
 */
function nickFromPrefix(prefix: string): string {
  const bang = prefix.indexOf("!");
  return bang === -1 ? prefix : prefix.slice(0, bang);
}

/**
 * IRC client connected to a pymcp-ircd server.
 *
 * Callbacks are registered before connecting:
 * - `onMessage`: called when a PRIVMSG arrives in a joined channel.
 */
export class IrcClient {
  readonly #config: IrcClientConfig;
  #socket: Socket | null = null;
  #buffer = "";
  #onMessage: ((msg: IrcChannelMessage) => void) | null = null;

  constructor(config: IrcClientConfig) {
    this.#config = config;
  }

  /**
   * Register a callback for incoming channel messages.
   * Must be called before `connect()`.
   */
  onMessage(cb: (msg: IrcChannelMessage) => void): void {
    this.#onMessage = cb;
  }

  /**
   * Connect to the IRC server, register, and join channels.
   * Resolves after all JOIN commands are sent.
   */
  connect(): Promise<void> {
    const { host, port, nick, channels } = this.#config;
    logInfo(`IRC connecting to ${host}:${port} as ${nick}`);

    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port }, () => {
        this.#send(`NICK ${nick}`);
        this.#send(`USER ${nick} 0 * :${nick}`);
      });

      this.#socket = socket;

      socket.on("data", (data: Buffer) => {
        this.#handleData(data.toString("utf-8"), resolve, channels);
      });

      socket.on("error", (err: Error) => {
        console.error("IRC connection error:", err);
        reject(err);
      });

      socket.on("close", () => {
        logInfo("IRC connection closed");
        this.#socket = null;
      });
    });
  }

  /**
   * Send a PRIVMSG to a channel.
   */
  sendMessage(channel: string, text: string): void {
    // Split long messages at newlines; send each line separately.
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      this.#send(`PRIVMSG ${channel} :${trimmed}`);
    }
  }

  /**
   * Gracefully disconnect from the server.
   */
  disconnect(): void {
    if (this.#socket && !this.#socket.destroyed) {
      this.#send("QUIT :bye");
      this.#socket.end();
    }
    this.#socket = null;
  }

  /** Send a raw IRC line (appends CRLF). */
  #send(line: string): void {
    if (this.#socket && !this.#socket.destroyed) {
      this.#socket.write(`${line}\r\n`);
    }
  }

  /** Handle incoming data, buffering and parsing complete lines. */
  #handleData(
    chunk: string,
    resolve: () => void,
    channels: string[],
  ): void {
    this.#buffer += chunk;

    const lines = this.#buffer.split("\r\n");
    // Last element is incomplete — keep in buffer.
    this.#buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.length === 0) continue;
      this.#handleLine(line, resolve, channels);
    }
  }

  /** Handle a single parsed IRC line. */
  #handleLine(
    line: string,
    resolve: () => void,
    channels: string[],
  ): void {
    const msg = parseLine(line);

    // Respond to PING with PONG.
    if (msg.command === "PING") {
      this.#send(`PONG :${msg.trailing}`);
      return;
    }

    // After successful registration (numeric 001), join channels.
    if (msg.command === "001") {
      logInfo(`IRC registered as ${this.#config.nick}`);
      for (const ch of channels) {
        this.#send(`JOIN ${ch}`);
        logInfo(`IRC joining ${ch}`);
      }
      resolve();
      return;
    }

    // Route PRIVMSG to the message callback.
    if (msg.command === "PRIVMSG" && this.#onMessage) {
      const target = msg.params[0] ?? "";
      const isChannel = target.startsWith("#") || target.startsWith("&");
      if (isChannel) {
        this.#onMessage({
          nick: nickFromPrefix(msg.prefix),
          channel: target,
          text: msg.trailing,
        });
      }
    }
  }
}
