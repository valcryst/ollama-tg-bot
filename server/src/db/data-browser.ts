import type { DatabaseSync } from "node:sqlite";

const MAX_ROWS = 2000;

export interface DataTableSummary {
  id: string;
  label: string;
  count: number;
}

export interface DataTablePayload {
  id: string;
  label: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  truncated: boolean;
}

interface TableConfig {
  label: string;
  columns: string[];
  query: string;
  countQuery: string;
  timeColumns?: string[];
}

const TABLE_CONFIGS: Record<string, TableConfig> = {
  settings: {
    label: "Settings",
    columns: ["key", "value"],
    query: "SELECT key, value FROM settings ORDER BY key",
    countQuery: "SELECT COUNT(*) AS n FROM settings",
  },
  stats: {
    label: "Stats",
    columns: ["key", "value"],
    query: "SELECT key, value FROM stats ORDER BY key",
    countQuery: "SELECT COUNT(*) AS n FROM stats",
  },
  stats_meta: {
    label: "Stats meta",
    columns: ["key", "value"],
    query: "SELECT key, value FROM stats_meta ORDER BY key",
    countQuery: "SELECT COUNT(*) AS n FROM stats_meta",
  },
  chat_messages: {
    label: "Chat history",
    columns: ["id", "chat_key", "role", "content", "created_at"],
    query: `SELECT id, chat_key, role, content, created_at
            FROM chat_messages ORDER BY id DESC LIMIT ?`,
    countQuery: "SELECT COUNT(*) AS n FROM chat_messages",
    timeColumns: ["created_at"],
  },
  user_facts: {
    label: "User facts",
    columns: ["id", "user_id", "fact", "created_at"],
    query: `SELECT id, user_id, fact, created_at
            FROM user_facts ORDER BY id DESC LIMIT ?`,
    countQuery: "SELECT COUNT(*) AS n FROM user_facts",
    timeColumns: ["created_at"],
  },
  group_facts: {
    label: "Group facts",
    columns: ["id", "group_id", "fact", "created_at"],
    query: `SELECT id, group_id, fact, created_at
            FROM group_facts ORDER BY id DESC LIMIT ?`,
    countQuery: "SELECT COUNT(*) AS n FROM group_facts",
    timeColumns: ["created_at"],
  },
  general_facts: {
    label: "General facts",
    columns: ["id", "fact", "created_at"],
    query: `SELECT id, fact, created_at
            FROM general_facts ORDER BY id DESC LIMIT ?`,
    countQuery: "SELECT COUNT(*) AS n FROM general_facts",
    timeColumns: ["created_at"],
  },
  personalities: {
    label: "Personalities",
    columns: ["id", "name", "prompt", "mood_defaults", "created_at", "updated_at"],
    query: `SELECT id, name, prompt, mood_defaults, created_at, updated_at
            FROM personalities ORDER BY id ASC LIMIT ?`,
    countQuery: "SELECT COUNT(*) AS n FROM personalities",
    timeColumns: ["created_at", "updated_at"],
  },
  known_users: {
    label: "Known users",
    columns: ["user_id", "username", "first_name", "last_name", "updated_at"],
    query: `SELECT user_id, username, first_name, last_name, updated_at
            FROM known_users ORDER BY updated_at DESC LIMIT ?`,
    countQuery: "SELECT COUNT(*) AS n FROM known_users",
    timeColumns: ["updated_at"],
  },
  message_refs: {
    label: "Message refs",
    columns: [
      "chat_key",
      "telegram_message_id",
      "role",
      "sender_label",
      "content",
      "created_at",
    ],
    query: `SELECT chat_key, telegram_message_id, role, sender_label, content, created_at
            FROM message_refs ORDER BY created_at DESC LIMIT ?`,
    countQuery: "SELECT COUNT(*) AS n FROM message_refs",
    timeColumns: ["created_at"],
  },
  error_log: {
    label: "Error log",
    columns: ["id", "message", "stack", "chat_id", "user_id", "created_at"],
    query: `SELECT id, message, stack, chat_id, user_id, created_at
            FROM error_log ORDER BY id DESC LIMIT ?`,
    countQuery: "SELECT COUNT(*) AS n FROM error_log",
    timeColumns: ["created_at"],
  },
};

const TABLE_ORDER = [
  "settings",
  "stats",
  "stats_meta",
  "chat_messages",
  "user_facts",
  "group_facts",
  "general_facts",
  "personalities",
  "known_users",
  "message_refs",
  "error_log",
] as const;

let db: DatabaseSync;

export function bindDataBrowserDatabase(database: DatabaseSync): void {
  db = database;
}

export function listDataTables(): DataTableSummary[] {
  return TABLE_ORDER.map((id) => {
    const config = TABLE_CONFIGS[id];
    const row = db.prepare(config.countQuery).get() as { n: number };
    return { id, label: config.label, count: row.n };
  });
}

export function getDataTable(tableId: string): DataTablePayload | null {
  const config = TABLE_CONFIGS[tableId];
  if (!config) return null;

  const totalRow = db.prepare(config.countQuery).get() as { n: number };
  const total = totalRow.n;
  const limited = total > MAX_ROWS;
  const usesLimit = config.query.includes("LIMIT ?");
  const rows = usesLimit
    ? (db.prepare(config.query).all(MAX_ROWS) as Record<string, unknown>[])
    : (db.prepare(config.query).all() as Record<string, unknown>[]);

  const timeCols = new Set(config.timeColumns ?? []);
  const formatted = rows.map((row) => formatRow(row, timeCols));

  return {
    id: tableId,
    label: config.label,
    columns: config.columns.map(snakeToCamel),
    rows: formatted,
    total,
    truncated: limited,
  };
}

function formatRow(
  row: Record<string, unknown>,
  timeColumns: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = snakeToCamel(key);
    if (timeColumns.has(key) && typeof value === "number") {
      out[camel] = new Date(value * 1000).toISOString();
    } else {
      out[camel] = value;
    }
  }
  return out;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
