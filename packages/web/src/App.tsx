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
import { RealtimeView } from "./components/RealtimeView";
import { NewFeedView } from "./components/NewFeedView";
import { FaresView } from "./components/FaresView";
import { ShapesView } from "./components/ShapesView";
import { MetadataView } from "./components/MetadataView";
import { API_BASE, apiJson } from "./lib/api";

/** トップで選ぶ作業モード。`edit` は feed 取込/作成後の編集画面。 */
type View = "home" | "import" | "new" | "rt" | "edit";
type EditTab = "metadata" | "stops" | "timetable" | "fares" | "shapes" | "validation" | "release";
type ProfileId = "gtfs-jp-v4" | "google-transit-ready" | "gtfs-base" | "gtfs-jp-v3-legacy";
type ApiRevisionStatusFilter = "all" | "validated" | "published" | "superseded";

interface ApiRevisionItem {
  id: string;
  status: string;
  createdAt: string;
  publishedAt?: string;
  profileId?: string;
  acceptance?: { status?: string };
  gate?: { status?: string };
  zipSha256?: string;
}

interface ApiRevisionDetail extends ApiRevisionItem {
  updatedAt?: string;
  zipBytes?: number;
  releaseCandidate?: string;
  acceptance?: { status?: string; checks?: { status: string }[] };
  gate?: { status?: string; blockers?: { code: string; message: string }[] };
  validation?: {
    gtfsJpV4?: { errors: number; warnings: number };
    googleTransitReady?: { errors: number; warnings: number };
  };
  warningApprovals?: unknown[];
}

