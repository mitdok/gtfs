/**
 * 地図アダプタ（Map Adapter）インターフェース。
 *
 * 仕様書 04章4.4 の契約に対応する。編集UIはこの抽象操作だけを使い、
 * MapLibre のスタイル・タイル・レイヤ構成（docs/spec/09-basemap.md）は
 * 実装（maplibreAdapter）の内側に隠蔽する。これにより、自前ベースマップの
 * 仕様確定・差し替えに対して UI 側は無変更で追従できる（F-10-2/F-10-4）。
 */

export type LngLat = { lng: number; lat: number };
export type BBox = { west: number; south: number; east: number; north: number };
/** ベースマップのスタイル参照（URL または style オブジェクト）。 */
export type StyleRef = string | object;

export interface MarkerInput {
  id: string;
  lngLat: LngLat;
  label?: string;
}

export interface MapAdapter {
  init(opts: {
    container: HTMLElement;
    style: StyleRef;
    center: LngLat;
    zoom: number;
  }): Promise<void>;
  destroy(): void;

  // 停留所マーカー
  setMarkers(markers: MarkerInput[]): void;
  highlightMarker(id: string | null): void;
  onMarkerDragEnd(cb: (id: string, lngLat: LngLat) => void): void;
  /** 拡張: 地図側からの選択（ピンのクリック）を UI へ伝える。 */
  onMarkerClick(cb: (id: string) => void): void;

  // 線形（shape）。editable=true では頂点ドラッグを onLineEdit で通知する。
  setLine(id: string, points: LngLat[], opts?: { editable?: boolean }): void;
  removeLine(id: string): void;
  onLineEdit(cb: (id: string, points: LngLat[]) => void): void;

  // 地図操作・取得
  onMapClick(cb: (lngLat: LngLat) => void): void;
  getBounds(): BBox;
  flyTo(target: LngLat | BBox, opts?: { padding?: number; zoom?: number }): void;
}
