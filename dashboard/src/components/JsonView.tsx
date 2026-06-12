import ReactJson from "react-json-view";

function toJsonSrc(value: unknown): object {
  if (value == null) return { value: null };
  if (typeof value === "object") return value as object;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return parsed as object;
        }
      } catch {
        // fall through
      }
    }
    return { text: value };
  }
  return { value };
}

export interface JsonViewProps {
  value: unknown;
  collapsed?: boolean | number;
  name?: string | false | null;
}

export function JsonView({
  value,
  collapsed = true,
  name = false,
}: JsonViewProps) {
  return (
    <div className="debug-json-view">
      <ReactJson
        src={toJsonSrc(value)}
        name={name}
        theme="monokai"
        iconStyle="triangle"
        indentWidth={2}
        collapsed={collapsed}
        collapseStringsAfterLength={280}
        enableClipboard
        displayDataTypes={false}
        displayObjectSize
        quotesOnKeys={false}
        sortKeys
      />
    </div>
  );
}