interface ApiRevisionListResponse {
  revisions: ApiRevisionItem[];
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  statusCounts?: Record<"validated" | "published" | "superseded", number>;
}

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
  const [importError, setImportError] = useState("");
  const [apiProjectId, setApiProjectId] = useState("demo");
  const [apiRevisionId, setApiRevisionId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [apiImportStatus, setApiImportStatus] = useState("");
  const [apiRevisions, setApiRevisions] = useState<ApiRevisionItem[]>([]);
  const [apiRevisionLimit, setApiRevisionLimit] = useState(20);
  const [apiRevisionTotal, setApiRevisionTotal] = useState<number | null>(null);
  const [apiRevisionStatus, setApiRevisionStatus] = useState<ApiRevisionStatusFilter>("all");
  const [apiRevisionOffset, setApiRevisionOffset] = useState(0);
  const [apiRevisionHasMore, setApiRevisionHasMore] = useState(false);
  const [apiRevisionStatusCounts, setApiRevisionStatusCounts] = useState<ApiRevisionListResponse["statusCounts"] | null>(null);
  const [apiRevisionDetail, setApiRevisionDetail] = useState<ApiRevisionDetail | null>(null);
  const [apiRevisionDetailStatus, setApiRevisionDetailStatus] = useState("");

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
      try {
        setImportError("");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { feed, warnings } = importGtfsZip(bytes);
        setApiRevisionId("");
        enterEditor(feed, file.name, warnings);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setImportError(`ZIPを読み込めませんでした: ${message}`);
      }
    },
    [enterEditor],
  );

  const onCreateFeed = useCallback(
    (feed: Feed, name: string) => {
      setApiRevisionId("");
      enterEditor(feed, name, []);
    },
    [enterEditor],
  );

  const onApiRevision = useCallback(async () => {
    const projectId = apiProjectId.trim();
    const revisionId = apiRevisionId.trim();
    if (projectId === "") {
      setApiImportStatus("project ID を入力してください。");
      return;
    }
    const path =
      revisionId === ""
        ? `/projects/${encodeURIComponent(projectId)}/latest/gtfs.zip`
        : `/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/gtfs.zip`;
    try {
      setApiImportStatus("APIからGTFS zipを読み込み中...");
      const headers: HeadersInit = {};
      if (apiToken.trim() !== "") headers.authorization = `Bearer ${apiToken.trim()}`;
      const response = await fetch(`${API_BASE}${path}`, { headers });
      if (!response.ok) throw new Error(await response.text());
      const loadedRevisionId = response.headers.get("x-gtfs-revision") ?? revisionId;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { feed, warnings } = importGtfsZip(bytes);
      if (loadedRevisionId !== "") setApiRevisionId(loadedRevisionId);
      enterEditor(
        feed,
        loadedRevisionId === "" ? `${projectId}:latest` : `${projectId}:${loadedRevisionId}`,
        warnings,
      );
      setApiImportStatus("");
    } catch (e) {
      setApiImportStatus(`API読込エラー: ${(e as Error).message}`);
    }
  }, [apiProjectId, apiRevisionId, apiToken, enterEditor]);

  const loadApiRevisionList = useCallback(async (nextOffset: number, nextStatus = apiRevisionStatus) => {
    const projectId = apiProjectId.trim();
    if (projectId === "") {
      setApiImportStatus("project ID を入力してください。");
      return;
    }
    try {
      setApiImportStatus("revision一覧を読み込み中...");
      const limit = Math.max(1, Math.min(500, Math.floor(apiRevisionLimit) || 20));
      const offset = Math.max(0, nextOffset);
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (nextStatus !== "all") params.set("status", nextStatus);
      const body = await apiJson<ApiRevisionListResponse>(
        `/projects/${encodeURIComponent(projectId)}/revisions?${params.toString()}`,
        apiToken.trim() === "" ? undefined : { headers: { authorization: `Bearer ${apiToken.trim()}` } },
      );
      setApiRevisions(body.revisions);
      setApiRevisionTotal(body.total ?? body.revisions.length);
      setApiRevisionOffset(body.offset ?? offset);
      setApiRevisionHasMore(Boolean(body.hasMore));
      setApiRevisionStatusCounts(body.statusCounts ?? null);
      setApiImportStatus(`revision一覧: ${body.revisions.length}/${body.total ?? body.revisions.length}件`);
    } catch (e) {
      setApiImportStatus(`revision一覧エラー: ${(e as Error).message}`);
    }
  }, [apiProjectId, apiRevisionLimit, apiRevisionStatus, apiToken]);

  const onApiRevisionList = useCallback(() => {
    void loadApiRevisionList(0);
  }, [loadApiRevisionList]);

  const selectApiRevisionStatus = useCallback(
    (nextStatus: ApiRevisionStatusFilter) => {
      setApiRevisionStatus(nextStatus);
      void loadApiRevisionList(0, nextStatus);
    },
    [loadApiRevisionList],
  );

  const loadApiRevisionDetail = useCallback(
    async (revisionId: string) => {
      const projectId = apiProjectId.trim();
      if (projectId === "" || revisionId.trim() === "") return;
      try {
        setApiRevisionDetailStatus("revision詳細を読み込み中...");
        const detail = await apiJson<ApiRevisionDetail>(
          `/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}`,
          apiToken.trim() === "" ? undefined : { headers: { authorization: `Bearer ${apiToken.trim()}` } },
        );
        setApiRevisionDetail(detail);
        setApiRevisionDetailStatus("");
      } catch (e) {
        setApiRevisionDetail(null);
        setApiRevisionDetailStatus(`revision詳細エラー: ${(e as Error).message}`);
      }
    },
    [apiProjectId, apiToken],
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
              {importError && (
                <div className="rt-error" role="alert">
                  {importError}
                </div>
              )}
              {feed && (
                <button type="button" onClick={() => setView("edit")}>
                  読み込み済みデータを編集
                </button>
              )}
            </section>
            <section className="source-panel api-import-panel">
              <h2>API revision 読込</h2>
              <p>保存済み revision または latest の GTFS zip を読み込み、編集を再開します。</p>
              <div className="api-import-grid">
                <label>
                  project
                  <input value={apiProjectId} onChange={(e) => setApiProjectId(e.target.value)} />
                </label>
                <label>
                  revision
                  <input value={apiRevisionId} onChange={(e) => setApiRevisionId(e.target.value)} placeholder="空なら latest" />
                </label>
                <label>
                  token
                  <input value={apiToken} onChange={(e) => setApiToken(e.target.value)} type="password" placeholder="任意" />
                </label>
                <label>
                  limit
                  <input
                    value={apiRevisionLimit}
                    onChange={(e) => setApiRevisionLimit(Number(e.target.value))}
                    type="number"
                    min={1}
                    max={500}
                  />
                </label>
                <label>
                  status
                  <select
                    value={apiRevisionStatus}
                    onChange={(e) => setApiRevisionStatus(e.target.value as ApiRevisionStatusFilter)}
                  >
                    <option value="all">all</option>
                    <option value="published">published</option>
                    <option value="validated">validated</option>
                    <option value="superseded">superseded</option>
                  </select>
                </label>
                <button type="button" onClick={onApiRevision}>
                  APIから読込
                </button>
                <button type="button" onClick={onApiRevisionList}>
                  一覧
                </button>
              </div>
              {apiRevisionStatusCounts && (
                <div className="api-revision-counts">
                  <button type="button" onClick={() => selectApiRevisionStatus("all")}>
                    all {apiRevisionStatusCounts.validated + apiRevisionStatusCounts.published + apiRevisionStatusCounts.superseded}
                  </button>
                  <button type="button" onClick={() => selectApiRevisionStatus("published")}>
                    published {apiRevisionStatusCounts.published}
                  </button>
                  <button type="button" onClick={() => selectApiRevisionStatus("validated")}>
                    validated {apiRevisionStatusCounts.validated}
                  </button>
                  <button type="button" onClick={() => selectApiRevisionStatus("superseded")}>
                    superseded {apiRevisionStatusCounts.superseded}
                  </button>
                </div>
              )}
              {apiRevisions.length > 0 && (
                <div className="api-revision-list">
                  <div className="api-revision-list-head">
                    <span>revision</span>
                    <span>状態</span>
                    <span>gate</span>
                    <span>acceptance</span>
                    <span>profile</span>
                    <span>日時</span>
                    <span>hash</span>
                  </div>
                  {apiRevisions.map((revision) => (
                    <button
                      key={revision.id}
                      type="button"
                      className={apiRevisionId === revision.id ? "selected" : ""}
                      onClick={() => {
                        setApiRevisionId(revision.id);
                        void loadApiRevisionDetail(revision.id);
                      }}
                      title={revision.zipSha256}
                    >
                      <span className="mono">{revision.id}</span>
                      <span className={`revision-status revision-status-${revision.status}`}>{revision.status}</span>
                      <span>{revision.gate?.status ?? "-"}</span>
                      <span>{revision.acceptance?.status ?? "-"}</span>
                      <span>{revision.profileId ?? ""}</span>
                      <span>{formatRevisionDate(revision.publishedAt ?? revision.createdAt)}</span>
                      <span className="mono">{revision.zipSha256 ? revision.zipSha256.slice(0, 10) : "-"}</span>
                    </button>
                  ))}
                </div>
              )}
              {(apiRevisionDetail || apiRevisionDetailStatus) && (
                <div className="api-revision-detail">
                  {apiRevisionDetail ? (
                    <>
                      <div className="api-revision-detail-title">
                        <strong className="mono">{apiRevisionDetail.id}</strong>
                        <span className={`revision-status revision-status-${apiRevisionDetail.status}`}>
                          {apiRevisionDetail.status}
                        </span>
                      </div>
                      <dl>
                        <div>
                          <dt>gate</dt>
                          <dd>{apiRevisionDetail.gate?.status ?? "-"}</dd>
                        </div>
                        <div>
                          <dt>acceptance</dt>
                          <dd>{apiRevisionDetail.acceptance?.status ?? "-"}</dd>
                        </div>
                        <div>
                          <dt>blockers</dt>
                          <dd>{apiRevisionDetail.gate?.blockers?.length ?? 0}</dd>
                        </div>
                        <div>
                          <dt>approvals</dt>
                          <dd>{apiRevisionDetail.warningApprovals?.length ?? 0}</dd>
                        </div>
                        <div>
                          <dt>GTFS-JP</dt>
                          <dd>
                            E{apiRevisionDetail.validation?.gtfsJpV4?.errors ?? "-"} / W
                            {apiRevisionDetail.validation?.gtfsJpV4?.warnings ?? "-"}
                          </dd>
                        </div>
                        <div>
                          <dt>Google</dt>
                          <dd>
                            E{apiRevisionDetail.validation?.googleTransitReady?.errors ?? "-"} / W
                            {apiRevisionDetail.validation?.googleTransitReady?.warnings ?? "-"}
                          </dd>
                        </div>
                        <div>
                          <dt>bytes</dt>
                          <dd>{apiRevisionDetail.zipBytes ?? "-"}</dd>
                        </div>
                        <div>
                          <dt>updated</dt>
                          <dd>{formatRevisionDate(apiRevisionDetail.updatedAt ?? apiRevisionDetail.createdAt)}</dd>
                        </div>
                      </dl>
                      <div className="api-revision-detail-hash mono">{apiRevisionDetail.zipSha256 ?? "-"}</div>
                    </>
                  ) : (
                    <span>{apiRevisionDetailStatus}</span>
                  )}
                </div>
              )}
              {apiRevisionTotal !== null && (
                <div className="api-revision-pager">
                  <button
                    type="button"
                    disabled={apiRevisionOffset === 0}
                    onClick={() => void loadApiRevisionList(Math.max(0, apiRevisionOffset - apiRevisionLimit))}
                  >
                    前へ
                  </button>
                  <span>
                    {apiRevisionOffset + 1}-{Math.min(apiRevisionOffset + apiRevisions.length, apiRevisionTotal)} / {apiRevisionTotal}
                  </span>
                  <button
                    type="button"
                    disabled={!apiRevisionHasMore}
                    onClick={() => void loadApiRevisionList(apiRevisionOffset + apiRevisionLimit)}
                  >
                    次へ
                  </button>
                </div>
              )}
              <div className="api-import-meta">
                API: {API_BASE}
                {apiRevisionTotal !== null && <span>total: {apiRevisionTotal}</span>}
                {apiImportStatus && <span>{apiImportStatus}</span>}
              </div>
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
          <RealtimeView />
        </main>
      )}

      {inEditor && (
        <>
          <nav className="tabs">
            <button className={editTab === "metadata" ? "active" : ""} onClick={() => setEditTab("metadata")}>
              基本情報
            </button>
            <button className={editTab === "stops" ? "active" : ""} onClick={() => setEditTab("stops")}>
              停留所
            </button>
            <button className={editTab === "timetable" ? "active" : ""} onClick={() => setEditTab("timetable")}>
              ダイヤ
            </button>
            <button className={editTab === "fares" ? "active" : ""} onClick={() => setEditTab("fares")}>
              運賃
            </button>
            <button className={editTab === "shapes" ? "active" : ""} onClick={() => setEditTab("shapes")}>
              shape
            </button>
            <button className={editTab === "validation" ? "active" : ""} onClick={() => setEditTab("validation")}>
              検証 {summary ? `(${summary.errors + summary.warnings})` : ""}
            </button>
            <button className={editTab === "release" ? "active" : ""} onClick={() => setEditTab("release")}>
              公開ゲート
            </button>
          </nav>
          <main className="main">
            {editTab === "metadata" && (
              <MetadataView feed={feed} version={version} mutateFeed={mutateFeed} />
            )}
            {editTab === "stops" && <StopsView feed={feed} version={version} mutateFeed={mutateFeed} />}
            {editTab === "timetable" && (
              <TimetableView feed={feed} version={version} mutateFeed={mutateFeed} />
            )}
            {editTab === "fares" && <FaresView feed={feed} version={version} mutateFeed={mutateFeed} />}
            {editTab === "shapes" && <ShapesView feed={feed} version={version} mutateFeed={mutateFeed} />}
            {editTab === "validation" && <ValidationView report={report} profileId={profileId} />}
            {editTab === "release" && (
              <ReleaseGateView
                feed={feed}
                version={version}
                profileId={profileId}
                initialProjectId={apiProjectId}
                initialRevisionId={apiRevisionId}
                initialApiToken={apiToken}
                onRevisionContextChange={(projectId, revisionId) => {
                  setApiProjectId(projectId);
                  setApiRevisionId(revisionId);
                }}
              />
            )}
          </main>
        </>
      )}
    </div>
  );
}

function formatRevisionDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
