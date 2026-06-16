/**
 * S-14 公開ゲート。`evaluateReleaseGate` の判定（公開可否ブロッカー・仕様ロック）を表示する。
 *
 * 標準GTFSバリデータ（MobilityData）はブラウザでは実行できないため、別途実行した
 * `report.json` を読み込んで取り込む（`parseStandardValidatorReport`）。読み込むと
 * `VALIDATOR_LOCK` が確定し、`validator_not_executed` ブロッカーが解消される。
 */
import { useMemo, useState } from "react";
import {
  parseStandardValidatorReport,
  runAcceptancePipeline,
  type Feed,
  type StandardValidatorResult,
} from "@gtfs-studio/core";

interface Props {
  feed: Feed;
  profileId: string;
}

const CHECK_MARK: Record<string, string> = { pass: "✓", fail: "✗", skip: "—" };

export function ReleaseGateView({ feed, profileId }: Props) {
  const [validator, setValidator] = useState<StandardValidatorResult | null>(null);
  const [loadError, setLoadError] = useState<string>("");

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
    const result = runAcceptancePipeline({ feed, profileId, standardReport });
    return { report: result.gate, acceptance: result.acceptance };
  }, [feed, profileId, validator]);

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

  const ready = report.status === "ready";

  return (
    <div className="release-gate-view">
      <div className="summary">
        <span className="profile-pill">{profileId}</span>
        <span className={ready ? "badge ok" : "badge err"}>
          {ready ? "公開可（ready）" : `公開不可（${report.blockers.length}件）`}
        </span>
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
        <h3>仕様ロック</h3>
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
