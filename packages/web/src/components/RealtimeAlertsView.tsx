import { useCallback, useEffect, useMemo, useState } from "react";
import type { ServiceAlertInput, StoredServiceAlert } from "@gtfs-studio/core/realtime";
import { API_BASE, apiJson } from "../lib/api";

const CAUSES = [
  "UNKNOWN_CAUSE",
  "OTHER_CAUSE",
  "TECHNICAL_PROBLEM",
  "STRIKE",
  "DEMONSTRATION",
  "ACCIDENT",
  "HOLIDAY",
  "WEATHER",
  "MAINTENANCE",
  "CONSTRUCTION",
  "POLICE_ACTIVITY",
  "MEDICAL_EMERGENCY",
] as const;

const EFFECTS = [
  "UNKNOWN_EFFECT",
  "NO_SERVICE",
  "REDUCED_SERVICE",
  "SIGNIFICANT_DELAYS",
  "DETOUR",
  "ADDITIONAL_SERVICE",
  "MODIFIED_SERVICE",
  "OTHER_EFFECT",
  "STOP_MOVED",
  "NO_EFFECT",
  "ACCESSIBILITY_ISSUE",
] as const;

const SEVERITIES = ["UNKNOWN_SEVERITY", "INFO", "WARNING", "SEVERE"] as const;

type Cause = (typeof CAUSES)[number];
type Effect = (typeof EFFECTS)[number];
type Severity = (typeof SEVERITIES)[number];

interface AlertDraft {
  id: string;
  routeId: string;
  stopId: string;
  tripId: string;
  start: string;
  end: string;
  cause: Cause;
  effect: Effect;
  severityLevel: Severity;
  headerJa: string;
  headerEn: string;
  descriptionJa: string;
  urlJa: string;
}

const DEFAULT_DRAFT: AlertDraft = {
  id: "alert-1",
  routeId: "",
  stopId: "",
  tripId: "",
  start: "",
  end: "",
  cause: "UNKNOWN_CAUSE",
  effect: "UNKNOWN_EFFECT",
  severityLevel: "WARNING",
  headerJa: "",
  headerEn: "",
  descriptionJa: "",
  urlJa: "",
};

