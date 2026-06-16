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
import { NewFeedView } from "./components/NewFeedView";

/** トップで選ぶ作業モード。`edit` は feed 取込/作成後の編集画面。 */
type View = "home" | "import" | "new" | "rt" | "edit";
type EditTab = "stops" | "timetable" | "validation" | "release";
type ProfileId = "gtfs-jp-v4" | "google-transit-ready" | "gtfs-base" | "gtfs-jp-v3-legacy";

const PROFILE_OPTIONS: { id: ProfileId; label: string }[] = [
  { id: "gtfs-jp-v4", label: "GTFS-JP v4" },
  { id: "google-transit-ready", label: "Google公開" },
  { id: "gtfs-base", label: "GTFS基本" },
  { id: "gtfs-jp-v3-legacy", label: "v3互換" },
];

const HOME_CARDS: { id: View; icon: string; title: string; desc: string }[] = [
  { id: "import", icon: "📦", title: "ZIPインポート", desc: "既存のGTFS zipを読み込んで停留所・ダイヤ・検証・公開ゲートを編集する。" },
  { id: "new", icon: "✏️", title: "新規作成", desc: "事業者・路線・停留所からゼロでGTFS-JP v4フィードを作成する。" },
  { id: "rt", icon: "📡", title: "GTFS-RT", desc: "運行情報（ServiceAlerts）を手動登録し、protobufを生成・配信する。" },
];

export function App() {
  const feedRef = useRef<Feed | null>(null);
  const [version, setVersion] = useState(0); // フィード変更の再描画トリガ
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [view, setView] = useState<View>("home");
  const [editTab, setEditTab] = useState<EditTab>("stops");
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

  const enterEditor = useCallback(
    (feed: Feed, name: string, warnings: string[]) => {
      feedRef.current = feed;
      setFileName(name);
      setImportWarnings(warnings);
      setVersion((v) => v + 1);
      revalidate(feed);
      setEditTab("stops");
      setView("edit");
    },
    [revalidate],
  );

  const onFile = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { feed, warnings } = importGtfsZip(bytes);
      enterEditor(feed, file.name, warnings);
    },
    [enterEditor],
  );

  const onCreateFeed = useCallback(
    (feed: Feed, name: string) => enterEditor(feed, name, []),
    [enterEditor],
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

  const inEditor = view === "edit" && !!feed;

  return (
    <div className="app">
      <header className="header">
        <h1 className="brand" onClick={() => setView("home")}>GTFS Studio</h1>
        {view !== "home" && (
          <button className="home-btn" onClick={() => setView("home")}>
            ← トップ
          </button>
        )}
        <div className="spacer" />
        {inEditor && (
          <>
            {fileName && <span className="filename">{fileName}</span>}
            {badge && (
              <button className={badge.cls} onClick={() => setEditTab("validation")}>
                {badge.text}
              </button>
            )}
            <label className="profile-select">
              <span>検証</span>
              <select value={profileId} onChange={(e) => onProfileChange(e.target.value as ProfileId)}>
                {PROFILE_OPTIONS.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={onDownload}>
              gtfs.zip を出力
            </button>
          </>
        )}
      </header>

      {inEditor && importWarnings.length > 0 && (
        <div className="import-warnings">
          {importWarnings.map((w, i) => (
            <div key={i}>取込警告: {w}</div>
          ))}
        </div>
      )}

      {view === "home" && (
        <main className="home-view">
          <div className="home-inner">
            <h2 className="home-title">どの作業を始めますか？</h2>
            <p className="home-sub">GTFS-JP v4 / GTFS-RT の公開データを、取込・作成・検証・配信します。</p>
            <div className="home-grid">
              {HOME_CARDS.map((card) => (
                <button key={card.id} className="home-card" onClick={() => setView(card.id)}>
                  <span className="home-card-icon">{card.icon}</span>
                  <span className="home-card-title">{card.title}</span>
                  <span className="home-card-desc">{card.desc}</span>
                </button>
              ))}
              {feed && (
                <button className="home-card resume" onClick={() => setView("edit")}>
                  <span className="home-card-icon">↩️</span>
                  <span className="home-card-title">編集に戻る</span>
                  <span className="home-card-desc">{fileName || "読み込み済みのフィード"} の編集を再開する。</span>
                </button>
              )}
            </div>
          </div>
        </main>
      )}

      {view === "import" && (
        <main className="main">
          <div className="import-feed-view">
            <section className="source-panel">
              <h2>ZIPインポート</h2>
              <p>既存のGTFS zip（GTFS-JP含む）を読み込みます。Shift_JISも自動判定で取り込みます。</p>
              <label className="file-btn large">
                GTFS zip を選択
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
              {feed && (
                <button type="button" onClick={() => setView("edit")}>
                  読み込み済みデータを編集
                </button>
              )}
            </section>
          </div>
        </main>
      )}

      {view === "new" && (
        <main className="main">
          <NewFeedView onCreate={onCreateFeed} />
        </main>
      )}

      {view === "rt" && (
        <main className="main">
          <RealtimeAlertsView />
        </main>
      )}

      {inEditor && (
        <>
          <nav className="tabs">
            <button className={editTab === "stops" ? "active" : ""} onClick={() => setEditTab("stops")}>
              停留所
            </button>
            <button className={editTab === "timetable" ? "active" : ""} onClick={() => setEditTab("timetable")}>
              ダイヤ
            </button>
            <button className={editTab === "validation" ? "active" : ""} onClick={() => setEditTab("validation")}>
              検証 {summary ? `(${summary.errors + summary.warnings})` : ""}
            </button>
            <button className={editTab === "release" ? "active" : ""} onClick={() => setEditTab("release")}>
              公開ゲート
            </button>
          </nav>
          <main className="main">
            {editTab === "stops" && <StopsView feed={feed} version={version} mutateFeed={mutateFeed} />}
            {editTab === "timetable" && (
              <TimetableView feed={feed} version={version} mutateFeed={mutateFeed} />
            )}
            {editTab === "validation" && <ValidationView report={report} profileId={profileId} />}
            {editTab === "release" && <ReleaseGateView feed={feed} profileId={profileId} />}
          </main>
        </>
      )}
    </div>
  );
}
