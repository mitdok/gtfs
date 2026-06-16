/**
 * ベースマップのスタイル解決（docs/spec/09-basemap.md 9.7/9.8）。
 *
 * - 自前MapLibre地図基盤の style.json URL を環境変数 VITE_MAP_STYLE_URL で注入する。
 *   基盤側の仕様が固まり次第、この1点を差し替えるだけで切替できる（M-8）。
 * - 未設定時の暫定フォールバックは地理院タイル（淡色・ラスタ）。日本全域で
 *   編集デモが成立し、出典表記の上で利用できる（9.8 の「仮実装」段階）。
 */
import type { StyleRef } from "./adapter";

const GSI_PALE_STYLE = {
  version: 8,
  name: "GSI Pale (fallback)",
  sources: {
    "gsi-pale": {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 5,
      maxzoom: 18,
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f8f8f8" } },
    { id: "gsi-pale", type: "raster", source: "gsi-pale" },
  ],
} as const;

export function resolveBasemapStyle(): StyleRef {
  const url = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
  if (url && url.trim() !== "") return url;
  return GSI_PALE_STYLE as unknown as object;
}

/** フォールバック使用中か（UI で出典・暫定である旨を示すために使う）。 */
export function isFallbackBasemap(): boolean {
  const url = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
  return !url || url.trim() === "";
}
