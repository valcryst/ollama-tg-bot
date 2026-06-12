let db: import("node:sqlite").DatabaseSync;

export const MAX_TRACES_PER_CHAT = 50;

export type ReportStatus = "ignored" | "processing" | "processed" | "error";
export type PhaseStatus = "skipped" | "ok" | "failed";

export interface ReportDetailFields {
  type: "fields";
  fields: Array<{ label: string; value: string }>;
}

export interface ReportDetailText {
  type: "text";
  title: string;
  body: string;
}

export interface ReportDetailLlm {
  type: "llm";
  model: string;
  sampling?: string;
  sections: Array<{ title: string; body: string }>;
  output: {
    content: string;
    reasoning?: string;
    meta?: string;
  };
}

export interface ReportDetailMood {
  type: "mood";
  traits: Record<string, number>;
}

export type ReportDetail =
  | ReportDetailFields
  | ReportDetailText
  | ReportDetailLlm
  | ReportDetailMood;

export interface ReportPhase {
  id: string;
  title: string;
  status: PhaseStatus;
  durationMs?: number;
  summary: string;
  detail?: ReportDetail;
}

export interface MessageReportRecord {
  status: ReportStatus;
  headline: string;
  durationMs: number;
  intake: {
    messagePreview: string;
    hasMedia: boolean;
    mediaKind?: string;
  };
  routing:
    | {
        decision: "ignored";
        ignoreReason: string;
        ignoreLabel: string;
        addressSource?: string;
      }
    | {
        decision: "accepted";
        trigger: "addressed" | "random" | "image";
        triggerLabel: string;
        addressSource?: string;
      };
  phases: ReportPhase[];
  result: {
    replyChars?: number;
    chunks?: number;
    sticker?: string;
    thinkingSent?: boolean;
    memory?: {
      status: "pending" | "done" | "failed";
      updated: boolean;
      scopes?: string[];
      error?: string;
    };
    error?: string;
  };
}

export type MessageReport = MessageReportRecord;

export interface MessageReportListSummary {
  headline: string;
  badges: string[];
  trigger?: "addressed" | "random" | "image";
  ignoreLabel?: string;
}

export interface DebugChatSummary {
  chatId: string;
  chatType: string;
  label: string;
  traceCount: number;
  latestAt: string | null;
}

export interface MessageReportListItem {
  id: number;
  chatId: string;
  userId: string | null;
  userLabel: string | null;
  messagePreview: string;
  status: ReportStatus;
  headline: string;
  badges: string[];
  durationMs: number | null;
  createdAt: string;
}

export interface MessageReportDetail {
  id: number;
  chatId: string;
  convKey: string;
  userId: string | null;
  chatType: string;
  messageId: number | null;
  messagePreview: string;
  status: ReportStatus;
  durationMs: number | null;
  createdAt: string;
  report: MessageReportRecord;
}

export function bindDebugTracesDatabase(
  database: import("node:sqlite").DatabaseSync,
): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS debug_traces (
      id INTEGER PRIMARY KEY,
      chat_id TEXT NOT NULL,
      conv_key TEXT NOT NULL DEFAULT '',
      user_id TEXT,
      chat_type TEXT NOT NULL,
      message_id INTEGER,
      message_preview TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      duration_ms INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_debug_traces_chat
      ON debug_traces (chat_id, id DESC);
  `);
}

function parseListSummary(raw: string): MessageReportListSummary | null {
  try {
    const parsed = JSON.parse(raw) as MessageReportListSummary;
    return parsed.headline ? parsed : null;
  } catch {
    return null;
  }
}

function parseReport(raw: string): MessageReportRecord | null {
  try {
    const parsed = JSON.parse(raw) as MessageReportRecord;
    return parsed.headline ? parsed : null;
  } catch {
    return null;
  }
}

function trimTracesForChat(chatId: string): void {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM debug_traces WHERE chat_id = ?`)
    .get(chatId) as { n: number };
  const excess = row.n - MAX_TRACES_PER_CHAT;
  if (excess > 0) {
    db.prepare(
      `DELETE FROM debug_traces WHERE id IN (
         SELECT id FROM debug_traces
         WHERE chat_id = ?
         ORDER BY id ASC
         LIMIT ?
       )`,
    ).run(chatId, excess);
  }
}

