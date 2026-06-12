import type {
  MessageReportDetail,
  ReportDetail,
  ReportPhase,
} from "../../api";
import { formatDuration, statusClass } from "./debugUtils";

export function buildLogFileContent(detail: MessageReportDetail): string {
  const header = [
    `Debug report #${detail.id}`,
    `Exported: ${new Date().toISOString()}`,
    `Created: ${detail.createdAt}`,
    `Status: ${detail.status}`,
    `Duration: ${detail.report.durationMs}ms`,
    `Chat: ${detail.chatType} · ${detail.chatId}`,
    `Conv key: ${detail.convKey || "—"}`,
    detail.userId ? `User id: ${detail.userId}` : null,
    detail.messageId != null ? `Telegram message id: ${detail.messageId}` : null,
    "",
    detail.report.headline,
    "",
    "--- raw report ---",
    JSON.stringify(detail, null, 2),
  ].filter((line) => line != null);

  return `${header.join("\n")}\n`;
}

export function downloadReportLog(detail: MessageReportDetail): void {
  const text = buildLogFileContent(detail);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = detail.createdAt.slice(0, 19).replace(/[:T]/g, "-");
  anchor.href = url;
  anchor.download = `debug-${detail.id}-${stamp}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function phaseStatusClass(status: ReportPhase["status"]): string {
  if (status === "ok") return "ok";
  if (status === "failed") return "danger";
  return "";
}

function PhaseDetail({ detail }: { detail: ReportDetail }) {
  if (detail.type === "fields") {
    return (
      <dl className="report-fields">
        {detail.fields.map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  if (detail.type === "text") {
    return (
      <div className="report-text-block">
        <h5>{detail.title}</h5>
        <pre className="report-pre">{detail.body}</pre>
      </div>
    );
  }

  if (detail.type === "mood") {
    return (
      <dl className="report-fields report-mood-grid">
        {Object.entries(detail.traits)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([trait, value]) => (
            <div key={trait}>
              <dt>{trait}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    );
  }

  return (
    <div className="report-llm">
      <div className="report-llm-meta">
        <span>{detail.model}</span>
        {detail.sampling ? <span>{detail.sampling}</span> : null}
        {detail.output.meta ? <span>{detail.output.meta}</span> : null}
      </div>
      {detail.sections.map((section) => (
        <details key={section.title} className="report-section">
          <summary>{section.title}</summary>
          <pre className="report-pre">{section.body}</pre>
        </details>
      ))}
      <details className="report-section">
        <summary>Output</summary>
        <pre className="report-pre">{detail.output.content || "(empty)"}</pre>
      </details>
      {detail.output.reasoning ? (
        <details className="report-section">
          <summary>Reasoning</summary>
          <pre className="report-pre">{detail.output.reasoning}</pre>
        </details>
      ) : null}
    </div>
  );
}

export function PhaseRow({ phase }: { phase: ReportPhase }) {
  return (
    <details className="report-phase">
      <summary className="report-phase-summary">
        <span className={`report-phase-status ${phaseStatusClass(phase.status)}`}>
          {phase.status}
        </span>
        <span className="report-phase-title">{phase.title}</span>
        <span className="report-phase-oneline">{phase.summary}</span>
        {phase.durationMs != null ? (
          <span className="report-phase-duration">
            {formatDuration(phase.durationMs)}
          </span>
        ) : null}
      </summary>
      {phase.detail ? (
        <div className="report-phase-body">
          <PhaseDetail detail={phase.detail} />
        </div>
      ) : null}
    </details>
  );
}

export { statusClass };
