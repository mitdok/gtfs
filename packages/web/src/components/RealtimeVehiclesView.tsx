import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StoredVehiclePosition, VehiclePositionInput } from "@gtfs-studio/core/realtime";
import type { MapAdapter } from "../map/adapter";
import { MapLibreAdapter } from "../map/maplibreAdapter";
import { isFallbackBasemap, resolveBasemapStyle } from "../map/style";
import { API_BASE, apiJson } from "../lib/api";

interface VehicleDraft {
  id: string;
  vehicleId: string;
  label: string;
  latitude: string;
  longitude: string;
  bearing: string;
  speed: string;
  routeId: string;
  tripId: string;
}

interface TripMatchingEvaluation {
  total: number;
  miss: number;
  unique: number;
  ambiguous: number;
  expectedKnown: number;
  expectedMatched: number;
  expectedAccuracy: number | null;
  averageBestTimeDiffSec: number | null;
  maxBestTimeDiffSec: number | null;
  results: Array<{
    probe: Record<string, unknown>;
    bestTripId?: string;
    bestTimeDiffSec?: number;
    matchedExpected?: boolean;
    status: "miss" | "unique" | "ambiguous";
    candidates?: Array<{ trip?: { tripId?: string }; timeDiffSec?: number }>;
  }>;
}

const DEFAULT_DRAFT: VehicleDraft = {
  id: "vehicle-1",
  vehicleId: "bus-1",
  label: "",
  latitude: "34.769100",
  longitude: "137.391600",
  bearing: "",
  speed: "",
  routeId: "",
  tripId: "",
};