export function getMaxDebugTraceId(): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(id), 0) AS max_id FROM debug_traces`)
    .get() as { max_id: number };
  return row.max_id;
}

export function upsertMessageReport(input: {
  id: number;
  chatId: string;
  convKey: string;
  userId: string | null;
  chatType: string;
  messageId: number | null;
  messagePreview: string;
  status: ReportStatus;
  listSummary: MessageReportListSummary;
  report: MessageReportRecord;
  durationMs: number | null;
}): void {
  db.prepare(
    `INSERT INTO debug_traces (
       id, chat_id, conv_key, user_id, chat_type, message_id,
       message_preview, status, summary_json, details_json, duration_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       conv_key = excluded.conv_key,
       status = excluded.status,
       summary_json = excluded.summary_json,
       details_json = excluded.details_json,
       duration_ms = excluded.duration_ms`,
  ).run(
    input.id,
    input.chatId,
    input.convKey,
    input.userId,
    input.chatType,
    input.messageId,
    input.messagePreview.slice(0, 500),
    input.status,
    JSON.stringify(input.listSummary),
    JSON.stringify(input.report),
    input.durationMs,
  );
  trimTracesForChat(input.chatId);
  void import("../live-events.js").then(({ emitDataUpdated, emitDebugUpdated }) => {
    emitDebugUpdated(buildDebugLivePayload(input.id));
    emitDataUpdated(["debug_traces"]);
  });
}

type DebugTraceListRow = {
  id: number;
  chat_id: string;
  user_id: string | null;
  message_preview: string;
  status: ReportStatus;
  summary_json: string;
  duration_ms: number | null;
  created_at: number;
};

function rowToListItem(row: DebugTraceListRow): MessageReportListItem | null {
  const list = parseListSummary(row.summary_json);
  if (!list) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    userId: row.user_id,
    userLabel: formatUserLabel(row.user_id),
    messagePreview: row.message_preview,
    status: row.status,
    headline: list.headline,
    badges: list.badges,
    durationMs: row.duration_ms,
    createdAt: new Date(row.created_at * 1000).toISOString(),
  };
}

export function getDebugTraceListItem(
  id: number,
): MessageReportListItem | null {
  const row = db
    .prepare(
      `SELECT id, chat_id, user_id, message_preview, status,
              summary_json, duration_ms, created_at
       FROM debug_traces
       WHERE id = ?`,
    )
    .get(id) as DebugTraceListRow | undefined;
  if (!row) return null;
  return rowToListItem(row);
}

export function buildDebugLivePayload(traceId: number): {
  chatId: string;
  traceId: number;
  listItem: MessageReportListItem | null;
  trace: MessageReportDetail | null;
} | null {
  const trace = getDebugTraceById(traceId);
  if (!trace) return null;
  return {
    chatId: trace.chatId,
    traceId,
    listItem: getDebugTraceListItem(traceId),
    trace,
  };
}

export function listDebugChats(): DebugChatSummary[] {
  const rows = db
    .prepare(
      `SELECT chat_id, chat_type, COUNT(*) AS trace_count, MAX(created_at) AS latest_at
       FROM debug_traces
       GROUP BY chat_id
       ORDER BY latest_at DESC`,
    )
    .all() as Array<{
    chat_id: string;
    chat_type: string;
    trace_count: number;
    latest_at: number | null;
  }>;

  return rows.map((row) => ({
    chatId: row.chat_id,
    chatType: row.chat_type,
    label: formatChatLabel(row.chat_id, row.chat_type),
    traceCount: row.trace_count,
    latestAt:
      row.latest_at != null
        ? new Date(row.latest_at * 1000).toISOString()
        : null,
  }));
}

function formatChatLabel(chatId: string, chatType: string): string {
  if (chatType === "private") {
    const user = db
      .prepare(
        `SELECT username, first_name, last_name FROM known_users WHERE user_id = ?`,
      )
      .get(chatId) as
      | {
          username: string | null;
          first_name: string | null;
          last_name: string | null;
        }
      | undefined;
    if (user) {
      const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
      if (name && user.username) return `${name} (@${user.username})`;
      if (name) return name;
      if (user.username) return `@${user.username}`;
    }
    return `Private chat ${chatId}`;
  }
  return `Group ${chatId}`;
}

function formatUserLabel(userId: string | null): string | null {
  if (!userId) return null;
  const user = db
    .prepare(
      `SELECT username, first_name, last_name FROM known_users WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        username: string | null;
        first_name: string | null;
        last_name: string | null;
      }
    | undefined;
  if (!user) return `User ${userId}`;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  if (name && user.username) return `${name} (@${user.username})`;
  if (name) return name;
  if (user.username) return `@${user.username}`;
  return `User ${userId}`;
}

export function listDebugTracesForChat(
  chatId: string,
): MessageReportListItem[] {
  const rows = db
    .prepare(
      `SELECT id, chat_id, user_id, message_preview, status,
              summary_json, duration_ms, created_at
       FROM debug_traces
       WHERE chat_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(chatId, MAX_TRACES_PER_CHAT) as Array<{
    id: number;
    chat_id: string;
    user_id: string | null;
    message_preview: string;
    status: ReportStatus;
    summary_json: string;
    duration_ms: number | null;
    created_at: number;
  }>;

  return rows.flatMap((row) => {
    const item = rowToListItem(row);
    return item ? [item] : [];
  });
}

export function getDebugTraceById(id: number): MessageReportDetail | null {
  const row = db
    .prepare(
      `SELECT id, chat_id, conv_key, user_id, chat_type, message_id,
              message_preview, status, summary_json, details_json,
              duration_ms, created_at
       FROM debug_traces
       WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number;
        chat_id: string;
        conv_key: string;
        user_id: string | null;
        chat_type: string;
        message_id: number | null;
        message_preview: string;
        status: ReportStatus;
        summary_json: string;
        details_json: string;
        duration_ms: number | null;
        created_at: number;
      }
    | undefined;

  if (!row) return null;

  const report = parseReport(row.details_json);
  if (!report) return null;

  return {
    id: row.id,
    chatId: row.chat_id,
    convKey: row.conv_key,
    userId: row.user_id,
    chatType: row.chat_type,
    messageId: row.message_id,
    messagePreview: row.message_preview,
    status: row.status,
    durationMs: row.duration_ms,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    report,
  };
}