export function RealtimeAlertsView() {
  const [draft, setDraft] = useState<AlertDraft>(DEFAULT_DRAFT);
  const [alerts, setAlerts] = useState<StoredServiceAlert[]>([]);
  const [lastPreview, setLastPreview] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);

  const input = useMemo((): ServiceAlertInput => {
    const informedEntities = [];
    if (draft.routeId.trim()) informedEntities.push({ routeId: draft.routeId.trim() });
    if (draft.stopId.trim()) informedEntities.push({ stopId: draft.stopId.trim() });
    if (draft.tripId.trim()) informedEntities.push({ tripId: draft.tripId.trim() });

    const activePeriods =
      draft.start.trim() || draft.end.trim()
        ? [{ start: draft.start.trim() || undefined, end: draft.end.trim() || undefined }]
        : undefined;

    return {
      id: draft.id.trim(),
      informedEntities,
      activePeriods,
      cause: draft.cause,
      effect: draft.effect,
      severityLevel: draft.severityLevel,
      headerText: {
        ja: draft.headerJa.trim(),
        ...(draft.headerEn.trim() ? { en: draft.headerEn.trim() } : {}),
      },
      ...(draft.descriptionJa.trim() ? { descriptionText: { ja: draft.descriptionJa.trim() } } : {}),
      ...(draft.urlJa.trim() ? { url: { ja: draft.urlJa.trim() } } : {}),
    };
  }, [draft]);

  const update = useCallback(<K extends keyof AlertDraft>(key: K, value: AlertDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const fetchAlerts = useCallback(async () => {
    setError(null);
    setStatus("APIからAlertを読み込み中...");
    try {
      const body = await apiJson<{ alerts: StoredServiceAlert[] }>("/rt/alerts");
      setAlerts(body.alerts);
      setDraft((current) => ({ ...current, id: nextAlertId(body.alerts) }));
      setApiAvailable(true);
      setStatus(`API同期済み: ${body.alerts.length}件`);
    } catch (e) {
      setApiAvailable(false);
      setStatus("API未接続: 画面内だけでprotobuf生成できます");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  const generate = useCallback(async (sourceAlerts: ServiceAlertInput[]) => {
    setError(null);
    try {
      const { decodeRealtimeFeed, encodeServiceAlertsFeed, realtimeFeedToObject } = await import(
        "@gtfs-studio/core/realtime"
      );
      const bytes = encodeServiceAlertsFeed(sourceAlerts, { timestamp: new Date() });
      const preview = realtimeFeedToObject(decodeRealtimeFeed(bytes));
      setLastPreview(preview);
      return bytes;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const previewBytes = useCallback(async (bytes: Uint8Array) => {
    const { decodeRealtimeFeed, realtimeFeedToObject } = await import("@gtfs-studio/core/realtime");
    setLastPreview(realtimeFeedToObject(decodeRealtimeFeed(bytes)));
  }, []);

  const onSave = useCallback(async () => {
    setError(null);
    setStatus(null);
    try {
      if (apiAvailable !== false) {
        const saved = await apiJson<StoredServiceAlert>("/rt/alerts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const nextAlerts = upsertAlert(alerts, saved);
        setAlerts(nextAlerts);
        setDraft((current) => ({ ...current, id: nextAlertId(nextAlerts) }));
        setApiAvailable(true);
        setStatus("APIへ保存しました");
        return;
      }

      const { createRealtimeAlertStore } = await import("@gtfs-studio/core/realtime");
      const store = createRealtimeAlertStore(alerts);
      const saved = store.upsert(input);
      const nextAlerts = store.list();
      setAlerts(nextAlerts);
      setDraft((current) => ({ ...current, id: nextAlertId(nextAlerts) }));
      setStatus("ローカルに保存しました");
    } catch (e) {
      setApiAvailable(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [alerts, apiAvailable, input]);

  const onPreview = useCallback(async () => {
    await generate([input]);
  }, [generate, input]);

  const onDownload = useCallback(async () => {
    let bytes: Uint8Array | null = null;
    if (apiAvailable) {
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/rt/alerts.pb`);
        if (!response.ok) throw new Error(await response.text());
        bytes = new Uint8Array(await response.arrayBuffer());
        await previewBytes(bytes);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    } else {
      const sourceAlerts = alerts.length > 0 ? alerts : [input];
      bytes = await generate(sourceAlerts);
    }
    if (!bytes) return;
    const blob = new Blob([bytes as BlobPart], { type: "application/x-protobuf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "alerts.pb";
    a.click();
    URL.revokeObjectURL(url);
  }, [alerts, apiAvailable, generate, input, previewBytes]);

  const onRemove = useCallback(async (id: string) => {
    setError(null);
    setStatus(null);
    if (apiAvailable) {
      try {
        await apiJson(`/rt/alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
        setAlerts((current) => current.filter((alert) => alert.id !== id));
        setStatus("APIから削除しました");
        return;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setAlerts((current) => current.filter((alert) => alert.id !== id));
    setStatus("ローカルから削除しました");
  }, [apiAvailable]);

  const onRefresh = useCallback(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  const onForceLocal = useCallback(() => {
    setApiAvailable(false);
    setStatus("ローカル編集に切り替えました");
    setError(null);
  }, []);

  return (
    <div className="rt-alerts-view">
      <section className="rt-alert-form">
        <div className="form-grid">
          <label>
            Alert ID
            <input value={draft.id} onChange={(e) => update("id", e.target.value)} />
          </label>
          <label>
            cause
            <select value={draft.cause} onChange={(e) => update("cause", e.target.value as Cause)}>
              {CAUSES.map((cause) => (
                <option key={cause} value={cause}>
                  {cause}
                </option>
              ))}
            </select>
          </label>
          <label>
            effect
            <select value={draft.effect} onChange={(e) => update("effect", e.target.value as Effect)}>
              {EFFECTS.map((effect) => (
                <option key={effect} value={effect}>
                  {effect}
                </option>
              ))}
            </select>
          </label>
          <label>
            severity
            <select
              value={draft.severityLevel}
              onChange={(e) => update("severityLevel", e.target.value as Severity)}
            >
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </select>
          </label>
          <label>
            route_id
            <input value={draft.routeId} onChange={(e) => update("routeId", e.target.value)} />
          </label>
          <label>
            stop_id
            <input value={draft.stopId} onChange={(e) => update("stopId", e.target.value)} />
          </label>
          <label>
            trip_id
            <input value={draft.tripId} onChange={(e) => update("tripId", e.target.value)} />
          </label>
          <label>
            start
            <input
              placeholder="YYYY-MM-DDTHH:mm:ss+09:00"
              value={draft.start}
              onChange={(e) => update("start", e.target.value)}
            />
          </label>
          <label>
            end
            <input
              placeholder="YYYY-MM-DDTHH:mm:ss+09:00"
              value={draft.end}
              onChange={(e) => update("end", e.target.value)}
            />
          </label>
          <label className="wide">
            header ja
            <input value={draft.headerJa} onChange={(e) => update("headerJa", e.target.value)} />
          </label>
          <label className="wide">
            header en
            <input value={draft.headerEn} onChange={(e) => update("headerEn", e.target.value)} />
          </label>
          <label className="wide">
            description ja
            <textarea
              value={draft.descriptionJa}
              onChange={(e) => update("descriptionJa", e.target.value)}
            />
          </label>
          <label className="wide">
            url ja
            <input value={draft.urlJa} onChange={(e) => update("urlJa", e.target.value)} />
          </label>
        </div>
        <div className="rt-actions">
          <span className={apiAvailable ? "rt-status ok" : "rt-status"}>
            {apiAvailable ? `API: ${API_BASE}` : "ローカル"}
          </span>
          <button onClick={onRefresh}>API再読込</button>
          <button onClick={onForceLocal}>ローカル編集</button>
          <button onClick={onSave}>Alertを保存</button>
          <button onClick={onPreview}>protobufを検証</button>
          <button className="primary" onClick={onDownload}>
            alerts.pb を出力
          </button>
        </div>
        {status && <div className="rt-info">{status}</div>}
        {error && <div className="rt-error">{error}</div>}
      </section>

      <section className="rt-preview">
        <h3>FeedMessage preview</h3>
        {lastPreview ? (
          <pre>{JSON.stringify(lastPreview, null, 2)}</pre>
        ) : (
          <p className="hint">protobuf生成後にdecode結果を表示します。</p>
        )}
      </section>

      <section className="rt-alert-list">
        <h3>保存済みAlert</h3>
        {alerts.length === 0 ? (
          <p className="hint">保存済みAlertはありません。未保存の入力内容からも `alerts.pb` を出力できます。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>対象</th>
                <th>effect</th>
                <th>header</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id}>
                  <td className="mono">{alert.id}</td>
                  <td className="mono">{alert.informedEntities.map(entityLabel).join(", ")}</td>
                  <td className="mono">{alert.effect ?? "UNKNOWN_EFFECT"}</td>
                  <td>{alert.headerText.ja ?? Object.values(alert.headerText)[0]}</td>
                  <td>
                    <button onClick={() => onRemove(alert.id)}>削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function upsertAlert(alerts: StoredServiceAlert[], alert: StoredServiceAlert): StoredServiceAlert[] {
  const next = alerts.filter((current) => current.id !== alert.id);
  next.push(alert);
  return next.sort((a, b) => a.id.localeCompare(b.id));
}

function entityLabel(entity: ServiceAlertInput["informedEntities"][number]): string {
  if (entity.routeId) return `route:${entity.routeId}`;
  if (entity.stopId) return `stop:${entity.stopId}`;
  if (entity.tripId) return `trip:${entity.tripId}`;
  if (entity.agencyId) return `agency:${entity.agencyId}`;
  if (entity.routeType !== undefined) return `route_type:${entity.routeType}`;
  return "entity";
}

function nextAlertId(alerts: Array<{ id: string }>): string {
  let n = alerts.length + 1;
  const used = new Set(alerts.map((alert) => alert.id));
  while (used.has(`alert-${n}`)) n++;
  return `alert-${n}`;
}
