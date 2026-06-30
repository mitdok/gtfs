import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../lib/api";

interface RtFreshnessStatus {
  feedType: "trip_updates" | "vehicle_positions" | "service_alerts" | "mixed";
  configured: boolean;
  status: "fresh" | "stale" | "no_data" | "not_configured";
  sloSec: number;
  ageSec?: number;
  entityCount: number;
  latestUpdatedAt?: string;
  sourceId?: string;
  lastError?: string;
}

export function RealtimeFreshnessView() {
  const [feeds, setFeeds] = useState<RtFreshnessStatus[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setStatus("鮮度を確認中...");
    try {
      const body = await apiJson<{ feeds: RtFreshnessStatus[] }>("/rt/status");
      setFeeds(body.feeds);
      setStatus(`確認済み: ${body.feeds.length} feed`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="rt-freshness-view">
      <div className="rt-freshness-toolbar">
        <button onClick={() => void refresh()}>再確認</button>
        {status && <span className="rt-status ok">{status}</span>}
      </div>
      {error && <div className="rt-error">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>feed</th>
            <th>source</th>
            <th>状態</th>
            <th>age</th>
            <th>SLO</th>
            <th>entities</th>
            <th>updated</th>
            <th>error</th>
          </tr>
        </thead>
        <tbody>
          {feeds.map((feed, index) => (
            <tr key={`${feed.feedType}:${feed.sourceId ?? "local"}:${index}`} className={`rt-freshness-${feed.status}`}>
              <td className="mono">{feed.feedType}</td>
              <td className="mono">{feed.sourceId ?? "local"}</td>
              <td>{statusLabel(feed.status)}</td>
              <td className="mono">{feed.ageSec === undefined ? "-" : `${feed.ageSec}s`}</td>
              <td className="mono">{feed.sloSec}s</td>
              <td className="mono">{feed.entityCount}</td>
              <td className="mono">{feed.latestUpdatedAt ?? "-"}</td>
              <td>{feed.lastError ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusLabel(status: RtFreshnessStatus["status"]): string {
  if (status === "fresh") return "fresh";
  if (status === "stale") return "stale";
  if (status === "no_data") return "no data";
  return "not configured";
}
