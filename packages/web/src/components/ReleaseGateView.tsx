/**
 * S-14 公開ゲート。`evaluateReleaseGate` の判定（公開可否ブロッカー・仕様ロック）を表示する。
 *
 * 標準GTFSバリデータ（MobilityData）はブラウザでは実行できないため、別途実行した
 * `report.json` を読み込んで取り込む（`parseStandardValidatorReport`）。読み込むと
 * `VALIDATOR_LOCK` が確定し、`validator_not_executed` ブロッカーが解消される。
 */
import { useEffect, useMemo, useState } from "react";
import {
  exportToZip,
  evidenceFromRegressionSummary,
  parseStandardValidatorReport,
  runAcceptancePipeline,
  type Feed,
  type RegressionAcceptanceEvidence,
  type StandardValidatorResult,
  type SpecLock,
  type SpecLockId,
  type ValidationIssue,
} from "@gtfs-studio/core";
import { API_BASE, apiJson } from "../lib/api";

interface Props {
  feed: Feed;
  version: number;
  profileId: string;
  initialProjectId?: string;
  initialRevisionId?: string;
  initialApiToken?: string;
  onRevisionContextChange?: (projectId: string, revisionId: string) => void;
}

const CHECK_MARK: Record<string, string> = { pass: "✓", fail: "✗", skip: "—" };

interface WarningApproval {
  key: string;
  code: string;
  message: string;
  entity?: ValidationIssue["entity"];
  impact: string;
  approver: string;
  approvedAt: string;
}

interface WarningApprovalsResponse {
  approvals: WarningApproval[];
}

interface RevisionResponse {
  id: string;
  status: string;
  acceptance?: { status: string };
  gate?: { status: string };
  zipSha256?: string;
}

interface SmokeResponse {
  verified?: boolean;
  sha256Matched?: boolean;
  stage?: string;
  error?: string;
}

interface SpecLocksResponse {
  specLocks: SpecLock[];
}

function issueKey(issue: ValidationIssue, index: number): string {
  const entity = issue.entity ? JSON.stringify(issue.entity) : "";
  return `${issue.code}:${entity}:${index}`;
}

