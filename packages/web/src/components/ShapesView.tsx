import { useEffect, useMemo, useRef, useState } from "react";
import { getRows, getTable, setTable, type Feed, type FeedTable } from "@gtfs-studio/core";
import type { MapAdapter } from "../map/adapter";
import { MapLibreAdapter } from "../map/maplibreAdapter";
import { isFallbackBasemap, resolveBasemapStyle } from "../map/style";
import { listRoutes } from "../lib/timetable";

interface Props {
  feed: Feed;
  version: number;
  mutateFeed: (fn: (feed: Feed) => void) => void;
}

const SHAPE_COLUMNS = ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"];
const DEFAULT_CENTER = { lat: 34.7691, lon: 137.3916 };

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

function shapeIds(feed: Feed): string[] {
  return [...new Set(getRows(feed, "shapes").map((row) => row["shape_id"] ?? "").filter((id) => id !== ""))].sort();
}

function shapePoints(feed: Feed, shapeId: string) {
  return getRows(feed, "shapes")
    .filter((row) => (row["shape_id"] ?? "") === shapeId)
    .sort((a, b) => Number(a["shape_pt_sequence"] ?? 0) - Number(b["shape_pt_sequence"] ?? 0));
}

export function ShapesView({ feed, version, mutateFeed }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  const previousLineId = useRef<string | null>(null);
  const fitted = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [selectedShapeId, setSelectedShapeId] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState("");

  const ids = useMemo(() => shapeIds(feed), [feed, version]);
  const effectiveShapeId = selectedShapeId !== "" ? selectedShapeId : (ids[0] ?? "");
  const routes = useMemo(() => listRoutes(feed), [feed, version]);
  const effectiveRouteId = selectedRouteId !== "" ? selectedRouteId : (routes[0]?.routeId ?? "");
  const points = useMemo(
    () => (effectiveShapeId !== "" ? shapePoints(feed, effectiveShapeId) : []),
    [feed, version, effectiveShapeId],
  );

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
        center: { lng: DEFAULT_CENTER.lon, lat: DEFAULT_CENTER.lat },
        zoom: 12,
      })
      .then(() => {
        if (cancelled) return;
        setMapReady(true);
      });

    return () => {
      cancelled = true;
      adapter.destroy();
      adapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    adapterRef.current?.onMapClick((lngLat) => {
      let targetShapeId = effectiveShapeId;
      mutateFeed((f) => {
        const table = ensureTable(f, "shapes", SHAPE_COLUMNS);
        if (targetShapeId === "") targetShapeId = nextId(table.rows, "shape_id", "shape");
        const nextSeq =
          Math.max(
            0,
            ...table.rows
              .filter((row) => (row["shape_id"] ?? "") === targetShapeId)
              .map((row) => Number(row["shape_pt_sequence"] ?? 0))
              .filter(Number.isFinite),
          ) + 1;
        table.rows.push({
          shape_id: targetShapeId,
          shape_pt_lat: lngLat.lat.toFixed(6),
          shape_pt_lon: lngLat.lng.toFixed(6),
          shape_pt_sequence: String(nextSeq),
          shape_dist_traveled: "",
        });
      });
      setSelectedShapeId(targetShapeId);
    });
  }, [mapReady, effectiveShapeId, mutateFeed]);

  useEffect(() => {
    adapterRef.current?.onLineEdit((shapeId, editedPoints) => {
      mutateFeed((f) => {
        const rows = shapePoints(f, shapeId);
        editedPoints.forEach((point, index) => {
          const row = rows[index];
          if (!row) return;
          row["shape_pt_lat"] = point.lat.toFixed(6);
          row["shape_pt_lon"] = point.lng.toFixed(6);
        });
      });
    });
  }, [mapReady, mutateFeed]);

  useEffect(() => {
    if (!mapReady) return;
    const adapter = adapterRef.current;
    if (!adapter) return;

    const markers = getRows(feed, "stops")
      .map((row) => ({
        id: row["stop_id"] ?? "",
        label: row["stop_name"] ?? "",
        lngLat: { lng: Number(row["stop_lon"]), lat: Number(row["stop_lat"]) },
      }))
      .filter((marker) => Number.isFinite(marker.lngLat.lng) && Number.isFinite(marker.lngLat.lat));
    adapter.setMarkers(markers);

    const previous = previousLineId.current;
    if (previous && previous !== effectiveShapeId) adapter.removeLine(previous);
    previousLineId.current = effectiveShapeId || null;

    const linePoints = points
      .map((row) => ({ lng: Number(row["shape_pt_lon"]), lat: Number(row["shape_pt_lat"]) }))
      .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat));
    if (effectiveShapeId !== "" && linePoints.length >= 2) {
      adapter.setLine(effectiveShapeId, linePoints, { editable: true });
    } else if (effectiveShapeId !== "") {
      adapter.removeLine(effectiveShapeId);
    }

    if (!fitted.current && (linePoints.length > 0 || markers.length > 0)) {
      fitted.current = true;
      const all = linePoints.length > 0 ? linePoints : markers.map((marker) => marker.lngLat);
      adapter.flyTo({
        west: Math.min(...all.map((point) => point.lng)),
        east: Math.max(...all.map((point) => point.lng)),
        south: Math.min(...all.map((point) => point.lat)),
        north: Math.max(...all.map((point) => point.lat)),
      });
    }
  }, [mapReady, version, feed, effectiveShapeId, points]);

  const createEmptyShape = () => {
    let id = "";
    mutateFeed((f) => {
      const table = ensureTable(f, "shapes", SHAPE_COLUMNS);
      id = nextId(table.rows, "shape_id", "shape");
      table.rows.push({
        shape_id: id,
        shape_pt_lat: DEFAULT_CENTER.lat.toFixed(6),
        shape_pt_lon: DEFAULT_CENTER.lon.toFixed(6),
        shape_pt_sequence: "1",
        shape_dist_traveled: "",
      });
    });
    setSelectedShapeId(id);
  };

  const createShapeFromRoute = () => {
    if (effectiveRouteId === "") return;
    let id = "";
    mutateFeed((f) => {
      const shapesTable = ensureTable(f, "shapes", SHAPE_COLUMNS);
      const tripsTable = getTable(f, "trips");
      if (!tripsTable) return;
      if (!tripsTable.columns.includes("shape_id")) tripsTable.columns.push("shape_id");
      id = nextId(shapesTable.rows, "shape_id", "shape");

      const tripIds = tripsTable.rows
        .filter((trip) => (trip["route_id"] ?? "") === effectiveRouteId)
        .map((trip) => trip["trip_id"] ?? "")
        .filter((tripId) => tripId !== "");
      const firstTripId = tripIds[0];
      if (!firstTripId) return;

      const stopIds = getRows(f, "stop_times")
        .filter((row) => (row["trip_id"] ?? "") === firstTripId)
        .sort((a, b) => Number(a["stop_sequence"] ?? 0) - Number(b["stop_sequence"] ?? 0))
        .map((row) => row["stop_id"] ?? "");
      const stopsById = new Map(getRows(f, "stops").map((stop) => [stop["stop_id"] ?? "", stop]));
      stopIds.forEach((stopId, index) => {
        const stop = stopsById.get(stopId);
        if (!stop) return;
        shapesTable.rows.push({
          shape_id: id,
          shape_pt_lat: stop["stop_lat"] ?? "",
          shape_pt_lon: stop["stop_lon"] ?? "",
          shape_pt_sequence: String(index + 1),
          shape_dist_traveled: "",
        });
      });
      for (const trip of tripsTable.rows) {
        if ((trip["route_id"] ?? "") === effectiveRouteId) trip["shape_id"] = id;
      }
    });
    if (id !== "") setSelectedShapeId(id);
  };

  const editPoint = (index: number, field: string, value: string) => {
    mutateFeed((f) => {
      const row = shapePoints(f, effectiveShapeId)[index];
      if (row) row[field] = value;
    });
  };

  const deletePoint = (index: number) => {
    mutateFeed((f) => {
      const row = shapePoints(f, effectiveShapeId)[index];
      const table = getTable(f, "shapes");
      if (!row || !table) return;
      const realIndex = table.rows.indexOf(row);
      if (realIndex >= 0) table.rows.splice(realIndex, 1);
      renumberShape(table, effectiveShapeId);
    });
  };

  const insertPointAfter = (index: number) => {
    mutateFeed((f) => {
      const table = ensureTable(f, "shapes", SHAPE_COLUMNS);
      const ordered = shapePoints(f, effectiveShapeId);
      const current = ordered[index];
      if (!current) return;
      const next = ordered[index + 1];
      const lat = midpointOrOffset(current["shape_pt_lat"], next?.["shape_pt_lat"], 0.0005);
      const lon = midpointOrOffset(current["shape_pt_lon"], next?.["shape_pt_lon"], 0.0005);
      table.rows.push({
        shape_id: effectiveShapeId,
        shape_pt_lat: lat,
        shape_pt_lon: lon,
        shape_pt_sequence: String(index + 1.5),
        shape_dist_traveled: "",
      });
      renumberShape(table, effectiveShapeId);
    });
  };

  const movePoint = (index: number, direction: -1 | 1) => {
    mutateFeed((f) => {
      const table = getTable(f, "shapes");
      if (!table) return;
      const ordered = shapePoints(f, effectiveShapeId);
      const current = ordered[index];
      const other = ordered[index + direction];
      if (!current || !other) return;
      const currentSeq = current["shape_pt_sequence"] ?? "";
      current["shape_pt_sequence"] = other["shape_pt_sequence"] ?? "";
      other["shape_pt_sequence"] = currentSeq;
      renumberShape(table, effectiveShapeId);
    });
  };

  const deleteShape = () => {
    const id = effectiveShapeId;
    if (id === "") return;
    mutateFeed((f) => {
      const table = getTable(f, "shapes");
      if (table) table.rows = table.rows.filter((row) => (row["shape_id"] ?? "") !== id);
      for (const trip of getRows(f, "trips")) {
        if ((trip["shape_id"] ?? "") === id) trip["shape_id"] = "";
      }
    });
    adapterRef.current?.removeLine(id);
    setSelectedShapeId("");
  };

  const assignShapeToRoute = () => {
    if (effectiveShapeId === "" || effectiveRouteId === "") return;
    mutateFeed((f) => {
      const table = getTable(f, "trips");
      if (!table) return;
      if (!table.columns.includes("shape_id")) table.columns.push("shape_id");
      for (const trip of table.rows) {
        if ((trip["route_id"] ?? "") === effectiveRouteId) trip["shape_id"] = effectiveShapeId;
      }
    });
  };

  return (
    <div className="shapes-view">
      <section className="shape-editor">
        <div className="toolbar">
          <label>
            shape:{" "}
            <select value={effectiveShapeId} onChange={(e) => setSelectedShapeId(e.target.value)}>
              <option value=""></option>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={createEmptyShape}>
            shape追加
          </button>
          <button type="button" onClick={deleteShape} disabled={effectiveShapeId === ""}>
            shape削除
          </button>
        </div>
        <div className="toolbar">
          <label>
            経路:{" "}
            <select value={effectiveRouteId} onChange={(e) => setSelectedRouteId(e.target.value)}>
              {routes.map((route) => (
                <option key={route.routeId} value={route.routeId}>
                  {route.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={createShapeFromRoute} disabled={effectiveRouteId === ""}>
            停留所列から生成
          </button>
          <button type="button" onClick={assignShapeToRoute} disabled={effectiveRouteId === "" || effectiveShapeId === ""}>
            経路へ割当
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>緯度</th>
                <th>経度</th>
                <th>距離</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {points.map((row, index) => (
                <tr key={`${row["shape_pt_sequence"] ?? ""}-${index}`}>
                  <td className="mono">{row["shape_pt_sequence"] ?? ""}</td>
                  <td>
                    <input className="coord" value={row["shape_pt_lat"] ?? ""} onChange={(e) => editPoint(index, "shape_pt_lat", e.target.value)} />
                  </td>
                  <td>
                    <input className="coord" value={row["shape_pt_lon"] ?? ""} onChange={(e) => editPoint(index, "shape_pt_lon", e.target.value)} />
                  </td>
                  <td>
                    <input className="shape-dist" value={row["shape_dist_traveled"] ?? ""} onChange={(e) => editPoint(index, "shape_dist_traveled", e.target.value)} />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" title="上へ移動" onClick={() => movePoint(index, -1)} disabled={index === 0}>
                        ↑
                      </button>
                      <button type="button" title="下へ移動" onClick={() => movePoint(index, 1)} disabled={index >= points.length - 1}>
                        ↓
                      </button>
                      <button type="button" title="下に頂点を挿入" onClick={() => insertPointAfter(index)}>
                        ＋
                      </button>
                      <button type="button" className="danger" onClick={() => deletePoint(index)}>
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {points.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-row">
                    shape を選択し、地図クリックで頂点を追加できます。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="shape-map-pane">
        <div ref={mapContainer} className="map-container" />
        {isFallbackBasemap() && (
          <div className="map-note">暫定ベースマップ（地理院タイル）。自前基盤の style URL は VITE_MAP_STYLE_URL で注入</div>
        )}
      </section>
    </div>
  );
}

function renumberShape(table: FeedTable, shapeId: string) {
  table.rows
    .filter((row) => (row["shape_id"] ?? "") === shapeId)
    .sort((a, b) => Number(a["shape_pt_sequence"] ?? 0) - Number(b["shape_pt_sequence"] ?? 0))
    .forEach((row, index) => {
      row["shape_pt_sequence"] = String(index + 1);
    });
}

function midpointOrOffset(value: string | undefined, nextValue: string | undefined, fallbackDelta: number): string {
  const current = Number(value);
  const next = Number(nextValue);
  if (Number.isFinite(current) && Number.isFinite(next)) return ((current + next) / 2).toFixed(6);
  if (Number.isFinite(current)) return (current + fallbackDelta).toFixed(6);
  return "";
}
