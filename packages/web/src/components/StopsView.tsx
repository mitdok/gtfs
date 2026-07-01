/**
 * S-05 停留所編集（一覧＋地図 連動）。
 * - 左: 停留所テーブル（検索・行クリックで地図ハイライト）
 * - 右: 自前MapLibre地図基盤（地図アダプタ経由・F-10）。選択ピンはドラッグで座標更新。
 * - 座標の真実は数値データ（F-10-5）。lat/lon はテーブル側でも直接編集できる。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getRows, getTable, setTable, type Feed, type FeedTable } from "@gtfs-studio/core";
import type { MapAdapter } from "../map/adapter";
import { MapLibreAdapter } from "../map/maplibreAdapter";
import { isFallbackBasemap, resolveBasemapStyle } from "../map/style";

interface Props {
  feed: Feed;
  version: number;
  mutateFeed: (fn: (feed: Feed) => void) => void;
}

const DEFAULT_LNG_LAT = { lat: 34.7691, lon: 137.3916 };
const STOP_COLUMNS = ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type"];
const TRANSLATION_COLUMNS = ["table_name", "field_name", "language", "translation", "record_id"];
const TRANSFER_STOP_FIELDS = ["from_stop_id", "to_stop_id"];

function ensureTable(feed: Feed, name: string, columns: string[]): FeedTable {
  const existing = getTable(feed, name);
  if (existing) {
    for (const col of columns) {
      if (!existing.columns.includes(col)) existing.columns.push(col);
    }
    return existing;
  }
  setTable(feed, name, [], columns);
  return getTable(feed, name)!;
}

function nextId(rows: Record<string, string>[], key: string, prefix: string): string {
  const used = new Set(rows.map((row) => row[key] ?? ""));
  for (let n = rows.length + 1; n < rows.length + 10000; n += 1) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Date.now()}`;
}

export function StopsView({ feed, version, mutateFeed }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mapReady, setMapReady] = useState(false);

  const stops = getRows(feed, "stops");
  const filtered = useMemo(() => {
    const q = query.trim();
    if (q === "") return stops;
    return stops.filter(
      (s) => (s["stop_name"] ?? "").includes(q) || (s["stop_id"] ?? "").includes(q),
    );
  }, [stops, query, version]);

  // 地図アダプタ初期化（マウント時に一度）
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
        center: { lng: 137.3916, lat: 34.7691 }, // 豊橋駅付近を既定中心に
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

  // ドラッグ確定 → フィード更新（コールバックは最新の mutateFeed を参照）
  useEffect(() => {
    adapterRef.current?.onMarkerDragEnd((id, lngLat) => {
      mutateFeed((f) => {
        for (const row of getRows(f, "stops")) {
          if ((row["stop_id"] ?? "") === id) {
            row["stop_lat"] = lngLat.lat.toFixed(6);
            row["stop_lon"] = lngLat.lng.toFixed(6);
          }
        }
      });
    });
  }, [mapReady, mutateFeed]);

  // フィード変更 → マーカー反映＋初回は全停留所へフィット
  const fitted = useRef(false);
  useEffect(() => {
    if (!mapReady) return;
    const adapter = adapterRef.current;
    if (!adapter) return;

    const markers = stops
      .map((s) => ({
        id: s["stop_id"] ?? "",
        lngLat: { lng: Number(s["stop_lon"]), lat: Number(s["stop_lat"]) },
        label: s["stop_name"] ?? "",
      }))
      .filter((m) => Number.isFinite(m.lngLat.lng) && Number.isFinite(m.lngLat.lat));
    adapter.setMarkers(markers);

    if (!fitted.current && markers.length > 0) {
      fitted.current = true;
      const lngs = markers.map((m) => m.lngLat.lng);
      const lats = markers.map((m) => m.lngLat.lat);
      adapter.flyTo({
        west: Math.min(...lngs),
        east: Math.max(...lngs),
        south: Math.min(...lats),
        north: Math.max(...lats),
      });
    }
  }, [mapReady, version, stops]);

  // 選択変更 → ハイライト＋移動
  useEffect(() => {
    if (!mapReady) return;
    const adapter = adapterRef.current;
    if (!adapter) return;
    adapter.highlightMarker(selectedId);
    if (selectedId) {
      const s = stops.find((x) => (x["stop_id"] ?? "") === selectedId);
      if (s) {
        const lng = Number(s["stop_lon"]);
        const lat = Number(s["stop_lat"]);
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          adapter.flyTo({ lng, lat }, { zoom: 16 });
        }
      }
    }
  }, [mapReady, selectedId]);

  const editStopField = (
    stopId: string,
    key: "stop_name" | "stop_lat" | "stop_lon" | "stop_name_kana",
    value: string,
  ) => {
    mutateFeed((f) => {
      for (const row of getRows(f, "stops")) {
        if ((row["stop_id"] ?? "") === stopId) row[key] = value;
      }
      if (key === "stop_name") {
        for (const row of getRows(f, "translations")) {
          if (
            (row["table_name"] ?? "") === "stops" &&
            (row["field_name"] ?? "") === "stop_name" &&
            (row["record_id"] ?? "") === stopId
          ) {
            row["translation"] = value;
          }
        }
      }
    });
  };

  const addStop = () => {
    let createdId = "";
    mutateFeed((f) => {
      const stopsTable = ensureTable(f, "stops", STOP_COLUMNS);
      const source =
        (selectedId ? stopsTable.rows.find((row) => (row["stop_id"] ?? "") === selectedId) : undefined) ??
        stopsTable.rows[0];
      const lat = Number(source?.["stop_lat"]);
      const lon = Number(source?.["stop_lon"]);
      const id = nextId(stopsTable.rows, "stop_id", "S");
      const name = `新しい停留所${stopsTable.rows.length + 1}`;
      stopsTable.rows.push({
        stop_id: id,
        stop_name: name,
        stop_lat: (Number.isFinite(lat) ? lat : DEFAULT_LNG_LAT.lat).toFixed(6),
        stop_lon: (Number.isFinite(lon) ? lon : DEFAULT_LNG_LAT.lon).toFixed(6),
        location_type: "0",
      });

      const translationsTable = ensureTable(f, "translations", TRANSLATION_COLUMNS);
      translationsTable.rows.push({
        table_name: "stops",
        field_name: "stop_name",
        language: "ja-Hrkt",
        translation: name,
        record_id: id,
      });
      createdId = id;
    });
    setSelectedId(createdId);
    setQuery("");
  };

  const deleteStop = (stopId: string) => {
    mutateFeed((f) => {
      const stopsTable = getTable(f, "stops");
      if (stopsTable) {
        stopsTable.rows = stopsTable.rows.filter((row) => (row["stop_id"] ?? "") !== stopId);
      }

      const stopTimesTable = getTable(f, "stop_times");
      if (stopTimesTable) {
        stopTimesTable.rows = stopTimesTable.rows.filter((row) => (row["stop_id"] ?? "") !== stopId);
      }

      const translationsTable = getTable(f, "translations");
      if (translationsTable) {
        translationsTable.rows = translationsTable.rows.filter(
          (row) =>
            !(
              (row["table_name"] ?? "") === "stops" &&
              (row["field_name"] ?? "") === "stop_name" &&
              (row["record_id"] ?? "") === stopId
            ),
        );
      }

      const transfersTable = getTable(f, "transfers");
      if (transfersTable) {
        transfersTable.rows = transfersTable.rows.filter((row) =>
          TRANSFER_STOP_FIELDS.every((field) => (row[field] ?? "") !== stopId),
        );
      }

      for (const row of getRows(f, "stops")) {
        if ((row["parent_station"] ?? "") === stopId) row["parent_station"] = "";
      }
    });
    if (selectedId === stopId) setSelectedId(null);
  };

  const moveStop = (stopId: string, direction: -1 | 1) => {
    mutateFeed((f) => {
      const stopsTable = getTable(f, "stops");
      if (!stopsTable) return;
      const index = stopsTable.rows.findIndex((row) => (row["stop_id"] ?? "") === stopId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= stopsTable.rows.length) return;
      const [row] = stopsTable.rows.splice(index, 1);
      if (!row) return;
      stopsTable.rows.splice(nextIndex, 0, row);
    });
  };

  const hasKana = Boolean(getTable(feed, "stops")?.columns.includes("stop_name_kana"));

  return (
    <div className="stops-view">
      <div className="stops-table-pane">
        <div className="table-toolbar">
          <input
            className="search"
            placeholder="停留所名・IDで検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" onClick={addStop}>
            停留所追加
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>stop_id</th>
                <th>名称</th>
                {hasKana && <th>かな</th>}
                <th>緯度</th>
                <th>経度</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const id = s["stop_id"] ?? "";
                return (
                  <tr
                    key={id}
                    className={id === selectedId ? "selected" : ""}
                    onClick={() => setSelectedId(id)}
                  >
                    <td className="mono">{id}</td>
                    <td>
                      <input
                        className="stop-name-input"
                        value={s["stop_name"] ?? ""}
                        onChange={(e) => editStopField(id, "stop_name", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    {hasKana && (
                      <td className="kana">
                        <input
                          className="stop-name-input kana"
                          value={s["stop_name_kana"] ?? ""}
                          onChange={(e) => editStopField(id, "stop_name_kana", e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    )}
                    <td>
                      <input
                        className="coord"
                        value={s["stop_lat"] ?? ""}
                        onChange={(e) => editStopField(id, "stop_lat", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>
                      <input
                        className="coord"
                        value={s["stop_lon"] ?? ""}
                        onChange={(e) => editStopField(id, "stop_lon", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          title="上へ移動"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveStop(id, -1);
                          }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          title="下へ移動"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveStop(id, 1);
                          }}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="danger"
                          title="停留所を削除"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteStop(id);
                          }}
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pane-footer">
          {filtered.length} / {stops.length} 件
          {selectedId && <span>　選択中: 地図のピンをドラッグで移動できます</span>}
        </div>
      </div>
      <div className="stops-map-pane">
        <div ref={mapContainer} className="map-container" />
        {isFallbackBasemap() && (
          <div className="map-note">暫定ベースマップ（地理院タイル）。自前基盤の style URL は VITE_MAP_STYLE_URL で注入</div>
        )}
      </div>
    </div>
  );
}
