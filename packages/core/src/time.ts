/**
 * GTFS の時刻ユーティリティ。
 * GTFS の時刻はサービス日からの経過で表され、深夜便は 24:00:00 以上を取り得る
 * （例: 25:10:00）。内部は「秒」で扱い、表示/出力は H:MM:SS / HH:MM:SS。
 */

const TIME_RE = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;

/** "25:10:00" 等を秒へ。形式不正は null。 */
export function hmsToSec(value: string): number | null {
  const m = TIME_RE.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3]);
  return h * 3600 + min * 60 + s;
}

/** 秒を HH:MM:SS（時は2桁以上、24時超も可）へ。 */
export function secToHms(total: number): string {
  if (!Number.isFinite(total) || total < 0) throw new Error(`invalid seconds: ${total}`);
  const s = Math.floor(total % 60);
  const min = Math.floor((total / 60) % 60);
  const h = Math.floor(total / 3600);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(h)}:${pad(min)}:${pad(s)}`;
}

/** GTFS の時刻文字列として妥当か。 */
export function isValidGtfsTime(value: string): boolean {
  return TIME_RE.test(value.trim());
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;

/**
 * GTFS の日付文字列（`YYYYMMDD`）として妥当か。
 * calendar/calendar_dates/feed_info の各日付欄に用いる。月・日の範囲も検証する。
 */
export function isValidGtfsDate(value: string): boolean {
  const m = DATE_RE.exec(value.trim());
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  return true;
}
