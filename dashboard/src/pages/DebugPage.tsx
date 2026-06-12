import { Route, Routes, useMatch, useNavigate } from "react-router-dom";
import { DebugChatList } from "./debug/DebugChatList";
import { DebugChatMessages } from "./debug/DebugChatMessages";
import { DebugMessageDetail } from "./debug/DebugMessageDetail";
import { debugChatPath, decodeRouteChatId } from "./debug/debugPaths";

export function DebugPage() {
  const navigate = useNavigate();
  const detailMatch = useMatch({
    path: "/debug/:chatId/:messageId",
    end: true,
  });
  const messagesMatch = useMatch({ path: "/debug/:chatId", end: true });
  const chatId = decodeRouteChatId(
    detailMatch?.params.chatId ?? messagesMatch?.params.chatId,
  );
  function goBack() {
    if (detailMatch && chatId) {
      navigate(debugChatPath(chatId));
      return;
    }
    if (messagesMatch) {
      navigate("/debug");
    }
  }

  const showBack = Boolean(detailMatch || messagesMatch);

  return (
    <div className="page debug-page">
      <header className="page-header">
        <div className="debug-header-row">
          <div>
            <h2>Debug</h2>
            <p className="page-desc">
              Message processing reports (last 50 per chat). Updates live.
            </p>
          </div>
          {showBack ? (
            <div className="debug-header-actions">
              <button type="button" className="btn secondary" onClick={goBack}>
                ← Back
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <Routes>
        <Route index element={<DebugChatList />} />
        <Route path=":chatId" element={<DebugChatMessages />} />
        <Route path=":chatId/:messageId" element={<DebugMessageDetail />} />
      </Routes>
    </div>
  );
}
