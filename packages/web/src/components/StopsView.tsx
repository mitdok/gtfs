/**
 * S-05 停留所編集（一覧＋地図 連動）。
 * - 左: 停留所テーブル（検索・行クリックで地図ハイライト）
 * - 右: 自前MapLibre地図基盤（地図アダプタ経由・F-10）。選択ピンはドラッグで座標更新。
 * - 座標の真実は数値データ（F-10-5）。lat/lon はテーブル側でも直接編集できる。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getRows, getTable, type Feed } from "@gtfs-studio/core";
import type { MapAdapter } from "../map/adapter";
import { MapLibreAdapter } from "../map/maplibreAdapter";
import { isFallbackBasemap, resolveBasemapStyle } from "../map/style";

interface Props {
  feed: Feed;
  version: number;
  mutateFeed: (fn: (feed: Feed) => void) => void;
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

  const editCoord = (stopId: string, key: "stop_lat" | "stop_lon", value: string) => {
    mutateFeed((f) => {
      for (const row of getRows(f, "stops")) {
        if ((row["stop_id"] ?? "") === stopId) row[key] = value;
      }
    });
  };

  const hasKana = Boolean(getTable(feed, "stops")?.columns.includes("stop_name_kana"));

  return (
    <div className="stops-view">
      <div className="stops-table-pane">
        <input
          className="search"
          placeholder="停留所名・IDで検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>stop_id</th>
                <th>名称</th>
                {hasKana && <th>かな</th>}
                <th>緯度</th>
                <th>経度</th>
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
                    <td>{s["stop_name"]}</td>
                    {hasKana && <td className="kana">{s["stop_name_kana"]}</td>}
                    <td>
                      <input
                        className="coord"
                        value={s["stop_lat"] ?? ""}
                        onChange={(e) => editCoord(id, "stop_lat", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>
                      <input
                        className="coord"
                        value={s["stop_lon"] ?? ""}
                        onChange={(e) => editCoord(id, "stop_lon", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
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
