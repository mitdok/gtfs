/**
 * S-08 ダイヤ表（閲覧＋セル編集の最小実装）。
 * 縦=停留所、横=便。同じ停留所列の便をパターンとしてグループ表示する。
 * セル編集は stop_times の arrival/departure を直接更新し、即時再検証される。
 */
import { useMemo, useState } from "react";
import { isValidGtfsTime, type Feed } from "@gtfs-studio/core";
import { buildPatternGroups, listRoutes } from "../lib/timetable";

interface Props {
  feed: Feed;
  version: number;
  mutateFeed: (fn: (feed: Feed) => void) => void;
}

export function TimetableView({ feed, version, mutateFeed }: Props) {
  const routes = useMemo(() => listRoutes(feed), [feed, version]);
  const [routeId, setRouteId] = useState<string>("");
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

  if (routes.length === 0) {
    return <div className="empty">routes.txt に経路がありません。</div>;
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
        <span className="hint">セルを編集すると即時に再検証されます（時刻は HH:MM:SS、24時超可）</span>
      </div>

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
