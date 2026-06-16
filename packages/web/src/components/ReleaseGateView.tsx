/**
 * S-14 公開ゲート。`evaluateReleaseGate` の判定（公開可否ブロッカー・仕様ロック）を表示する。
 *
 * 標準GTFSバリデータ（MobilityData）はブラウザでは実行できないため、別途実行した
 * `report.json` を読み込んで取り込む（`parseStandardValidatorReport`）。読み込むと
 * `VALIDATOR_LOCK` が確定し、`validator_not_executed` ブロッカーが解消される。
 */
import { useMemo, useState } from "react";
import {
  createSpecLockStore,
  evaluateReleaseGate,
  parseStandardValidatorReport,
  toStandardValidatorSummary,
  validatorLockFromResult,
  type Feed,
  type StandardValidatorResult,
} from "@gtfs-studio/core";

interface Props {
  feed: Feed;
  profileId: string;
}

export function ReleaseGateView({ feed, profileId }: Props) {
  const [validator, setValidator] = useState<StandardValidatorResult | null>(null);
  const [loadError, setLoadError] = useState<string>("");

  const report = useMemo(() => {
    const store = createSpecLockStore();
    if (validator) store.set(validatorLockFromResult(validator, { runMethod: "browser-upload" }));
    return evaluateReleaseGate(feed, {
      profileId,
      specLocks: store.snapshot(),
      standardValidator: validator ? toStandardValidatorSummary(validator) : undefined,
    });
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
    </div>
  );
}
