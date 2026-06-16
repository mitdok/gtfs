/**
 * S-13 検証結果。severity 別に件数と一覧を表示する。
 */
import type { ValidationReport } from "@gtfs-studio/core";

interface Props {
  report: ValidationReport | null;
}

const SEVERITY_LABEL: Record<string, string> = {
  error: "エラー",
  warning: "警告",
  info: "情報",
};

export function ValidationView({ report }: Props) {
  if (!report) return <div className="empty">まだ検証されていません。</div>;
  const { errors, warnings, infos } = report.summary;

  return (
    <div className="validation-view">
      <div className="summary">
        <span className="badge err">エラー {errors}</span>
        <span className="badge warn">警告 {warnings}</span>
        <span className="badge">情報 {infos}</span>
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
            {report.issues.map((issue, i) => (
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
