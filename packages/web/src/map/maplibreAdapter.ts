/**
 * MapAdapter の MapLibre GL JS 実装。
 *
 * 設計（docs/spec/09-basemap.md 9.7）:
 * - ベースマップは style（StyleRef）として外部から注入される。
 * - 編集オーバーレイ（停留所・選択ハイライト・経路線）は、この実装が実行時に
 *   追加する動的レイヤであり、ベースマップ側の style.json には含めない。
 * - 大量の停留所に耐えるため、マーカーは DOM ではなく GeoJSON ソース＋circle
 *   レイヤで描画する。ドラッグ編集は「選択中の1点」だけ DOM マーカーに昇格させる。
 * - オーバーレイ専用色（ベースマップ側では使わない予約色）:
 *   停留所=#d7263d(赤系) / 選択=#1f6feb(青系)
 */
import maplibregl from "maplibre-gl";
import type { BBox, LngLat, MapAdapter, MarkerInput, StyleRef } from "./adapter";

const SRC_STOPS = "gtfs-studio:stops";
const LYR_STOPS = "gtfs-studio:stops-circle";
const LYR_STOPS_LABEL = "gtfs-studio:stops-label";
const SRC_LINE_PREFIX = "gtfs-studio:line:";
const LYR_LINE_PREFIX = "gtfs-studio:line-layer:";

const COLOR_STOP = "#d7263d";
const COLOR_SELECTED = "#1f6feb";

export class MapLibreAdapter implements MapAdapter {
  private map: maplibregl.Map | null = null;
  private markers: MarkerInput[] = [];
  private lines = new Map<string, LngLat[]>();
  private lineVertexMarkers = new Map<string, maplibregl.Marker[]>();
  private highlightedId: string | null = null;
  private dragMarker: maplibregl.Marker | null = null;
  private hasGlyphs = false;

  private dragEndCb: ((id: string, lngLat: LngLat) => void) | null = null;
  private markerClickCb: ((id: string) => void) | null = null;
  private mapClickCb: ((lngLat: LngLat) => void) | null = null;
  private lineEditCb: ((id: string, points: LngLat[]) => void) | null = null;

  async init(opts: {
    container: HTMLElement;
    style: StyleRef;
    center: LngLat;
    zoom: number;
  }): Promise<void> {
    const map = new maplibregl.Map({
      container: opts.container,
      style: opts.style as string | maplibregl.StyleSpecification,
      center: [opts.center.lng, opts.center.lat],
      zoom: opts.zoom,
      attributionControl: { compact: false },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    this.map = map;

    await new Promise<void>((resolve) => map.once("load", () => resolve()));

    // ラベル描画はベースマップのグリフ提供が前提（9.4）。無い場合は円のみ。
    this.hasGlyphs = Boolean(map.getStyle().glyphs);
    this.ensureOverlayLayers();
    this.bindEvents();
  }

  destroy(): void {
    this.dragMarker?.remove();
    this.dragMarker = null;
    for (const id of this.lineVertexMarkers.keys()) this.removeLineVertexMarkers(id);
    this.map?.remove();
    this.map = null;
  }

  // --- 停留所マーカー -----------------------------------------------------

  setMarkers(markers: MarkerInput[]): void {
    this.markers = markers;
    this.refreshStopsSource();
    // 選択中マーカーの座標がデータ更新で変わった場合に追従
    if (this.highlightedId) this.syncDragMarker();
  }

  highlightMarker(id: string | null): void {
    this.highlightedId = id;
    this.refreshStopsSource();
    this.syncDragMarker();
  }

  onMarkerDragEnd(cb: (id: string, lngLat: LngLat) => void): void {
    this.dragEndCb = cb;
  }

  onMarkerClick(cb: (id: string) => void): void {
    this.markerClickCb = cb;
  }

  // --- 線形（shape） -------------------------------------------------------

  setLine(id: string, points: LngLat[], opts?: { editable?: boolean }): void {
    const map = this.map;
    if (!map) return;
    this.lines.set(id, points);
    const srcId = SRC_LINE_PREFIX + id;
    const lyrId = LYR_LINE_PREFIX + id;
    const data: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
    };
    const src = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      map.addSource(srcId, { type: "geojson", data });
      map.addLayer({
        id: lyrId,
        type: "line",
        source: srcId,
        paint: { "line-color": COLOR_SELECTED, "line-width": 3, "line-opacity": 0.8 },
      });
    }
    this.syncLineVertexMarkers(id, Boolean(opts?.editable));
  }

