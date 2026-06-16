/**
 * S-13 検証結果。severity 別に件数と一覧を表示する。
 */
import { getProfile, type Severity, type ValidationReport } from "@gtfs-studio/core";
import { useMemo, useState } from "react";

interface Props {
  report: ValidationReport | null;
}

const SEVERITY_LABEL: Record<string, string> = {
  error: "エラー",
  warning: "警告",
  info: "情報",
};

export function ValidationView({ report }: Props) {
  const [filter, setFilter] = useState<Severity | "all">("all");
  const profile = getProfile("gtfs-jp-v4");
  const filteredIssues = useMemo(() => {
    if (!report) return [];
    if (filter === "all") return report.issues;
    return report.issues.filter((issue) => issue.severity === filter);
  }, [filter, report]);

  if (!report) return <div className="empty">まだ検証されていません。</div>;
  const { errors, warnings, infos } = report.summary;

  return (
    <div className="validation-view">
      <section className="profile-panel">
        <div>
          <div className="profile-title">{profile.label} 対応率</div>
          <div className="profile-note">Schedule 中核 + v4 必須区分 + 軽量値検査</div>
        </div>
        <div className="meter" aria-label={`v4対応率 ${profile.completeness}%`}>
          <span style={{ width: `${profile.completeness}%` }} />
        </div>
        <strong>{profile.completeness}%</strong>
      </section>
      <ul className="profile-notes">
        {profile.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>

      <div className="summary">
        <button className={filter === "all" ? "badge active" : "badge"} onClick={() => setFilter("all")}>
          全件 {report.issues.length}
        </button>
        <button className={filter === "error" ? "badge err active" : "badge err"} onClick={() => setFilter("error")}>
          エラー {errors}
        </button>
        <button className={filter === "warning" ? "badge warn active" : "badge warn"} onClick={() => setFilter("warning")}>
          警告 {warnings}
        </button>
        <button className={filter === "info" ? "badge active" : "badge"} onClick={() => setFilter("info")}>
          情報 {infos}
        </button>
        {errors === 0 && <span className="ok-note">公開可能（エラー0）です</span>}
        {errors > 0 && <span className="err-note">エラーがある間は公開できません（公開ゲート）</span>}
      </div>
      {report.issues.length === 0 ? (
        <p className="all-clear">指摘はありません。</p>
      ) : (
        <table className="issues">
          <thead>
            <tr>
              <th>区分</th>
              <th>コード</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            {filteredIssues.map((issue, i) => (
              <tr key={i} className={issue.severity}>
                <td>{SEVERITY_LABEL[issue.severity] ?? issue.severity}</td>
                <td className="mono">{issue.code}</td>
                <td>{issue.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
