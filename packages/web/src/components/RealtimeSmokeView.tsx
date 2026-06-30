import { useCallback, useState } from "react";
import { apiJson } from "../lib/api";

type RtFeedType = "trip_updates" | "vehicle_positions" | "service_alerts" | "mixed";

interface SmokeResult {
  ok: boolean;
  stage: string;
  url: string;
  httpStatus?: number;
  byteLength?: number;
  feedType?: RtFeedType;
  sloSec?: number;
  ageSec?: number;
  stale?: boolean;
  error?: string;
  summary?: {
    entityCount: number;
    counts: { tripUpdate: number; vehiclePosition: number; alert: number };
    feedTimestamp?: number;
    gtfsRealtimeVersion?: string;
    issues: string[];
  };
}

const FEED_TYPES: RtFeedType[] = ["service_alerts", "vehicle_positions", "trip_updates", "mixed"];

export function RealtimeSmokeView() {
  const [url, setUrl] = useState("");
  const [feedType, setFeedType] = useState<RtFeedType>("service_alerts");
  const [result, setResult] = useState<SmokeResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSmoke = useCallback(async () => {
    setError(null);
    setStatus("公開URLを確認中...");
    try {
      const body = await apiJson<SmokeResult>("/rt/smoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, feedType }),
      });
      setResult(body);
      setStatus(body.ok ? "decode成功" : "確認失敗");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    }
  }, [feedType, url]);

  return (
    <div className="rt-smoke-view">
      <section className="rt-source-form">
        <div className="form-grid">
          <label className="wide">
            GTFS-RT .pb URL
            <input value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label>
            feed type
            <select value={feedType} onChange={(e) => setFeedType(e.target.value as RtFeedType)}>
              {FEED_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="rt-actions">
          <button className="primary" onClick={runSmoke}>smoke実行</button>
        </div>
        {status && <div className="rt-info">{status}</div>}
        {error && <div className="rt-error">{error}</div>}
      </section>

      <section className="rt-preview rt-smoke-result">
        <h3>Smoke result</h3>
        {result ? (
          <table>
            <tbody>
              <tr><th>ok</th><td>{String(result.ok)}</td></tr>
              <tr><th>stage</th><td>{result.stage}</td></tr>
              <tr><th>HTTP</th><td>{result.httpStatus ?? "-"}</td></tr>
              <tr><th>feed</th><td>{result.feedType ?? "-"}</td></tr>
              <tr><th>age/SLO</th><td>{result.ageSec ?? "-"} / {result.sloSec ?? "-"}</td></tr>
              <tr><th>stale</th><td>{String(result.stale ?? false)}</td></tr>
              <tr><th>entities</th><td>{result.summary?.entityCount ?? "-"}</td></tr>
              <tr><th>issues</th><td>{result.summary?.issues.join(", ") || result.error || ""}</td></tr>
            </tbody>
          </table>
        ) : (
          <p className="hint">公開URLの確認結果を表示します。</p>
        )}
      </section>
    </div>
  );
}
