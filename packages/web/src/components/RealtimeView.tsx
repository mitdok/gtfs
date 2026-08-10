import { useState } from "react";
import { RealtimeAlertsView } from "./RealtimeAlertsView";
import { RealtimeAuditView } from "./RealtimeAuditView";
import { RealtimeFreshnessView } from "./RealtimeFreshnessView";
import { RealtimeSmokeView } from "./RealtimeSmokeView";
import { RealtimeSourcesView } from "./RealtimeSourcesView";
import { RealtimeStaticCompatView } from "./RealtimeStaticCompatView";
import { RealtimeVehiclesView } from "./RealtimeVehiclesView";
import { loadApiToken, saveApiToken } from "../lib/api";

type RtTab = "alerts" | "vehicles" | "sources" | "freshness" | "smoke" | "staticCompat" | "audit";

export function RealtimeView() {
  const [tab, setTab] = useState<RtTab>("alerts");
  const [token, setToken] = useState(() => loadApiToken());

  const updateToken = (value: string) => {
    setToken(value);
    saveApiToken(value);
  };

  return (
    <div className="rt-view">
      <div className="field rt-token-field">
        <label htmlFor="rt-api-token">API token（書込・検証操作）</label>
        <input
          id="rt-api-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => updateToken(event.target.value)}
          placeholder="Bearer token"
        />
        <small>このタブのセッション内だけに保存され、GTFS-RTの変更・poll・検証要求に付与されます。</small>
      </div>
      <nav className="rt-tabs">
        <button className={tab === "alerts" ? "active" : ""} onClick={() => setTab("alerts")}>
          ServiceAlerts
        </button>
        <button className={tab === "vehicles" ? "active" : ""} onClick={() => setTab("vehicles")}>
          VehiclePositions
        </button>
        <button className={tab === "sources" ? "active" : ""} onClick={() => setTab("sources")}>
          Sources
        </button>
        <button className={tab === "freshness" ? "active" : ""} onClick={() => setTab("freshness")}>
          Freshness
        </button>
        <button className={tab === "smoke" ? "active" : ""} onClick={() => setTab("smoke")}>
          Smoke
        </button>
        <button className={tab === "staticCompat" ? "active" : ""} onClick={() => setTab("staticCompat")}>
          Static Compat
        </button>
        <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>
          Audit
        </button>
      </nav>
      {tab === "alerts" && <RealtimeAlertsView />}
      {tab === "vehicles" && <RealtimeVehiclesView />}
      {tab === "sources" && <RealtimeSourcesView />}
      {tab === "freshness" && <RealtimeFreshnessView />}
      {tab === "smoke" && <RealtimeSmokeView />}
      {tab === "staticCompat" && <RealtimeStaticCompatView />}
      {tab === "audit" && <RealtimeAuditView />}
    </div>
  );
}