export function RealtimeVehiclesView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [draft, setDraft] = useState<VehicleDraft>(DEFAULT_DRAFT);
  const [vehicles, setVehicles] = useState<StoredVehiclePosition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastPreview, setLastPreview] = useState<unknown | null>(null);
  const [tripUpdatePreview, setTripUpdatePreview] = useState<unknown | null>(null);
  const [matchEvaluation, setMatchEvaluation] = useState<TripMatchingEvaluation | null>(null);
  const [gtfsZipBase64, setGtfsZipBase64] = useState<string>("");
  const [gtfsZipName, setGtfsZipName] = useState<string>("");
  const [tripUpdateAtTime, setTripUpdateAtTime] = useState("07:05:00");
  const [tripUpdateDelaySec, setTripUpdateDelaySec] = useState("60");
  const [matchProbeJson, setMatchProbeJson] = useState(
    '[{"routeId":"R1","atTime":"07:05:00","expectedTripId":"T1","maxTimeDiffSec":1800}]',
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const input = useMemo((): VehiclePositionInput => {
    return {
      id: draft.id.trim(),
      vehicleId: draft.vehicleId.trim(),
      ...(draft.label.trim() ? { label: draft.label.trim() } : {}),
      latitude: Number(draft.latitude),
      longitude: Number(draft.longitude),
      ...(draft.bearing.trim() ? { bearing: Number(draft.bearing) } : {}),
      ...(draft.speed.trim() ? { speed: Number(draft.speed) } : {}),
      ...(draft.routeId.trim() ? { routeId: draft.routeId.trim() } : {}),
      ...(draft.tripId.trim() ? { tripId: draft.tripId.trim() } : {}),
      timestamp: new Date(),
    };
  }, [draft]);

  const update = useCallback(<K extends keyof VehicleDraft>(key: K, value: VehicleDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const fetchVehicles = useCallback(async () => {
    setError(null);
    setStatus("車両位置を読み込み中...");
    try {
      const body = await apiJson<{ vehicles: StoredVehiclePosition[] }>("/rt/vehicles");
      setVehicles(body.vehicles);
      setDraft((current) => ({ ...current, id: nextVehicleId(body.vehicles) }));
      setStatus(`API同期済み: ${body.vehicles.length}台`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("APIから車両位置を読み込めませんでした");
    }
  }, []);

  useEffect(() => {
    void fetchVehicles();
  }, [fetchVehicles]);

  useEffect(() => {
    const container = mapContainer.current;
    if (!container) return;
    const adapter = new MapLibreAdapter();
    adapterRef.current = adapter;
    let cancelled = false;

    void adapter
      .init({
        container,
        style: resolveBasemapStyle(),
        center: { lng: 137.3916, lat: 34.7691 },
        zoom: 12,
      })
      .then(() => {
        if (cancelled) return;
        adapter.onMarkerClick((id) => setSelectedId(id));
        setMapReady(true);
      });

    return () => {
      cancelled = true;
      adapter.destroy();
      adapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const adapter = adapterRef.current;
    if (!adapter) return;
    const markers = vehicles
      .map((vehicle) => ({
        id: vehicle.id,
        label: vehicle.label ?? vehicle.vehicleId,
        lngLat: { lng: vehicle.longitude, lat: vehicle.latitude },
      }))
      .filter((marker) => Number.isFinite(marker.lngLat.lng) && Number.isFinite(marker.lngLat.lat));
    adapter.setMarkers(markers);
    if (!fittedRef.current && markers.length > 0) {
      fittedRef.current = true;
      const lngs = markers.map((marker) => marker.lngLat.lng);
      const lats = markers.map((marker) => marker.lngLat.lat);
      adapter.flyTo({
        west: Math.min(...lngs),
        east: Math.max(...lngs),
        south: Math.min(...lats),
        north: Math.max(...lats),
      });
    }
  }, [mapReady, vehicles]);

  useEffect(() => {
    if (!mapReady) return;
    const adapter = adapterRef.current;
    if (!adapter) return;
    adapter.highlightMarker(selectedId);
    const vehicle = vehicles.find((current) => current.id === selectedId);
    if (vehicle) adapter.flyTo({ lng: vehicle.longitude, lat: vehicle.latitude }, { zoom: 15 });
  }, [mapReady, selectedId, vehicles]);

  const onSave = useCallback(async () => {
    setError(null);
    setStatus(null);
    try {
      const saved = await apiJson<StoredVehiclePosition>("/rt/vehicles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const nextVehicles = upsertVehicle(vehicles, saved);
      setVehicles(nextVehicles);
      setSelectedId(saved.id);
      setDraft((current) => ({ ...current, id: nextVehicleId(nextVehicles) }));
      setStatus("車両位置を保存しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [input, vehicles]);

  const onRemove = useCallback(async (id: string) => {
    setError(null);
    setStatus(null);
    try {
      await apiJson(`/rt/vehicles/${encodeURIComponent(id)}`, { method: "DELETE" });
      setVehicles((current) => current.filter((vehicle) => vehicle.id !== id));
      if (selectedId === id) setSelectedId(null);
      setStatus("車両位置を削除しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedId]);

  const onDownload = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/rt/vehicles.pb`);
      if (!response.ok) throw new Error(await response.text());
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { decodeRealtimeFeed, realtimeFeedToObject } = await import("@gtfs-studio/core/realtime");
      setLastPreview(realtimeFeedToObject(decodeRealtimeFeed(bytes)));
      const blob = new Blob([bytes as BlobPart], { type: "application/x-protobuf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vehicles.pb";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const onGtfsZip = useCallback(async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    setGtfsZipBase64(bytesToBase64(bytes));
    setGtfsZipName(file.name);
  }, []);

  const onProbeFile = useCallback(async (file: File) => {
    const text = await file.text();
    const probes = file.name.toLowerCase().endsWith(".csv") ? parseProbeCsv(text) : JSON.parse(text);
    if (!Array.isArray(probes)) throw new Error("probe file must contain an array");
    setMatchProbeJson(JSON.stringify(probes, null, 2));
    setStatus(`probeを読み込みました: ${file.name} / ${probes.length}件`);
  }, []);

  const onGenerateTripUpdate = useCallback(async () => {
    setError(null);
    setStatus(null);
    if (!selectedId) {
      setError("TripUpdateを生成する車両を選択してください");
      return;
    }
    if (!gtfsZipBase64) {
      setError("静的GTFS zipを選択してください");
      return;
    }
    try {
      const body = await apiJson<Record<string, unknown>>(`/rt/vehicles/${encodeURIComponent(selectedId)}/trip-update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          zipBase64: gtfsZipBase64,
          atTime: tripUpdateAtTime,
          delaySec: Number(tripUpdateDelaySec),
          save: true,
        }),
      });
      setTripUpdatePreview(body);
      setMatchEvaluation(null);
      setStatus("TripUpdateを生成して保存しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [gtfsZipBase64, selectedId, tripUpdateAtTime, tripUpdateDelaySec]);

  const onEvaluateTripMatching = useCallback(async () => {
    setError(null);
    setStatus(null);
    if (!gtfsZipBase64) {
      setError("静的GTFS zipを選択してください");
      return;
    }
    let probes: unknown;
    try {
      probes = JSON.parse(matchProbeJson);
    } catch (e) {
      setError(`probe JSONを解析できません: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!Array.isArray(probes)) {
      setError("probe JSONは配列で入力してください");
      return;
    }
    try {
      const body = await apiJson<TripMatchingEvaluation>("/rt/trip-matching/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zipBase64: gtfsZipBase64, probes }),
      });
      setTripUpdatePreview(body);
      setMatchEvaluation(body);
      setStatus(`trip候補品質を評価しました: total ${body.total} / miss ${body.miss} / ambiguous ${body.ambiguous}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [gtfsZipBase64, matchProbeJson]);

  const onDownloadMatchJson = useCallback(() => {
    if (!matchEvaluation) return;
    downloadText("trip-matching-evaluation.json", JSON.stringify(matchEvaluation, null, 2), "application/json");
  }, [matchEvaluation]);

  const onDownloadMatchCsv = useCallback(() => {
    if (!matchEvaluation) return;
    const rows = [
      ["status", "routeId", "serviceId", "directionId", "atTime", "atStopId", "expectedTripId", "bestTripId", "bestTimeDiffSec", "matchedExpected", "candidateCount"],
      ...matchEvaluation.results.map((result) => [
        result.status,
        stringCell(result.probe.routeId),
        stringCell(result.probe.serviceId),
        stringCell(result.probe.directionId),
        stringCell(result.probe.atTime),
        stringCell(result.probe.atStopId),
        stringCell(result.probe.expectedTripId),
        result.bestTripId ?? "",
        result.bestTimeDiffSec ?? "",
        result.matchedExpected ?? "",
        result.candidates?.length ?? 0,
      ]),
    ];
    downloadText("trip-matching-evaluation.csv", rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv");
  }, [matchEvaluation]);

  return (
    <div className="rt-vehicles-view">
      <section className="rt-vehicle-side">
        <div className="form-grid">
          <label>
            position ID
            <input value={draft.id} onChange={(e) => update("id", e.target.value)} />
          </label>
          <label>
            vehicle_id
            <input value={draft.vehicleId} onChange={(e) => update("vehicleId", e.target.value)} />
          </label>
          <label>
            label
            <input value={draft.label} onChange={(e) => update("label", e.target.value)} />
          </label>
          <label>
            route_id
            <input value={draft.routeId} onChange={(e) => update("routeId", e.target.value)} />
          </label>
          <label>
            trip_id
            <input value={draft.tripId} onChange={(e) => update("tripId", e.target.value)} />
          </label>
          <label>
            bearing
            <input value={draft.bearing} onChange={(e) => update("bearing", e.target.value)} />
          </label>
          <label>
            latitude
            <input value={draft.latitude} onChange={(e) => update("latitude", e.target.value)} />
          </label>
          <label>
            longitude
            <input value={draft.longitude} onChange={(e) => update("longitude", e.target.value)} />
          </label>
          <label>
            speed m/s
            <input value={draft.speed} onChange={(e) => update("speed", e.target.value)} />
          </label>
        </div>
        <div className="rt-actions">
          <span className="rt-status ok">API: {API_BASE}</span>
          <button onClick={() => void fetchVehicles()}>再読込</button>
          <button onClick={onSave}>位置を保存</button>
          <button className="primary" onClick={onDownload}>
            vehicles.pb を出力
          </button>
        </div>
        {status && <div className="rt-info">{status}</div>}
        {error && <div className="rt-error">{error}</div>}

        <div className="rt-vehicle-trip-update">
          <h3>TripUpdate生成</h3>
          <div className="form-grid">
            <label className="wide">
              static GTFS zip
              <input
                type="file"
                accept=".zip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onGtfsZip(file);
                  e.target.value = "";
                }}
              />
            </label>
            <label>
              at_time
              <input value={tripUpdateAtTime} onChange={(e) => setTripUpdateAtTime(e.target.value)} />
            </label>
            <label>
              delay sec
              <input value={tripUpdateDelaySec} onChange={(e) => setTripUpdateDelaySec(e.target.value)} />
            </label>
          </div>
          <div className="rt-actions">
            <span className="rt-status">{selectedId ? `vehicle: ${selectedId}` : "車両未選択"} {gtfsZipName ? `/ ${gtfsZipName}` : ""}</span>
            <button onClick={onGenerateTripUpdate}>TripUpdate保存</button>
          </div>
          <div className="rt-match-eval">
            <label>
              trip候補probe JSON
              <textarea value={matchProbeJson} onChange={(e) => setMatchProbeJson(e.target.value)} rows={4} />
            </label>
            <label>
              probe JSON/CSV
              <input
                type="file"
                accept=".json,.csv,application/json,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onProbeFile(file).catch((err) => setError(err instanceof Error ? err.message : String(err)));
                  e.target.value = "";
                }}
              />
            </label>
            <div className="rt-actions">
              <button onClick={onEvaluateTripMatching}>候補品質を評価</button>
              <button onClick={onDownloadMatchJson} disabled={!matchEvaluation}>JSON出力</button>
              <button onClick={onDownloadMatchCsv} disabled={!matchEvaluation}>CSV出力</button>
            </div>
          </div>
        </div>

        <div className="rt-vehicle-list">
          <h3>最新車両位置</h3>
          {vehicles.length === 0 ? (
            <p className="hint">登録済みの車両位置はありません。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>車両</th>
                  <th>route/trip</th>
                  <th>age</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((vehicle) => (
                  <tr
                    key={vehicle.id}
                    className={vehicle.id === selectedId ? "selected" : ""}
                    onClick={() => setSelectedId(vehicle.id)}
                  >
                    <td className="mono">{vehicle.id}</td>
                    <td>{vehicle.label ?? vehicle.vehicleId}</td>
                    <td className="mono">{[vehicle.routeId, vehicle.tripId].filter(Boolean).join(" / ") || "-"}</td>
                    <td className="mono">{ageLabel(vehicle.timestamp ?? vehicle.receivedAt)}</td>
                    <td>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        void onRemove(vehicle.id);
                      }}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="rt-vehicle-map-pane">
        <div ref={mapContainer} className="map-container" />
        {isFallbackBasemap() && (
          <div className="map-note">暫定ベースマップ（地理院タイル）。自前基盤の style URL は VITE_MAP_STYLE_URL で注入</div>
        )}
      </section>

      <section className="rt-preview rt-vehicle-preview">
        <h3>VehiclePositions preview</h3>
        {matchEvaluation ? (
          <div className="rt-match-results">
            <div className="rt-match-summary">
              <div><strong>{matchEvaluation.total}</strong><span>total</span></div>
              <div><strong>{matchEvaluation.unique}</strong><span>unique</span></div>
              <div><strong>{matchEvaluation.ambiguous}</strong><span>ambiguous</span></div>
              <div><strong>{matchEvaluation.miss}</strong><span>miss</span></div>
              <div><strong>{percentLabel(matchEvaluation.expectedAccuracy)}</strong><span>accuracy</span></div>
              <div><strong>{numberLabel(matchEvaluation.averageBestTimeDiffSec)}</strong><span>avg diff sec</span></div>
            </div>
            <div className="rt-match-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>status</th>
                    <th>route</th>
                    <th>at</th>
                    <th>stop</th>
                    <th>expected</th>
                    <th>best</th>
                    <th>diff</th>
                    <th>candidates</th>
                  </tr>
                </thead>
                <tbody>
                  {matchEvaluation.results.slice(0, 100).map((result, index) => (
                    <tr key={index} className={`rt-match-${result.status}`}>
                      <td>{result.status}</td>
                      <td className="mono">{stringCell(result.probe.routeId) || "-"}</td>
                      <td className="mono">{stringCell(result.probe.atTime) || "-"}</td>
                      <td className="mono">{stringCell(result.probe.atStopId) || "-"}</td>
                      <td className="mono">{stringCell(result.probe.expectedTripId) || "-"}</td>
                      <td className="mono">{result.bestTripId ?? "-"}</td>
                      <td className="mono">{result.bestTimeDiffSec ?? "-"}</td>
                      <td className="mono">{result.candidates?.length ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {matchEvaluation.results.length > 100 && (
              <p className="hint">先頭100件のみ表示しています。全件はCSV/JSON出力で確認できます。</p>
            )}
          </div>
        ) : tripUpdatePreview || lastPreview ? (
          <pre>{JSON.stringify(tripUpdatePreview ?? lastPreview, null, 2)}</pre>
        ) : (
          <p className="hint">vehicles.pb 出力またはTripUpdate生成後に結果を表示します。</p>
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

function parseProbeCsv(text: string): Array<Record<string, string | number>> {
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  const [header, ...body] = rows;
  if (!header || header.length === 0) return [];
  return body.map((row) => {
    const probe: Record<string, string | number> = {};
    header.forEach((name, index) => {
      const key = name.trim();
      const raw = row[index]?.trim() ?? "";
      if (!key || raw === "") return;
      probe[key] = ["directionId", "maxTimeDiffSec"].includes(key) ? Number(raw) : raw;
    });
    return probe;
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function stringCell(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function percentLabel(value: number | null): string {
  return value === null ? "-" : `${Math.round(value * 1000) / 10}%`;
}

function numberLabel(value: number | null): string {
  return value === null ? "-" : String(Math.round(value * 10) / 10);
}

function upsertVehicle(vehicles: StoredVehiclePosition[], vehicle: StoredVehiclePosition): StoredVehiclePosition[] {
  const next = vehicles.filter((current) => current.id !== vehicle.id);
  next.push(vehicle);
  return next.sort((a, b) => a.id.localeCompare(b.id));
}

function nextVehicleId(vehicles: Array<{ id: string }>): string {
  let n = vehicles.length + 1;
  const used = new Set(vehicles.map((vehicle) => vehicle.id));
  while (used.has(`vehicle-${n}`)) n++;
  return `vehicle-${n}`;
}

function ageLabel(value: number | string | Date | undefined): string {
  if (!value) return "-";
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(ms)) return "-";
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h`;
}
