/**
 * 出力プロファイル準拠フィルタ。
 *
 * 仕様 10.5「v4とv3互換の分離」/ CHANGELOG「出力時のプロファイル準拠フィルタ」。
 * 内部モデルはロスレス保持（v3拡張ファイルや空ファイルも残す）が、公開用 zip では
 * プロファイルに沿って次を行う:
 *
 * - v3 由来の legacy `*_jp.txt` を v4/base 出力候補から除外する
 *   （`gtfs-jp-v3-legacy` プロファイルでは保持）。
 * - プロファイル上 必須でない 空ファイル（0 行）を省略する。
 *
 * 入力 Feed は変更せず、フィルタ済みの新しい Feed と除外記録を返す。
 */
import { createFeed, setTable, type Feed } from "./model.js";
import { getProfile } from "./profile.js";

export interface ExportProfileOptions {
  /** v3 由来の `*_jp.txt` を除外する。既定は v3-legacy 以外で true。 */
  dropLegacyJpFiles?: boolean;
  /** プロファイル上 必須でない 空ファイルを省略する。既定 true。 */
  dropEmptyOptionalFiles?: boolean;
}

export interface RemovedFile {
  name: string;
  reason: string;
}

export interface ExportProfileResult {
  feed: Feed;
  removed: RemovedFile[];
}

const LEGACY_JP_TABLES = ["agency_jp", "office_jp", "pattern_jp", "routes_jp"];

/**
 * Feed を出力プロファイルに沿ってフィルタする。
 *
 * @param input 内部モデル（非破壊）
 * @param profileId `gtfs-base` / `gtfs-jp-v4` / `gtfs-jp-v3-legacy`
 */
export function applyExportProfile(
  input: Feed,
  profileId: string,
  options: ExportProfileOptions = {},
): ExportProfileResult {
  const profile = getProfile(profileId);
  const isLegacyProfile = profileId === "gtfs-jp-v3-legacy";
  const dropLegacy = options.dropLegacyJpFiles ?? !isLegacyProfile;
  const dropEmpty = options.dropEmptyOptionalFiles ?? true;

  // プロファイル上 必須のファイルは、空でも省略しない（検証で empty_required_file を出す）。
  const requiredNames = new Set(
    profile.files.filter((f) => f.required).map((f) => f.name),
  );

  const removed: RemovedFile[] = [];
  const out = createFeed();

  for (const [name, table] of input.tables) {
    if (dropLegacy && LEGACY_JP_TABLES.includes(name)) {
      removed.push({
        name,
        reason: `legacy ${name}.txt は ${profileId} のネイティブ出力では除外`,
      });
      continue;
    }
    if (dropEmpty && table.rows.length === 0 && !requiredNames.has(name)) {
      removed.push({
        name,
        reason: `空の任意ファイル ${name}.txt を省略`,
      });
      continue;
    }
    setTable(
      out,
      name,
      table.rows.map((r) => ({ ...r })),
      [...table.columns],
    );
  }

  return { feed: out, removed };
}
