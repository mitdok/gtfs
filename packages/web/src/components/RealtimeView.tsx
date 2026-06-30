import { useState } from "react";
import { RealtimeAlertsView } from "./RealtimeAlertsView";
import { RealtimeAuditView } from "./RealtimeAuditView";
import { RealtimeFreshnessView } from "./RealtimeFreshnessView";
import { RealtimeSmokeView } from "./RealtimeSmokeView";
import { RealtimeSourcesView } from "./RealtimeSourcesView";
import { RealtimeVehiclesView } from "./RealtimeVehiclesView";

type RtTab = "alerts" | "vehicles" | "sources" | "freshness" | "smoke" | "audit";

export function RealtimeView() {
  const [tab, setTab] = useState<RtTab>("alerts");

  return (
    <div className="rt-view">
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
        <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>
          Audit
        </button>
      </nav>
      {tab === "alerts" && <RealtimeAlertsView />}
      {tab === "vehicles" && <RealtimeVehiclesView />}
      {tab === "sources" && <RealtimeSourcesView />}
      {tab === "freshness" && <RealtimeFreshnessView />}
      {tab === "smoke" && <RealtimeSmokeView />}
      {tab === "audit" && <RealtimeAuditView />}
    </div>
  );
}
