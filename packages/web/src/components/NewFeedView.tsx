import { useCallback, useMemo, useState } from "react";
import type { Feed } from "@gtfs-studio/core";
import { createGtfsJpV4StarterFeed } from "@gtfs-studio/core";

interface Props {
  onCreate: (feed: Feed, name: string) => void;
}

interface DraftStop {
  stopName: string;
  stopNameKana: string;
  stopLat: string;
  stopLon: string;
}

export interface Draft {
  feedName: string;
  agencyName: string;
  agencyUrl: string;
  routeLongName: string;
  routeShortName: string;
  feedStartDate: string;
  feedEndDate: string;
  firstDepartureTime: string;
  stops: DraftStop[];
}

function formatGtfsDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function createDefaultDraft(now = new Date()): Draft {
  const end = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  return {
    feedName: "新規GTFS-JP v4",
    agencyName: "",
    agencyUrl: "",
    routeLongName: "",
    routeShortName: "",
    feedStartDate: formatGtfsDate(now),
    feedEndDate: formatGtfsDate(end),
    firstDepartureTime: "07:00:00",
    stops: [
      { stopName: "", stopNameKana: "", stopLat: "", stopLon: "" },
      { stopName: "", stopNameKana: "", stopLat: "", stopLon: "" },
    ],
  };
}

export function NewFeedView({ onCreate }: Props) {
  const [draft, setDraft] = useState<Draft>(() => createDefaultDraft());
  const [error, setError] = useState<string | null>(null);

  const canCreate = useMemo(
    () =>
      draft.agencyName.trim() !== "" &&
      draft.agencyUrl.trim() !== "" &&
      draft.routeLongName.trim() !== "" &&
      draft.feedStartDate.trim() !== "" &&
      draft.feedEndDate.trim() !== "" &&
      draft.stops.filter((stop) => stop.stopName.trim() !== "").length >= 2,
    [draft],
  );

  const update = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const updateStop = useCallback(<K extends keyof DraftStop>(index: number, key: K, value: DraftStop[K]) => {
    setDraft((current) => ({
      ...current,
      stops: current.stops.map((stop, i) => (i === index ? { ...stop, [key]: value } : stop)),
    }));
  }, []);

  const addStop = useCallback(() => {
    setDraft((current) => ({
      ...current,
      stops: [
        ...current.stops,
        { stopName: "", stopNameKana: "", stopLat: "", stopLon: "" },
      ],
    }));
  }, []);

  const removeStop = useCallback((index: number) => {
    setDraft((current) => ({ ...current, stops: current.stops.filter((_, i) => i !== index) }));
  }, []);

  const create = useCallback(() => {
    setError(null);
    try {
      const feed = createGtfsJpV4StarterFeed({
        agencyName: draft.agencyName,
        agencyUrl: draft.agencyUrl,
        routeLongName: draft.routeLongName,
        routeShortName: draft.routeShortName,
        feedStartDate: draft.feedStartDate,
        feedEndDate: draft.feedEndDate,
        firstDepartureTime: draft.firstDepartureTime,
        stops: draft.stops
          .filter((stop) => stop.stopName.trim() !== "")
          .map((stop) => ({
            stopName: stop.stopName,
            stopNameKana: stop.stopNameKana,
            stopLat: stop.stopLat,
            stopLon: stop.stopLon,
          })),
      });
      onCreate(feed, draft.feedName.trim() || "新規GTFS-JP v4");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draft, onCreate]);

  return (
    <div className="new-feed-view">
      <section className="new-feed-main">
        <div className="source-panel-title">
          <h2>新規GTFSを作成</h2>
          <p>事業者、路線、停留所、運行期間から最小GTFS-JP v4を作成します。</p>
        </div>
        <div className="form-grid">
          <label>
            データ名
            <input value={draft.feedName} onChange={(e) => update("feedName", e.target.value)} />
          </label>
          <label>
            事業者名
            <input
              value={draft.agencyName}
              placeholder="○○交通"
              onChange={(e) => update("agencyName", e.target.value)}
            />
          </label>
          <label className="wide">
            事業者URL
            <input
              type="url"
              value={draft.agencyUrl}
              placeholder="https://example.jp"
              onChange={(e) => update("agencyUrl", e.target.value)}
            />
          </label>
          <label>
            路線番号
            <input
              value={draft.routeShortName}
              placeholder="1"
              onChange={(e) => update("routeShortName", e.target.value)}
            />
          </label>
          <label>
            路線名
            <input
              value={draft.routeLongName}
              placeholder="○○線"
              onChange={(e) => update("routeLongName", e.target.value)}
            />
          </label>
          <label>
            開始日
            <input value={draft.feedStartDate} onChange={(e) => update("feedStartDate", e.target.value)} />
          </label>
          <label>
            終了日
            <input value={draft.feedEndDate} onChange={(e) => update("feedEndDate", e.target.value)} />
          </label>
          <label>
            先頭発時刻
            <input
              value={draft.firstDepartureTime}
              onChange={(e) => update("firstDepartureTime", e.target.value)}
            />
          </label>
        </div>

        <div className="new-feed-stops">
          <div className="section-toolbar">
            <h3>停留所</h3>
            <button onClick={addStop}>追加</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>読み</th>
                <th>緯度</th>
                <th>経度</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draft.stops.map((stop, index) => (
                <tr key={index}>
                  <td>
                    <input
                      aria-label={`停留所${index + 1} 名称`}
                      placeholder="○○駅"
                      value={stop.stopName}
                      onChange={(e) => updateStop(index, "stopName", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={stop.stopNameKana}
                      aria-label={`停留所${index + 1} 読み`}
                      onChange={(e) => updateStop(index, "stopNameKana", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`停留所${index + 1} 緯度`}
                      placeholder="35.681236"
                      value={stop.stopLat}
                      onChange={(e) => updateStop(index, "stopLat", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`停留所${index + 1} 経度`}
                      placeholder="139.767125"
                      value={stop.stopLon}
                      onChange={(e) => updateStop(index, "stopLon", e.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      aria-label={`停留所${index + 1}を削除`}
                      disabled={draft.stops.length <= 2}
                      onClick={() => removeStop(index)}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="new-feed-actions">
          {error && <div className="rt-error">{error}</div>}
          <button className="primary" disabled={!canCreate} onClick={create}>
            新規GTFS-JP v4を作成
          </button>
        </div>
      </section>
    </div>
  );
}
