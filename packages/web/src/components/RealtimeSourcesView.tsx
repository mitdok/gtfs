import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE, apiJson } from "../lib/api";

type RtFeedType = "trip_updates" | "vehicle_positions" | "service_alerts" | "mixed";
type RtStalePolicy = "serve" | "warn" | "block";

interface RtSource {
  id: string;
  url: string;
  feedType: RtFeedType;
  pollIntervalSec: number;
  enabled?: boolean;
  activeFrom?: number | string;
  stalePolicy?: RtStalePolicy;
  gtfsRevision?: string;
}

interface RtSourceStatus {
  source: RtSource;
  metrics: {
    sourceId: string;
    lastAttemptAt?: number;
    lastSuccessAt?: number;
    lastErrorAt?: number;
    lastError?: string;
    lastHttpStatus?: number;
    feedTimestamp?: number;
    entityCount?: number;
    consecutiveFailures: number;
  };
  stale: boolean;
  ageSec?: number;
  summary?: {
    entityCount: number;
    counts: { tripUpdate: number; vehiclePosition: number; alert: number };
    issues: string[];
  };
}

interface PollResult {
  sourceId: string;
  outcome: "ingested" | "not_modified" | "failed" | "skipped";
  status?: number;
  error?: string;
  reason?: "disabled" | "not_active_yet";
}

interface SourceStaticCompatResult {
  source: RtSource;
  sourceRevision?: string;
  requestedRevision?: string;
  revisionMatched?: boolean;
  stale: boolean;
  ageSec?: number;
  summary: {
    entityCount: number;
    referencedTripIds: string[];
    referencedRouteIds: string[];
    referencedStopIds: string[];
    issues: string[];
  };
  compatibility: {
    ok: boolean;
    checked: { tripIds: number; routeIds: number; stopIds: number };
    missing: { tripIds: string[]; routeIds: string[]; stopIds: string[] };
  };
}

interface SourceDraft {
  id: string;
  url: string;
  feedType: RtFeedType;
  pollIntervalSec: string;
  enabled: boolean;
  activeFrom: string;
  stalePolicy: RtStalePolicy;
  gtfsRevision: string;
}

const DEFAULT_DRAFT: SourceDraft = {
  id: "source-1",
  url: "",
  feedType: "service_alerts",
  pollIntervalSec: "30",
  enabled: true,
  activeFrom: "",
  stalePolicy: "warn",
  gtfsRevision: "",
};

const FEED_TYPES: RtFeedType[] = ["service_alerts", "vehicle_positions", "trip_updates", "mixed"];
const STALE_POLICIES: RtStalePolicy[] = ["warn", "serve", "block"];

