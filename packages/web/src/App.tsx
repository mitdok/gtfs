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

type Tab = "stops" | "timetable" | "validation";

export function App() {
  const feedRef = useRef<Feed | null>(null);
  const [version, setVersion] = useState(0); // フィード変更の再描画トリガ
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [tab, setTab] = useState<Tab>("stops");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  const revalidate = useCallback((feed: Feed) => {
    setReport(validateFeed(feed, { profileId: "gtfs-jp-v4" }));
  }, []);

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
    const bytes = exportToZip(feed);
    const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gtfs.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

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

      {!feed ? (
        <div className="empty">
          <p>GTFS（GTFS-JP）の zip ファイルを開いてください。</p>
          <p className="hint">
            例: 豊鉄バスの公開GTFSデータなど。取込後、停留所の地図編集・ダイヤ表の閲覧編集・検証が行えます。
          </p>
        </div>
      ) : (
        <>
          <nav className="tabs">
            <button className={tab === "stops" ? "active" : ""} onClick={() => setTab("stops")}>
              停留所
            </button>
            <button
              className={tab === "timetable" ? "active" : ""}
              onClick={() => setTab("timetable")}
            >
              ダイヤ
            </button>
            <button
              className={tab === "validation" ? "active" : ""}
              onClick={() => setTab("validation")}
            >
              検証 {summary ? `(${summary.errors + summary.warnings})` : ""}
            </button>
          </nav>
          <main className="main">
            {tab === "stops" && <StopsView feed={feed} version={version} mutateFeed={mutateFeed} />}
            {tab === "timetable" && (
              <TimetableView feed={feed} version={version} mutateFeed={mutateFeed} />
            )}
            {tab === "validation" && <ValidationView report={report} />}
          </main>
        </>
      )}
    </div>
  );
}
