import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../lib/api";

interface RtAuditEvent {
  id: number;
  at: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: "success" | "failed" | "blocked";
  detail?: Record<string, unknown>;
}

export function RealtimeAuditView() {
  const [events, setEvents] = useState<RtAuditEvent[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setStatus("監査ログを読み込み中...");
    try {
      const body = await apiJson<{ events: RtAuditEvent[] }>("/rt/audit?limit=200");
      setEvents(body.events);
      setStatus(`読み込み済み: ${body.events.length} events`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="rt-audit-view">
      <div className="rt-freshness-toolbar">
        <button onClick={() => void refresh()}>再読込</button>
        {status && <span className="rt-status ok">{status}</span>}
      </div>
      {error && <div className="rt-error">{error}</div>}
      {events.length === 0 ? (
        <p className="hint">監査ログはまだありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>at</th>
              <th>action</th>
              <th>target</th>
              <th>outcome</th>
              <th>detail</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className={`rt-audit-${event.outcome}`}>
                <td className="mono">{event.at}</td>
                <td className="mono">{event.action}</td>
                <td className="mono">{event.targetType}:{event.targetId}</td>
                <td>{event.outcome}</td>
                <td className="mono">{event.detail ? JSON.stringify(event.detail) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
