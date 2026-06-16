/**
 * ダイヤ表（S-08）用の派生計算。
 * 内部モデル（生テーブル）から「経路 → 停留所列パターン → 便×時刻の行列」を組み立てる。
 * 同じ停留所列を持つ便をパターンとしてグループ化する（仕様書 03 章の考え方の閲覧版）。
 */
import { getRows, hmsToSec, type Feed } from "@gtfs-studio/core";

export interface RouteOption {
  routeId: string;
  label: string;
}

export interface TimetableTripCol {
  tripId: string;
  headsign: string;
  serviceId: string;
  /** stop_sequence 順の時刻（departure 優先、無ければ arrival） */
  times: string[];
  /** stop_times の元行への参照（編集用; stop_sequence 順） */
  rowRefs: Record<string, string>[];
}

export interface PatternGroup {
  /** 停留所ID列の連結（グループキー） */
  key: string;
  stopIds: string[];
  stopNames: string[];
  trips: TimetableTripCol[];
}

export function listRoutes(feed: Feed): RouteOption[] {
  return getRows(feed, "routes").map((r) => {
    const id = r["route_id"] ?? "";
    const name =
      [r["route_short_name"], r["route_long_name"]].filter((x) => x && x !== "").join(" ") || id;
    return { routeId: id, label: name };
  });
}

export function buildPatternGroups(feed: Feed, routeId: string): PatternGroup[] {
  const stopName = new Map<string, string>();
  for (const s of getRows(feed, "stops")) {
    stopName.set(s["stop_id"] ?? "", s["stop_name"] ?? "");
  }

  const tripsOfRoute = getRows(feed, "trips").filter((t) => (t["route_id"] ?? "") === routeId);
  const tripMeta = new Map(tripsOfRoute.map((t) => [t["trip_id"] ?? "", t]));

  // trip_id -> stop_times（stop_sequence 昇順）
  const byTrip = new Map<string, Record<string, string>[]>();
  for (const row of getRows(feed, "stop_times")) {
    const tid = row["trip_id"] ?? "";
    if (!tripMeta.has(tid)) continue;
    const arr = byTrip.get(tid) ?? [];
    arr.push(row);
    byTrip.set(tid, arr);
  }
  for (const arr of byTrip.values()) {
    arr.sort((a, b) => Number(a["stop_sequence"] ?? 0) - Number(b["stop_sequence"] ?? 0));
  }

  // 停留所列のシグネチャでパターン化
  const groups = new Map<string, PatternGroup>();
  for (const [tid, rows] of byTrip) {
    const stopIds = rows.map((r) => r["stop_id"] ?? "");
    const key = stopIds.join("|");
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        stopIds,
        stopNames: stopIds.map((id) => stopName.get(id) ?? id),
        trips: [],
      };
      groups.set(key, group);
    }
    const meta = tripMeta.get(tid)!;
    group.trips.push({
      tripId: tid,
      headsign: meta["trip_headsign"] ?? "",
      serviceId: meta["service_id"] ?? "",
      times: rows.map((r) => {
        const dep = (r["departure_time"] ?? "").trim();
        return dep !== "" ? dep : (r["arrival_time"] ?? "").trim();
      }),
      rowRefs: rows,
    });
  }

  // 便を先頭時刻順に、パターンを便数の多い順に
  const result = [...groups.values()];
  for (const g of result) {
    g.trips.sort((a, b) => (hmsToSec(a.times[0] ?? "") ?? 0) - (hmsToSec(b.times[0] ?? "") ?? 0));
  }
  result.sort((a, b) => b.trips.length - a.trips.length);
  return result;
}
