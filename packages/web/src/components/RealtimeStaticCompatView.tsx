import { useCallback, useState } from "react";
import { apiJson } from "../lib/api";

interface StaticCompatResult {
  summary: {
    entityCount: number;
    counts: { tripUpdate: number; vehiclePosition: number; alert: number };
    referencedTripIds: string[];
    referencedRouteIds: string[];
    referencedStopIds: string[];
    issues: string[];
  };
  compatibility: {
    ok: boolean;
    checked: { tripIds: number; routeIds: number; stopIds: number };
    missing: { tripIds: string[]; routeIds: string[]; stopIds: string[] };
    issues: Array<{ type: "trip" | "route" | "stop"; id: string }>;
  };
}

export function RealtimeStaticCompatView() {
  const [zipBase64, setZipBase64] = useState("");
  const [zipName, setZipName] = useState("");
  const [feedBase64, setFeedBase64] = useState("");
  const [feedName, setFeedName] = useState("");
  const [result, setResult] = useState<StaticCompatResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onStaticZip = useCallback(async (file: File) => {
    setZipBase64(bytesToBase64(new Uint8Array(await file.arrayBuffer())));
    setZipName(file.name);
  }, []);

  const onRtFeed = useCallback(async (file: File) => {
    setFeedBase64(bytesToBase64(new Uint8Array(await file.arrayBuffer())));
    setFeedName(file.name);
  }, []);

  const runCheck = useCallback(async () => {
    setError(null);
    setStatus(null);
    if (!zipBase64) {
      setError("静的GTFS zipを選択してください");
      return;
    }
    if (!feedBase64) {
      setError("GTFS-RT .pbを選択してください");
      return;
    }
    try {
      const body = await apiJson<StaticCompatResult>("/rt/static-compat/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zipBase64, feedBase64 }),
      });
      setResult(body);
      setStatus(body.compatibility.ok ? "参照IDは静的GTFSと整合しています" : "欠落参照があります");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [feedBase64, zipBase64]);

  return (
    <div className="rt-static-compat-view">
      <section className="rt-source-form">
        <div className="form-grid">
          <label className="wide">
            static GTFS zip
            <input
              type="file"
              accept=".zip"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onStaticZip(file);
                e.target.value = "";
              }}
            />
          </label>
          <label className="wide">
            GTFS-RT .pb
            <input
              type="file"
              accept=".pb,application/x-protobuf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onRtFeed(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="rt-actions">
          <span className="rt-status">
            {[zipName || "static未選択", feedName || "RT未選択"].join(" / ")}
          </span>
          <button className="primary" onClick={runCheck}>参照IDを照合</button>
        </div>
        {status && <div className={result?.compatibility.ok ? "rt-info" : "rt-error"}>{status}</div>}
        {error && <div className="rt-error">{error}</div>}
      </section>

      <section className="rt-preview rt-static-compat-result">
        <h3>Static compatibility</h3>
        {result ? (
          <table>
            <tbody>
              <tr><th>ok</th><td>{String(result.compatibility.ok)}</td></tr>
              <tr><th>entities</th><td>{result.summary.entityCount}</td></tr>
              <tr>
                <th>counts</th>
                <td>
                  TU {result.summary.counts.tripUpdate} / VP {result.summary.counts.vehiclePosition} / Alert{" "}
                  {result.summary.counts.alert}
                </td>
              </tr>
              <tr>
                <th>checked</th>
                <td>
                  trips {result.compatibility.checked.tripIds} / routes {result.compatibility.checked.routeIds} / stops{" "}
                  {result.compatibility.checked.stopIds}
                </td>
              </tr>
              <tr><th>missing trips</th><td>{result.compatibility.missing.tripIds.join(", ") || "-"}</td></tr>
              <tr><th>missing routes</th><td>{result.compatibility.missing.routeIds.join(", ") || "-"}</td></tr>
              <tr><th>missing stops</th><td>{result.compatibility.missing.stopIds.join(", ") || "-"}</td></tr>
              <tr><th>RT issues</th><td>{result.summary.issues.join(", ") || "-"}</td></tr>
            </tbody>
          </table>
        ) : (
          <p className="hint">静的GTFSとGTFS-RT Feedの参照ID照合結果を表示します。</p>
        )}
      </section>
    </div>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}
