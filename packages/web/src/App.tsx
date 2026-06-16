import { useCallback, useMemo, useRef, useState } from "react";
import {
  exportToZip,
  importGtfsZip,
  validateFeed,
  type Feed,
  type ValidationReport,
} from "@gtfs-studio/core";
import { StopsView } from "./components/StopsView";
import { TimetableView } from "./components/TimetableView";
import { ValidationView } from "./components/ValidationView";
import { ReleaseGateView } from "./components/ReleaseGateView";
import { RealtimeAlertsView } from "./components/RealtimeAlertsView";

type Tab = "stops" | "timetable" | "validation" | "release" | "rt-alerts";
type ProfileId = "gtfs-jp-v4" | "google-transit-ready" | "gtfs-base" | "gtfs-jp-v3-legacy";

const PROFILE_OPTIONS: { id: ProfileId; label: string }[] = [
  { id: "gtfs-jp-v4", label: "GTFS-JP v4" },
  { id: "google-transit-ready", label: "Google公開" },
  { id: "gtfs-base", label: "GTFS基本" },
  { id: "gtfs-jp-v3-legacy", label: "v3互換" },
];

export function App() {
  const feedRef = useRef<Feed | null>(null);
  const [version, setVersion] = useState(0); // フィード変更の再描画トリガ
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [tab, setTab] = useState<Tab>("stops");
  const [profileId, setProfileId] = useState<ProfileId>("gtfs-jp-v4");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  const revalidate = useCallback(
    (feed: Feed, nextProfileId = profileId) => {
      setReport(validateFeed(feed, { profileId: nextProfileId }));
    },
    [profileId],
  );

  /** フィードへの変更はすべてこの関数経由（変更→版インクリメント→再検証） */
  const mutateFeed = useCallback(
    (fn: (feed: Feed) => void) => {
      const feed = feedRef.current;
      if (!feed) return;
      fn(feed);
      setVersion((v) => v + 1);
      revalidate(feed);
    },
    [revalidate],
  );

  const onFile = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { feed, warnings } = importGtfsZip(bytes);
      feedRef.current = feed;
      setFileName(file.name);
      setImportWarnings(warnings);
      setVersion((v) => v + 1);
      revalidate(feed);
    },
    [revalidate],
  );

  const onDownload = useCallback(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const bytes = exportToZip(feed, { profileId });
    const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gtfs.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, [profileId]);

  const onProfileChange = useCallback(
    (nextProfileId: ProfileId) => {
      setProfileId(nextProfileId);
      const feed = feedRef.current;
      if (feed) revalidate(feed, nextProfileId);
    },
    [revalidate],
  );

  const feed = feedRef.current;
  const summary = report?.summary;
  const badge = useMemo(() => {
    if (!summary) return null;
    if (summary.errors > 0) return { cls: "badge err", text: `エラー ${summary.errors}` };
    if (summary.warnings > 0) return { cls: "badge warn", text: `警告 ${summary.warnings}` };
    return { cls: "badge ok", text: "検証OK" };
  }, [summary]);

  return (
    <div className="app">
      <header className="header">
        <h1>GTFS Studio</h1>
        <label className="file-btn">
          GTFS zip を開く
          <input
            type="file"
            accept=".zip"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </label>
        {fileName && <span className="filename">{fileName}</span>}
        {badge && (
          <button className={badge.cls} onClick={() => setTab("validation")}>
            {badge.text}
          </button>
        )}
        <div className="spacer" />
        <label className="profile-select">
          <span>検証</span>
          <select
            value={profileId}
            onChange={(e) => onProfileChange(e.target.value as ProfileId)}
          >
            {PROFILE_OPTIONS.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={!feed} onClick={onDownload}>
          gtfs.zip を出力
        </button>
      </header>

      {importWarnings.length > 0 && (
        <div className="import-warnings">
          {importWarnings.map((w, i) => (
            <div key={i}>取込警告: {w}</div>
          ))}
        </div>
      )}

      <nav className="tabs">
        <button className={tab === "stops" ? "active" : ""} onClick={() => setTab("stops")}>
          停留所
        </button>
        <button className={tab === "timetable" ? "active" : ""} onClick={() => setTab("timetable")}>
          ダイヤ
        </button>
        <button className={tab === "validation" ? "active" : ""} onClick={() => setTab("validation")}>
          検証 {summary ? `(${summary.errors + summary.warnings})` : ""}
        </button>
        <button className={tab === "release" ? "active" : ""} onClick={() => setTab("release")}>
          公開ゲート
        </button>
        <button className={tab === "rt-alerts" ? "active" : ""} onClick={() => setTab("rt-alerts")}>
          RT Alert
        </button>
      </nav>

      {!feed && tab !== "rt-alerts" ? (
        <div className="empty">
          <p>GTFS（GTFS-JP）の zip ファイルを開いてください。</p>
          <p className="hint">
            例: 豊鉄バスの公開GTFSデータなど。取込後、停留所の地図編集・ダイヤ表の閲覧編集・検証が行えます。
          </p>
        </div>
      ) : (
        <main className="main">
          {tab === "stops" && feed && (
            <StopsView feed={feed} version={version} mutateFeed={mutateFeed} />
          )}
          {tab === "timetable" &&
            (feed ? (
              <TimetableView feed={feed} version={version} mutateFeed={mutateFeed} />
            ) : (
              <div className="empty">GTFS zip を開いてください。</div>
            ))}
          {tab === "validation" && <ValidationView report={report} profileId={profileId} />}
          {tab === "release" &&
            (feed ? (
              <ReleaseGateView feed={feed} profileId={profileId} />
            ) : (
              <div className="empty">GTFS zip を開いてください。</div>
            ))}
          {tab === "rt-alerts" && <RealtimeAlertsView />}
        </main>
      )}
    </div>
  );
}