function downloadJson(fileName: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReleaseGateView({
  feed,
  version,
  profileId,
  initialProjectId,
  initialRevisionId,
  initialApiToken,
  onRevisionContextChange,
}: Props) {
  const [validator, setValidator] = useState<StandardValidatorResult | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [warningApprovals, setWarningApprovals] = useState<Record<string, WarningApproval>>({});
  const [projectId, setProjectId] = useState(initialProjectId ?? "demo");
  const [revisionId, setRevisionId] = useState(initialRevisionId ?? "");
  const [apiToken, setApiToken] = useState(initialApiToken ?? "");
  const [approvalStatus, setApprovalStatus] = useState("");
  const [releaseCandidate, setReleaseCandidate] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [publishStatus, setPublishStatus] = useState("");
  const [specLocks, setSpecLocks] = useState<Partial<Record<SpecLockId, SpecLock>>>({});
  const [specLockStatus, setSpecLockStatus] = useState("");
  const [regressionEvidence, setRegressionEvidence] = useState<RegressionAcceptanceEvidence>({});
  const [regressionStatus, setRegressionStatus] = useState("");

  const { report, acceptance } = useMemo(() => {
    // 取込済み validator 結果を MobilityDataReport 形へ戻して pipeline に渡す（件数を保持）。
    const standardReport = validator
      ? {
          summary: { validatorVersion: validator.validatorVersion },
          notices: validator.issues.map((i) => ({
            code: i.code,
            severity: i.severity,
            totalNotices: i.count,
          })),
        }
      : undefined;
    const result = runAcceptancePipeline({
      feed,
      profileId,
      standardReport,
      specLocks,
      realFeedRoundtrip: regressionEvidence.realFeedRoundtrip,
      v3Migration: regressionEvidence.v3Migration,
    });
    return { report: result.gate, acceptance: result.acceptance };
  }, [feed, version, profileId, validator, specLocks, regressionEvidence]);

  const warnings = useMemo(
    () =>
      report.validation.issues
        .map((issue, index) => ({ issue, key: issueKey(issue, index) }))
        .filter(({ issue }) => issue.severity === "warning"),
    [report.validation.issues],
  );

  const approvedWarningCount = warnings.filter(({ key }) => warningApprovals[key]?.approvedAt).length;
  const unapprovedWarningCount = warnings.length - approvedWarningCount;

  useEffect(() => {
    if (initialProjectId !== undefined) setProjectId(initialProjectId);
  }, [initialProjectId]);

  useEffect(() => {
    if (initialRevisionId !== undefined) setRevisionId(initialRevisionId);
  }, [initialRevisionId]);

  useEffect(() => {
    if (initialApiToken !== undefined) setApiToken(initialApiToken);
  }, [initialApiToken]);

  async function onReport(file: File) {
    try {
      const result = parseStandardValidatorReport(await file.text());
      setValidator(result);
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
      setValidator(null);
    }
  }

  async function onRegressionSummary(file: File) {
    try {
      const evidence = evidenceFromRegressionSummary(await file.text(), { requireReviewed: true });
      setRegressionEvidence(evidence);
      setRegressionStatus(
        `回帰証跡を取り込みました: A-07=${evidence.realFeedRoundtrip ? "あり" : "なし"} / A-08=${evidence.v3Migration ? "あり" : "なし"}`,
      );
    } catch (e) {
      setRegressionEvidence({});
      setRegressionStatus(`回帰証跡エラー: ${(e as Error).message}`);
    }
  }

  const ready = report.status === "ready";
  const hasRevisionContext = projectId.trim() !== "" && revisionId.trim() !== "";

  async function loadSpecLocksFromApi() {
    try {
      const body = await apiJson<SpecLocksResponse>("/spec-locks");
      setSpecLocks(Object.fromEntries(body.specLocks.map((lock) => [lock.id, lock])));
      setSpecLockStatus(`APIから仕様ロックを読み込みました: ${body.specLocks.length}件`);
    } catch (e) {
      setSpecLockStatus(`仕様ロック読込エラー: ${(e as Error).message}`);
    }
  }

  function updateProjectId(value: string) {
    setProjectId(value);
    onRevisionContextChange?.(value, revisionId);
  }

  function updateRevisionId(value: string) {
    setRevisionId(value);
    onRevisionContextChange?.(projectId, value);
  }

  function updateApproval(key: string, issue: ValidationIssue, patch: Partial<WarningApproval>) {
    setWarningApprovals((current) => {
      const existing = current[key] ?? {
        key,
        code: issue.code,
        message: issue.message,
        entity: issue.entity,
        impact: "",
        approver: "",
        approvedAt: "",
      };
      return { ...current, [key]: { ...existing, ...patch } };
    });
  }

  function approveWarning(key: string, issue: ValidationIssue) {
    updateApproval(key, issue, { approvedAt: new Date().toISOString() });
  }

  function exportApprovals() {
    const approvals = approvedApprovals();
    downloadJson("gtfs-warning-approvals.json", {
      profileId,
      exportedAt: new Date().toISOString(),
      warnings: {
        total: warnings.length,
        approved: approvals.length,
        unapproved: warnings.length - approvals.length,
      },
      approvals,
    });
  }

  function approvedApprovals(): WarningApproval[] {
    return warnings
      .map(({ key }) => warningApprovals[key])
      .filter((approval): approval is WarningApproval => Boolean(approval?.approvedAt));
  }

  function authHeaders(): HeadersInit {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiToken.trim() !== "") headers.authorization = `Bearer ${apiToken.trim()}`;
    return headers;
  }

  async function loadApprovalsFromApi() {
    const project = projectId.trim();
    const revision = revisionId.trim();
    if (project === "" || revision === "") {
      setApprovalStatus("project/revision ID を入力してください");
      return;
    }
    try {
      const body = await apiJson<WarningApprovalsResponse>(
        `/projects/${encodeURIComponent(project)}/revisions/${encodeURIComponent(revision)}/warning-approvals`,
        apiToken.trim() === "" ? undefined : { headers: authHeaders() },
      );
      setWarningApprovals(Object.fromEntries(body.approvals.map((approval) => [approval.key, approval])));
      setApprovalStatus(`APIから承認記録を読み込みました: ${body.approvals.length}件`);
    } catch (e) {
      setApprovalStatus(`API読込エラー: ${(e as Error).message}`);
    }
  }

  async function saveApprovalsToApi() {
    const project = projectId.trim();
    const revision = revisionId.trim();
    if (project === "" || revision === "") {
      setApprovalStatus("project/revision ID を入力してください");
      return;
    }
    try {
      const body = await saveApprovals(project, revision);
      setApprovalStatus(`APIへ承認記録を保存しました: ${body.approvals.length}件`);
    } catch (e) {
      setApprovalStatus(`API保存エラー: ${(e as Error).message}`);
    }
  }

  async function saveApprovals(project: string, revision: string): Promise<WarningApprovalsResponse> {
    return apiJson<WarningApprovalsResponse>(
      `/projects/${encodeURIComponent(project)}/revisions/${encodeURIComponent(revision)}/warning-approvals`,
      {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ approvals: approvedApprovals() }),
      },
    );
  }

  async function createRevision() {
    const project = projectId.trim();
    if (project === "") {
      setPublishStatus("project ID を入力してください");
      return;
    }
    try {
      const zipBase64 = uint8ToBase64(exportToZip(feed, { profileId }));
      const body = await apiJson<RevisionResponse>(`/projects/${encodeURIComponent(project)}/revisions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          id: revisionId.trim() || undefined,
          zipBase64,
          profileId,
          standardReport: validator
            ? {
                summary: { validatorVersion: validator.validatorVersion },
                notices: validator.issues.map((issue) => ({
                  code: issue.code,
                  severity: issue.severity,
                  totalNotices: issue.count,
                })),
              }
            : undefined,
          releaseCandidate: releaseCandidate.trim() || undefined,
          realFeedRoundtrip: regressionEvidence.realFeedRoundtrip,
          v3Migration: regressionEvidence.v3Migration,
        }),
      });
      setRevisionId(body.id);
      onRevisionContextChange?.(project, body.id);
      const approvals = approvedApprovals();
      if (approvals.length > 0) {
        try {
          const saved = await saveApprovals(project, body.id);
          setApprovalStatus(`revision ${body.id} へ承認記録も保存しました: ${saved.approvals.length}件`);
        } catch (e) {
          setApprovalStatus(`revision ${body.id} は保存済み。承認記録の保存は失敗: ${(e as Error).message}`);
        }
      }
      setPublishStatus(
        `revision保存: ${body.id} / acceptance=${body.acceptance?.status ?? "-"} / gate=${body.gate?.status ?? "-"}`,
      );
    } catch (e) {
      setPublishStatus(`revision保存エラー: ${(e as Error).message}`);
    }
  }

  async function publishRevision() {
    const project = projectId.trim();
    const revision = revisionId.trim();
    if (project === "" || revision === "") {
      setPublishStatus("project/revision ID を入力してください");
      return;
    }
    try {
      const body = await apiJson<RevisionResponse>(
        `/projects/${encodeURIComponent(project)}/revisions/${encodeURIComponent(revision)}:publish`,
        { method: "POST", headers: authHeaders() },
      );
      const latestUrl = `${API_BASE}/projects/${encodeURIComponent(project)}/latest/gtfs.zip`;
      if (publicUrl.trim() === "") setPublicUrl(latestUrl);
      setPublishStatus(`publish完了: ${body.id} / status=${body.status} / latest=${latestUrl}`);
    } catch (e) {
      setPublishStatus(`publishエラー: ${(e as Error).message}`);
    }
  }

  async function runPublicUrlSmoke() {
    const project = projectId.trim();
    const revision = revisionId.trim();
    if (project === "" || revision === "" || publicUrl.trim() === "") {
      setPublishStatus("project/revision ID と公開URLを入力してください");
      return;
    }
    try {
      const body = await apiJson<SmokeResponse>(
        `/projects/${encodeURIComponent(project)}/revisions/${encodeURIComponent(revision)}/public-url-smoke`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            url: publicUrl.trim(),
            standardReport: validator
              ? {
                  summary: { validatorVersion: validator.validatorVersion },
                  notices: validator.issues.map((issue) => ({
                    code: issue.code,
                    severity: issue.severity,
                    totalNotices: issue.count,
                  })),
                }
              : undefined,
          }),
        },
      );
      setPublishStatus(
        `smoke完了: verified=${String(body.verified)} / sha256=${String(body.sha256Matched)} / stage=${body.stage ?? "-"}`,
      );
    } catch (e) {
      setPublishStatus(`smokeエラー: ${(e as Error).message}`);
    }
  }

  return (
    <div className="release-gate-view">
      <div className="summary">
        <span className="profile-pill">{profileId}</span>
        <span className={ready ? "badge ok" : "badge err"}>
          {ready ? "公開可（ready）" : `公開不可（${report.blockers.length}件）`}
        </span>
        {warnings.length > 0 && (
          <span className={unapprovedWarningCount === 0 ? "badge ok" : "badge warn"}>
            warning承認 {approvedWarningCount}/{warnings.length}
          </span>
        )}
      </div>

      <section className="gate-section">
        <h3>標準バリデータ（MobilityData）結果の取込</h3>
        <label className="file-btn">
          report.json を読み込む
          <input
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onReport(f);
              e.target.value = "";
            }}
          />
        </label>
        {validator ? (
          <span className="validator-info">
            {validator.validatorName}
            {validator.validatorVersion ? `@${validator.validatorVersion}` : ""} ／ error{" "}
            {validator.summary.errors}・warning {validator.summary.warnings}
          </span>
        ) : (
          <span className="hint">未取込（`validator_not_executed` ブロッカーが残ります）</span>
        )}
        {loadError && <div className="err-note">取込エラー: {loadError}</div>}
      </section>

      <section className="gate-section">
        <h3>実データ回帰証跡</h3>
        <label className="file-btn">
          summary.json を読み込む
          <input
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onRegressionSummary(f);
              e.target.value = "";
            }}
          />
        </label>
        <span className="validator-info">
          A-07 {regressionEvidence.realFeedRoundtrip ? "取込済" : "未取込"} / A-08{" "}
          {regressionEvidence.v3Migration ? "取込済" : "未取込"}
        </span>
        {regressionStatus && <div className="approval-status">{regressionStatus}</div>}
      </section>

      <section className="gate-section">
        <div className="section-toolbar">
          <h3>仕様ロック</h3>
          <button type="button" onClick={loadSpecLocksFromApi}>
            API読込
          </button>
        </div>
        <ul className="lock-list">
          {report.requiredSpecLocks.map((id) => {
            const missing = report.blockers.some(
              (b) => b.code === "spec_lock_missing" && b.entity?.id === id,
            );
            return (
              <li key={id} className={missing ? "lock missing" : "lock locked"}>
                <span className="mono">{id}</span>
                <span>{missing ? "未設定" : "ロック済"}</span>
              </li>
            );
          })}
        </ul>
        {specLockStatus && <div className="approval-status">{specLockStatus}</div>}
      </section>

      <section className="gate-section">
        <h3>公開ブロッカー</h3>
        {report.blockers.length === 0 ? (
          <p className="all-clear">ブロッカーはありません。公開可能です。</p>
        ) : (
          <table className="issues">
            <thead>
              <tr>
                <th>コード</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {report.blockers.map((b, i) => (
                <tr key={i} className="error">
                  <td className="mono">{b.code}</td>
                  <td>{b.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="gate-section">
        <div className="section-toolbar">
          <h3>版・公開API</h3>
          <div className="button-row">
            <button type="button" onClick={createRevision}>
              revision保存
            </button>
            <button
              type="button"
              onClick={publishRevision}
              disabled={!ready || !hasRevisionContext}
              title={
                !ready
                  ? "公開ブロッカーを解消してください"
                  : !hasRevisionContext
                    ? "project/revision ID が必要です"
                    : undefined
              }
            >
              publish
            </button>
            <button
              type="button"
              onClick={runPublicUrlSmoke}
              disabled={!hasRevisionContext || publicUrl.trim() === ""}
              title={
                !hasRevisionContext || publicUrl.trim() === ""
                  ? "project/revision ID と公開URLが必要です"
                  : undefined
              }
            >
              smoke
            </button>
          </div>
        </div>
        <div className="approval-api-form publish-api-form">
          <label>
            release candidate
            <input value={releaseCandidate} onChange={(e) => setReleaseCandidate(e.target.value)} placeholder="0.1.0-rc.1" />
          </label>
          <label className="wide">
            public URL
            <input value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://..." />
          </label>
        </div>
        {publishStatus && <div className="approval-status">{publishStatus}</div>}
      </section>

      <section className="gate-section">
        <div className="section-toolbar">
          <h3>warning承認</h3>
          <div className="button-row">
            <button type="button" onClick={loadApprovalsFromApi}>
              API読込
            </button>
            <button type="button" onClick={saveApprovalsToApi} disabled={approvedWarningCount === 0}>
              API保存
            </button>
            <button type="button" onClick={exportApprovals} disabled={approvedWarningCount === 0}>
              承認記録JSON
            </button>
          </div>
        </div>
        <div className="approval-api-form">
          <label>
            project
            <input value={projectId} onChange={(e) => updateProjectId(e.target.value)} />
          </label>
          <label>
            revision
            <input value={revisionId} onChange={(e) => updateRevisionId(e.target.value)} placeholder="rev_..." />
          </label>
          <label>
            token
            <input
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="任意"
              type="password"
            />
          </label>
          <span className="validator-info">API: {API_BASE}</span>
        </div>
        {approvalStatus && <div className="approval-status">{approvalStatus}</div>}
        {warnings.length === 0 ? (
          <p className="all-clear">承認が必要な warning はありません。</p>
        ) : (
          <table className="issues warning-approvals">
            <thead>
              <tr>
                <th>コード</th>
                <th>内容</th>
                <th>影響</th>
                <th>承認者</th>
                <th>承認日時</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {warnings.map(({ issue, key }) => {
                const approval = warningApprovals[key];
                return (
                  <tr key={key} className={approval?.approvedAt ? "" : "warning"}>
                    <td className="mono">{issue.code}</td>
                    <td>{issue.message}</td>
                    <td>
                      <input
                        value={approval?.impact ?? ""}
                        onChange={(e) => updateApproval(key, issue, { impact: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={approval?.approver ?? ""}
                        onChange={(e) => updateApproval(key, issue, { approver: e.target.value })}
                      />
                    </td>
                    <td className="mono">{approval?.approvedAt ?? ""}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => approveWarning(key, issue)}
                        disabled={(approval?.approver ?? "").trim() === ""}
                      >
                        承認
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="gate-section">
        <h3>検収チェック（A-01〜A-10 / 仕様 11.1）</h3>
        <p className="hint">
          A-07〜A-09（実フィード回帰・v3移行回帰・公開URL検証）はブラウザでは証跡が無いため
          fail のままになります。CLI（`gtfs-acceptance`）で回帰結果を渡すと ready 判定できます。
        </p>
        <table className="issues acceptance-checks">
          <thead>
            <tr>
              <th>判定</th>
              <th>ID</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            {acceptance.checks.map((c) => (
              <tr key={c.id} className={c.status === "pass" ? "" : "error"}>
                <td className={`check-${c.status}`}>{CHECK_MARK[c.status] ?? c.status}</td>
                <td className="mono">{c.id}</td>
                <td>{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