export function RealtimeSourcesView() {
  const [draft, setDraft] = useState<SourceDraft>(DEFAULT_DRAFT);
  const [sources, setSources] = useState<RtSource[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RtSourceStatus>>({});
  const [lastPoll, setLastPoll] = useState<PollResult | null>(null);
  const [lastPreview, setLastPreview] = useState<Record<string, unknown> | null>(null);
  const [staticZipBase64, setStaticZipBase64] = useState("");
  const [staticZipName, setStaticZipName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceInput = useMemo((): Omit<RtSource, "id"> => {
    return {
      url: draft.url.trim(),
      feedType: draft.feedType,
      pollIntervalSec: Number(draft.pollIntervalSec),
      enabled: draft.enabled,
      ...(draft.activeFrom.trim() ? { activeFrom: draft.activeFrom.trim() } : {}),
      stalePolicy: draft.stalePolicy,
      ...(draft.gtfsRevision.trim() ? { gtfsRevision: draft.gtfsRevision.trim() } : {}),
    };
  }, [draft]);

  const update = useCallback(<K extends keyof SourceDraft>(key: K, value: SourceDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    setStatus("sourceを読み込み中...");
    try {
      const body = await apiJson<{ sources: RtSource[] }>("/rt/sources");
      setSources(body.sources);
      setDraft((current) => ({ ...current, id: nextSourceId(body.sources) }));
      const pairs = await Promise.all(
        body.sources.map(async (source) => {
          try {
            const sourceStatus = await apiJson<RtSourceStatus>(`/rt/sources/${encodeURIComponent(source.id)}/status`);
            return [source.id, sourceStatus] as const;
          } catch {
            return [source.id, undefined] as const;
          }
        }),
      );
      const nextStatuses: Record<string, RtSourceStatus> = {};
      for (const [id, sourceStatus] of pairs) {
        if (sourceStatus) nextStatuses[id] = sourceStatus;
      }
      setStatuses(nextStatuses);
      setStatus(`API同期済み: ${body.sources.length} source`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSave = useCallback(async () => {
    setError(null);
    setStatus(null);
    try {
      if (!draft.id.trim()) throw new Error("source id is required");
      if (!sourceInput.url) throw new Error("url is required");
      if (!Number.isFinite(sourceInput.pollIntervalSec) || sourceInput.pollIntervalSec <= 0) {
        throw new Error("pollIntervalSec must be > 0");
      }
      await apiJson<RtSource>(`/rt/sources/${encodeURIComponent(draft.id.trim())}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sourceInput),
      });
      await refresh();
      setStatus("sourceを保存しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draft.id, refresh, sourceInput]);

  const onPoll = useCallback(async (id: string) => {
    setError(null);
    setStatus(null);
    try {
      const result = await apiJson<PollResult>(`/rt/sources/${encodeURIComponent(id)}/poll`, { method: "POST" });
      setLastPoll(result);
      await refresh();
      setStatus(`poll完了: ${result.outcome}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refresh]);

  const onRemove = useCallback(async (id: string) => {
    setError(null);
    setStatus(null);
    try {
      await apiJson(`/rt/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
      setLastPreview(null);
      await refresh();
      setStatus("sourceを削除しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refresh]);

  const onDownload = useCallback(async (id: string) => {
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/rt/sources/${encodeURIComponent(id)}/feed.pb`);
      if (!response.ok) throw new Error(await response.text());
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { decodeRealtimeFeed, realtimeFeedToObject } = await import("@gtfs-studio/core/realtime");
      setLastPreview(realtimeFeedToObject(decodeRealtimeFeed(bytes)));
      const blob = new Blob([bytes as BlobPart], { type: "application/x-protobuf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}.pb`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const onStaticZip = useCallback(async (file: File) => {
    setStaticZipBase64(bytesToBase64(new Uint8Array(await file.arrayBuffer())));
    setStaticZipName(file.name);
  }, []);

  const onCheckStaticCompat = useCallback(async (source: RtSource) => {
    setError(null);
    setStatus(null);
    if (!staticZipBase64) {
      setError("静的GTFS zipを選択してください");
      return;
    }
    try {
      const body = await apiJson<SourceStaticCompatResult>(
        `/rt/sources/${encodeURIComponent(source.id)}/static-compat/check`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ zipBase64: staticZipBase64, gtfsRevision: source.gtfsRevision }),
        },
      );
      setLastPreview(body as unknown as Record<string, unknown>);
      setStatus(body.compatibility.ok ? "source cached feedは静的GTFSと整合しています" : "source cached feedに欠落参照があります");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [staticZipBase64]);

  return (
    <div className="rt-sources-view">
      <section className="rt-source-form">
        <div className="form-grid">
          <label>
            source ID
            <input value={draft.id} onChange={(e) => update("id", e.target.value)} />
          </label>
          <label>
            feed type
            <select value={draft.feedType} onChange={(e) => update("feedType", e.target.value as RtFeedType)}>
              {FEED_TYPES.map((feedType) => (
                <option key={feedType} value={feedType}>
                  {feedType}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            endpoint URL
            <input value={draft.url} onChange={(e) => update("url", e.target.value)} />
          </label>
          <label>
            poll interval sec
            <input value={draft.pollIntervalSec} onChange={(e) => update("pollIntervalSec", e.target.value)} />
          </label>
          <label>
            active from
            <input value={draft.activeFrom} onChange={(e) => update("activeFrom", e.target.value)} placeholder="Unix秒 or ISO" />
          </label>
          <label>
            enabled
            <select value={String(draft.enabled)} onChange={(e) => update("enabled", e.target.value === "true")}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
          <label>
            stale policy
            <select value={draft.stalePolicy} onChange={(e) => update("stalePolicy", e.target.value as RtStalePolicy)}>
              {STALE_POLICIES.map((policy) => (
                <option key={policy} value={policy}>
                  {policy}
                </option>
              ))}
            </select>
          </label>
          <label>
            GTFS revision
            <input value={draft.gtfsRevision} onChange={(e) => update("gtfsRevision", e.target.value)} />
          </label>
          <label className="wide">
            static GTFS zip for source check
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
        </div>
        <div className="rt-actions">
          <span className="rt-status ok">API: {API_BASE}{staticZipName ? ` / ${staticZipName}` : ""}</span>
          <button onClick={() => void refresh()}>再読込</button>
          <button className="primary" onClick={onSave}>sourceを保存</button>
        </div>
        {status && <div className="rt-info">{status}</div>}
        {error && <div className="rt-error">{error}</div>}
      </section>

      <section className="rt-source-list">
        <h3>RT sources</h3>
        {sources.length === 0 ? (
          <p className="hint">登録済みsourceはありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>type</th>
                <th>status</th>
                <th>policy</th>
                <th>active</th>
                <th>age</th>
                <th>entities</th>
                <th>error</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => {
                const sourceStatus = statuses[source.id];
                return (
                  <tr key={source.id}>
                    <td className="mono">{source.id}</td>
                    <td className="mono">{source.feedType}</td>
                    <td>{sourceStatus ? (sourceStatus.stale ? "stale" : "fresh") : "no data"}</td>
                    <td className="mono">{source.stalePolicy ?? "warn"}</td>
                    <td className="mono">{source.enabled === false ? "disabled" : source.activeFrom ?? "-"}</td>
                    <td className="mono">{sourceStatus?.ageSec === undefined ? "-" : `${sourceStatus.ageSec}s`}</td>
                    <td className="mono">{sourceStatus?.summary?.entityCount ?? sourceStatus?.metrics.entityCount ?? 0}</td>
                    <td>{sourceStatus?.metrics.lastError ?? ""}</td>
                    <td>
                      <div className="rt-row-actions">
                        <button onClick={() => void onPoll(source.id)}>poll</button>
                        <button onClick={() => void onDownload(source.id)}>feed.pb</button>
                        <button onClick={() => void onCheckStaticCompat(source)}>compat</button>
                        <button onClick={() => void onRemove(source.id)}>削除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="rt-preview rt-source-preview">
        <h3>Relay preview</h3>
        {lastPoll && (
          <div className="rt-info">
            poll: {lastPoll.sourceId} / {lastPoll.outcome}
            {lastPoll.reason ? ` / ${lastPoll.reason}` : ""}
            {lastPoll.error ? ` / ${lastPoll.error}` : ""}
          </div>
        )}
        {lastPreview ? (
          <pre>{JSON.stringify(lastPreview, null, 2)}</pre>
        ) : (
          <p className="hint">feed.pb 出力後にdecode結果を表示します。</p>
        )}
      </section>
    </div>
  );
}

function nextSourceId(sources: Array<{ id: string }>): string {
  let n = sources.length + 1;
  const used = new Set(sources.map((source) => source.id));
  while (used.has(`source-${n}`)) n++;
  return `source-${n}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}