  removeLine(id: string): void {
    const map = this.map;
    if (!map) return;
    this.removeLineVertexMarkers(id);
    this.lines.delete(id);
    const srcId = SRC_LINE_PREFIX + id;
    const lyrId = LYR_LINE_PREFIX + id;
    if (map.getLayer(lyrId)) map.removeLayer(lyrId);
    if (map.getSource(srcId)) map.removeSource(srcId);
  }

  onLineEdit(cb: (id: string, points: LngLat[]) => void): void {
    this.lineEditCb = cb;
  }

  // --- 地図操作 -------------------------------------------------------------

  onMapClick(cb: (lngLat: LngLat) => void): void {
    this.mapClickCb = cb;
  }

  getBounds(): BBox {
    const b = this.map?.getBounds();
    if (!b) return { west: 0, south: 0, east: 0, north: 0 };
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  }

  flyTo(target: LngLat | BBox, opts?: { padding?: number; zoom?: number }): void {
    const map = this.map;
    if (!map) return;
    if ("lng" in target) {
      map.flyTo({ center: [target.lng, target.lat], zoom: opts?.zoom ?? 16 });
    } else {
      map.fitBounds(
        [
          [target.west, target.south],
          [target.east, target.north],
        ],
        { padding: opts?.padding ?? 40 },
      );
    }
  }

  // --- 内部 -----------------------------------------------------------------

  private ensureOverlayLayers(): void {
    const map = this.map;
    if (!map) return;
    if (map.getSource(SRC_STOPS)) return;

    map.addSource(SRC_STOPS, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: LYR_STOPS,
      type: "circle",
      source: SRC_STOPS,
      paint: {
        "circle-radius": ["case", ["boolean", ["get", "selected"], false], 8, 5],
        "circle-color": [
          "case",
          ["boolean", ["get", "selected"], false],
          COLOR_SELECTED,
          COLOR_STOP,
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
      },
    });
    if (this.hasGlyphs) {
      map.addLayer({
        id: LYR_STOPS_LABEL,
        type: "symbol",
        source: SRC_STOPS,
        minzoom: 14,
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#333333",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.2,
        },
      });
    }
  }

  private bindEvents(): void {
    const map = this.map;
    if (!map) return;

    map.on("click", LYR_STOPS, (e) => {
      const f = e.features?.[0];
      const id = f?.properties?.id as string | undefined;
      if (id) {
        e.preventDefault();
        this.markerClickCb?.(id);
      }
    });
    map.on("click", (e) => {
      if (e.defaultPrevented) return;
      this.mapClickCb?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
    map.on("mouseenter", LYR_STOPS, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LYR_STOPS, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  private refreshStopsSource(): void {
    const map = this.map;
    if (!map) return;
    const src = map.getSource(SRC_STOPS) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const features: GeoJSON.Feature[] = this.markers.map((m) => ({
      type: "Feature",
      properties: { id: m.id, label: m.label ?? "", selected: m.id === this.highlightedId },
      geometry: { type: "Point", coordinates: [m.lngLat.lng, m.lngLat.lat] },
    }));
    src.setData({ type: "FeatureCollection", features });
  }

  /** 選択中の停留所だけ DOM マーカー（ドラッグ可能）に昇格させる。 */
  private syncDragMarker(): void {
    const map = this.map;
    if (!map) return;
    this.dragMarker?.remove();
    this.dragMarker = null;
    if (!this.highlightedId) return;

    const m = this.markers.find((x) => x.id === this.highlightedId);
    if (!m) return;

    const marker = new maplibregl.Marker({ draggable: true, color: COLOR_SELECTED })
      .setLngLat([m.lngLat.lng, m.lngLat.lat])
      .addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLngLat();
      this.dragEndCb?.(m.id, { lng: pos.lng, lat: pos.lat });
    });
    this.dragMarker = marker;
  }

  private syncLineVertexMarkers(id: string, editable: boolean): void {
    const map = this.map;
    if (!map) return;
    this.removeLineVertexMarkers(id);
    if (!editable) return;

    const points = this.lines.get(id) ?? [];
    const vertexMarkers = points.map((point, index) => {
      const marker = new maplibregl.Marker({
        draggable: true,
        color: "#f59e0b",
        scale: 0.72,
      })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        const nextPoints = [...(this.lines.get(id) ?? points)];
        nextPoints[index] = { lng: pos.lng, lat: pos.lat };
        this.lines.set(id, nextPoints);
        this.setLine(id, nextPoints, { editable: true });
        this.lineEditCb?.(id, nextPoints);
      });
      return marker;
    });
    this.lineVertexMarkers.set(id, vertexMarkers);
  }

  private removeLineVertexMarkers(id: string): void {
    const markers = this.lineVertexMarkers.get(id) ?? [];
    for (const marker of markers) marker.remove();
    this.lineVertexMarkers.delete(id);
  }
}
