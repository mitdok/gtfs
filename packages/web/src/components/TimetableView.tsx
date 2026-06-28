/**
 * S-08 ダイヤ表（閲覧＋セル編集の最小実装）。
 * 縦=停留所、横=便。同じ停留所列の便をパターンとしてグループ表示する。
 * セル編集は stop_times の arrival/departure を直接更新し、即時再検証される。
 */
import { useMemo, useState } from "react";
import {
  getRows,
  getTable,
  hmsToSec,
  isValidGtfsTime,
  secToHms,
  setTable,
  type Feed,
  type FeedTable,
} from "@gtfs-studio/core";
import { buildPatternGroups, listRoutes } from "../lib/timetable";

interface Props {
  feed: Feed;
  version: number;
  mutateFeed: (fn: (feed: Feed) => void) => void;
}

const TRIP_COLUMNS = ["route_id", "service_id", "trip_id", "trip_headsign"];
const STOP_TIME_COLUMNS = ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"];
const ROUTE_COLUMNS = ["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"];

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

export function TimetableView({ feed, version, mutateFeed }: Props) {
  const routes = useMemo(() => listRoutes(feed), [feed, version]);
  const [routeId, setRouteId] = useState<string>("");
  const [newRouteName, setNewRouteName] = useState("新しい路線");
  const [newTripTime, setNewTripTime] = useState("08:00:00");
  const [newTripHeadsign, setNewTripHeadsign] = useState("");
  const [addError, setAddError] = useState("");
  const effectiveRouteId = routeId !== "" ? routeId : (routes[0]?.routeId ?? "");

  const groups = useMemo(
    () => (effectiveRouteId !== "" ? buildPatternGroups(feed, effectiveRouteId) : []),
    [feed, version, effectiveRouteId],
  );

  const editCell = (rowRef: Record<string, string>, value: string) => {
    mutateFeed(() => {
      // rowRef は feed 内の行オブジェクトそのもの（参照共有）なので直接更新する
      rowRef["arrival_time"] = value;
      rowRef["departure_time"] = value;
    });
  };

  const addRoute = () => {
    let createdId = "";
    mutateFeed((f) => {
      const routesTable = ensureTable(f, "routes", ROUTE_COLUMNS);
      const routeId = nextId(routesTable.rows, "route_id", "R");
      const name = newRouteName.trim() || `新しい路線${routesTable.rows.length + 1}`;
      routesTable.rows.push({
        route_id: routeId,
        agency_id: getRows(f, "agency")[0]?.["agency_id"] ?? "",
        route_short_name: name,
        route_long_name: "",
        route_type: "3",
      });
      createdId = routeId;
    });
    setRouteId(createdId);
    setNewRouteName("新しい路線");
    setAddError("");
  };

  const addTrip = () => {
    const startSec = hmsToSec(newTripTime);
    if (startSec === null) {
      setAddError("開始時刻は HH:MM:SS で入力してください。");
      return;
    }

    const baseStopIds =
      groups[0]?.stopIds ??
      getRows(feed, "stops")
        .map((row) => row["stop_id"] ?? "")
        .filter((id) => id !== "");
    if (baseStopIds.length < 2) {
      setAddError("便を追加するには2件以上の停留所が必要です。");
      return;
    }

    const stopName = new Map(
      getRows(feed, "stops").map((row) => [row["stop_id"] ?? "", row["stop_name"] ?? ""]),
    );
    const headsign = newTripHeadsign.trim() || stopName.get(baseStopIds.at(-1) ?? "") || "新しい便";

    mutateFeed((f) => {
      const tripsTable = ensureTable(f, "trips", TRIP_COLUMNS);
      const stopTimesTable = ensureTable(f, "stop_times", STOP_TIME_COLUMNS);
      const serviceId =
        getRows(f, "calendar")[0]?.["service_id"] ?? getRows(f, "calendar_dates")[0]?.["service_id"] ?? "weekday";
      const tripId = nextId(tripsTable.rows, "trip_id", "T");

      tripsTable.rows.push({
        route_id: effectiveRouteId,
        service_id: serviceId,
        trip_id: tripId,
        trip_headsign: headsign,
      });

      baseStopIds.forEach((stopId, index) => {
        const time = secToHms(startSec + index * 5 * 60);
        stopTimesTable.rows.push({
          trip_id: tripId,
          arrival_time: time,
          departure_time: time,
          stop_id: stopId,
          stop_sequence: String(index + 1),
        });
      });
    });

    setAddError("");
    setNewTripHeadsign("");
    setNewTripTime(secToHms(startSec + 30 * 60));
  };

  if (routes.length === 0) {
    return (
      <div className="timetable-view">
        <div className="toolbar">
          <label>
            路線名:{" "}
            <input
              className="route-draft"
              value={newRouteName}
              onChange={(e) => setNewRouteName(e.target.value)}
            />
          </label>
          <button type="button" onClick={addRoute}>
            路線追加
          </button>
          <span className="hint">routes.txt に経路がありません。</span>
        </div>
      </div>
    );
  }

  return (
    <div className="timetable-view">
      <div className="toolbar">
        <label>
          経路:{" "}
          <select value={effectiveRouteId} onChange={(e) => setRouteId(e.target.value)}>
            {routes.map((r) => (
              <option key={r.routeId} value={r.routeId}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          路線名:{" "}
          <input
            className="route-draft"
            value={newRouteName}
            onChange={(e) => setNewRouteName(e.target.value)}
          />
        </label>
        <button type="button" onClick={addRoute}>
          路線追加
        </button>
        <label>
          開始:{" "}
          <input
            className="time-draft"
            value={newTripTime}
            onChange={(e) => setNewTripTime(e.target.value)}
          />
        </label>
        <label>
          行先:{" "}
          <input
            className="headsign-draft"
            value={newTripHeadsign}
            onChange={(e) => setNewTripHeadsign(e.target.value)}
            placeholder="未入力なら終点名"
          />
        </label>
        <button type="button" onClick={addTrip}>
          便追加
        </button>
        <span className="hint">セルを編集すると即時に再検証されます（時刻は HH:MM:SS、24時超可）</span>
      </div>
      {addError !== "" && <div className="inline-error">{addError}</div>}

      {groups.map((g, gi) => (
        <section key={g.key} className="pattern">
          <h3>
            パターン {gi + 1} <small>({g.stopIds.length}停留所 / {g.trips.length}便)</small>
          </h3>
          <div className="table-scroll">
            <table className="timetable">
              <thead>
                <tr>
                  <th className="sticky">停留所</th>
                  {g.trips.map((t) => (
                    <th key={t.tripId} title={`trip_id: ${t.tripId}\nservice: ${t.serviceId}`}>
                      {t.headsign || t.tripId}
                      <div className="sub">{t.serviceId}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.stopIds.map((stopId, si) => (
                  <tr key={`${stopId}-${si}`}>
                    <td className="sticky stop-name">{g.stopNames[si]}</td>
                    {g.trips.map((t) => {
                      const value = t.times[si] ?? "";
                      const bad = value !== "" && !isValidGtfsTime(value);
                      const rowRef = t.rowRefs[si];
                      return (
                        <td key={t.tripId}>
                          <input
                            className={`time-cell${bad ? " bad" : ""}`}
                            value={value}
                            onChange={(e) => {
                              if (rowRef) editCell(rowRef, e.target.value);
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
