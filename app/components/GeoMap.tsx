"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisResponse } from "@/app/types";
import type { GeoJsonGeometry } from "@/app/types";
import { displayPreviewUrl } from "@/lib/preview-url";
import { buildMapSession, isVerifiedDetection } from "@/lib/map-session";

type GeoMapProps = {
  analysis: AnalysisResponse | null;
  preferredSceneId?: string | null;
  draftAoi?: GeoJsonGeometry | null;
  onAoiDrawn?: (geometry: GeoJsonGeometry) => void;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function detectionPalette(properties: Record<string, unknown>) {
  const target = [properties.class, properties.label, properties.object, properties.category]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/vehicle|car|truck|bus|רכב|מכונית|משאית/.test(target)) return "#38bdf8";
  if (/roof|building|structure|גג|מבנה|בניין/.test(target)) return "#f97316";
  if (/flood|water|הצפ|מים/.test(target)) return "#22d3ee";
  if (/burn|fire|wildfire|שריפ/.test(target)) return "#fb7185";
  if (/volcan|lava|געש|לבה/.test(target)) return "#f59e0b";
  return "#d946ef";
}

function detectionLabel(properties: Record<string, unknown>) {
  for (const value of [properties.label, properties.class, properties.object, properties.category]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "איתור מודל";
}

function detectionScore(properties: Record<string, unknown>) {
  for (const value of [properties.confidence, properties.score, properties.probability]) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const normalized = value <= 1 ? value * 100 : value;
    return Math.max(0, Math.min(100, normalized));
  }
  return null;
}

export function GeoMap({ analysis, preferredSceneId = null, draftAoi = null, onAoiDrawn }: GeoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const onAoiDrawnRef = useRef(onAoiDrawn);
  const mapSession = buildMapSession(analysis, preferredSceneId);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    onAoiDrawnRef.current = onAoiDrawn;
  }, [onAoiDrawn]);

  useEffect(() => {
    let active = true;
    let resizeTimer: number | undefined;

    async function createMap() {
      setReady(false);
      setMapError(null);
      const L = await import("leaflet");
      if (!active || !containerRef.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const center: [number, number] = analysis?.location
        ? [analysis.location.latitude, analysis.location.longitude]
        : [31.6, 34.9];
      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: window.matchMedia("(pointer: fine) and (min-width: 981px)").matches,
      }).setView(center, analysis?.location ? 9 : 5);
      mapRef.current = map;
      L.control.zoom({ position: "topleft" }).addTo(map);
      L.control.attribution({ position: "bottomleft" }).addTo(map);

      const satellite = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: "Tiles © Esri",
        },
      ).addTo(map);
      const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
      });
      const aoiLayer = L.layerGroup().addTo(map);
      const sceneLayer = L.layerGroup().addTo(map);
      const sourceLayer = L.layerGroup().addTo(map);
      const eventLayer = L.layerGroup().addTo(map);
      const modelLayer = L.layerGroup().addTo(map);
      const drawingLayer = L.layerGroup().addTo(map);

      const basemapControl = new L.Control({ position: "topleft" });
      const basemapTemplate = {
        satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        street: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      };
      const tilePreviewUrl = (template: string) => {
        const zoom = Math.max(2, Math.min(18, Math.round(map.getZoom())));
        const point = map.project(map.getCenter(), zoom).divideBy(256).floor();
        const tileCount = 2 ** zoom;
        const x = ((point.x % tileCount) + tileCount) % tileCount;
        const y = Math.max(0, Math.min(tileCount - 1, point.y));
        return template
          .replace("{z}", String(zoom))
          .replace("{x}", String(x))
          .replace("{y}", String(y))
          .replace("{s}", "a");
      };

      const refreshBasemapControl = (button: HTMLButtonElement, preview: HTMLElement) => {
        const satelliteActive = map.hasLayer(satellite);
        const nextMode = satelliteActive ? "מפה" : "תצלום לוויין";
        button.setAttribute("aria-label", `עבור ל${nextMode}`);
        button.title = `עבור ל${nextMode}`;
        button.dataset.currentMode = satelliteActive ? "satellite" : "map";
        preview.style.backgroundImage = `url("${tilePreviewUrl(satelliteActive ? basemapTemplate.street : basemapTemplate.satellite)}")`;
      };

      basemapControl.onAdd = () => {
        const container = L.DomUtil.create("div", "basemap-switcher leaflet-bar");
        const button = L.DomUtil.create("button", "basemap-switcher-button", container) as HTMLButtonElement;
        button.type = "button";
        const preview = L.DomUtil.create("span", "basemap-switcher-preview", button);
        const refresh = () => refreshBasemapControl(button, preview);
        const toggle = () => {
          if (map.hasLayer(satellite)) {
            map.removeLayer(satellite);
            street.addTo(map);
          } else {
            map.removeLayer(street);
            satellite.addTo(map);
          }
          refresh();
        };
        button.addEventListener("click", toggle);
        map.on("moveend zoomend", refresh);
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        refresh();
        basemapControl.onRemove = () => {
          button.removeEventListener("click", toggle);
          map.off("moveend zoomend", refresh);
        };
        return container;
      };
      basemapControl.addTo(map);

      const layerControl = new L.Control({ position: "topright" });
      layerControl.onAdd = () => {
        const container = L.DomUtil.create("div", "map-layer-switcher leaflet-bar");
        const title = L.DomUtil.create("strong", "map-layer-title", container);
        title.textContent = "שכבות";
        const definitions = [
          ["aoi", "אזור חיפוש", aoiLayer],
          ["scene", "טביעות סצנות", sceneLayer],
          ["source", "תמונת מקור", sourceLayer],
          ["event", "אירועי קטלוג", eventLayer],
          ["model", "תוצאת מודל", modelLayer],
        ] as const;
        for (const [key, label, layer] of definitions) {
          const button = L.DomUtil.create("button", "map-layer-toggle", container) as HTMLButtonElement;
          button.type = "button";
          button.dataset.layer = key;
          button.textContent = label;
          const refresh = () => {
            const active = map.hasLayer(layer);
            button.setAttribute("aria-pressed", String(active));
            button.classList.toggle("is-active", active);
          };
          const toggle = () => {
            if (map.hasLayer(layer)) map.removeLayer(layer);
            else layer.addTo(map);
            refresh();
          };
          button.addEventListener("click", toggle);
          refresh();
          L.DomEvent.disableClickPropagation(button);
        }
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        return container;
      };
      layerControl.addTo(map);

      const drawingControl = new L.Control({ position: "topright" });
      drawingControl.onAdd = () => {
        const container = L.DomUtil.create("div", "map-drawing-control leaflet-bar");
        const button = L.DomUtil.create("button", "map-drawing-button", container) as HTMLButtonElement;
        button.type = "button";
        button.textContent = "סמן AOI";
        let drawing = false;
        let points: import("leaflet").LatLng[] = [];
        let preview: import("leaflet").Polygon | null = null;
        const renderPreview = () => {
          if (preview) drawingLayer.removeLayer(preview);
          if (points.length < 2) {
            preview = null;
            return;
          }
          preview = L.polygon(points, {
            color: "#b7ff4a",
            weight: 2,
            dashArray: "5 5",
            fillColor: "#b7ff4a",
            fillOpacity: 0.12,
          });
          drawingLayer.addLayer(preview);
        };
        const finish = () => {
          if (points.length < 3) return;
          const coordinates = points.map((point) => [point.lng, point.lat] as [number, number]);
          coordinates.push(coordinates[0]);
          onAoiDrawnRef.current?.({ type: "Polygon", coordinates: [coordinates] });
          drawing = false;
          points = [];
          if (preview) drawingLayer.removeLayer(preview);
          preview = null;
          button.textContent = "סמן AOI";
          button.setAttribute("aria-pressed", "false");
        };
        const click = () => {
          if (drawing && points.length >= 3) {
            finish();
            return;
          }
          drawing = !drawing;
          points = [];
          if (preview) drawingLayer.removeLayer(preview);
          preview = null;
          button.textContent = drawing ? "סיום סימון" : "סמן AOI";
          button.setAttribute("aria-pressed", String(drawing));
        };
        const mapClick = (event: import("leaflet").LeafletMouseEvent) => {
          if (!drawing) return;
          points.push(event.latlng);
          renderPreview();
        };
        button.addEventListener("click", click);
        map.on("click", mapClick);
        L.DomEvent.disableClickPropagation(container);
        return container;
      };
      drawingControl.addTo(map);

      if (draftAoi) {
        L.geoJSON(draftAoi as Parameters<typeof L.geoJSON>[0], {
          style: { color: "#b7ff4a", weight: 2.5, dashArray: "8 6", fillColor: "#b7ff4a", fillOpacity: 0.08 },
        }).bindTooltip("AOI שסומן על ידי המשתמש").addTo(drawingLayer);
      }

      if (analysis?.location) {
        const [west, south, east, north] = analysis.location.bbox;
        const analysisBounds = L.latLngBounds([south, west], [north, east]);
        L.rectangle(analysisBounds, {
          color: "#72d5ff",
          weight: 2,
          dashArray: "8 7",
          fillColor: "#0ea5e9",
          fillOpacity: 0.04,
        })
          .bindTooltip("אזור החיפוש שפוענח מהבקשה")
          .addTo(aoiLayer);

        const previewScene = analysis.scenes.find((scene) => scene.id === preferredSceneId && scene.thumbnailUrl)
          || analysis.scenes.find((scene) => scene.role === "primary" && scene.thumbnailUrl)
          || analysis.scenes.find((scene) => scene.thumbnailUrl);
        const previewUrl = displayPreviewUrl(previewScene?.thumbnailUrl || null);
        if (previewScene && previewUrl) {
          const previewBounds = L.latLngBounds(
            [previewScene.bbox[1], previewScene.bbox[0]],
            [previewScene.bbox[3], previewScene.bbox[2]],
          );
          const preview = L.imageOverlay(previewUrl, previewBounds, {
            opacity: 0.74,
            crossOrigin: true,
            alt: `Quicklook ${previewScene.instrument}`,
          });
          const previewPopup = document.createElement("div");
          previewPopup.dir = "rtl";
          const sourceEvidenceId = analysis.ledger.entries.find((entry) => entry.kind === "scene" && entry.sourceId === previewScene.id)?.id || "ללא מזהה ראיה";
          previewPopup.textContent = `Quicklook של ${previewScene.instrument} מ-${new Date(previewScene.datetime).toLocaleDateString("he-IL")}. ${sourceEvidenceId}. זו תצוגת מקור, לא הוכחה שהמודל פענח את פיקסלי המפה הבסיסית.`;
          preview.bindPopup(previewPopup).addTo(sourceLayer);
        }

        for (const [index, scene] of analysis.scenes.entries()) {
          const footprint = scene.geometry
            ? L.geoJSON(scene.geometry as Parameters<typeof L.geoJSON>[0], {
                style: {
                  color: index === 0 ? "#b7ff4a" : "#a78bfa",
                  weight: index === 0 ? 2.5 : 1.5,
                  dashArray: index === 0 ? "" : "6 6",
                  fillOpacity: 0.02,
                },
              })
            : L.rectangle(
                L.latLngBounds([scene.bbox[1], scene.bbox[0]], [scene.bbox[3], scene.bbox[2]]),
                { color: "#a78bfa", weight: 1.5, dashArray: "6 6", fillOpacity: 0.02 },
              );
          footprint.bindTooltip(`${scene.instrument} · ${new Date(scene.datetime).toLocaleDateString("he-IL")}`);
          const popup = document.createElement("div");
          popup.dir = "rtl";
          popup.textContent = `${scene.catalog} · ציון בחירה ${Math.round(scene.qualityScore)}/100 · ${scene.assetAccess}`;
          footprint.bindPopup(popup);
          footprint.addTo(sceneLayer);
        }

        for (const event of analysis.events) {
          const marker = L.circleMarker([event.coordinates[1], event.coordinates[0]], {
            radius: 7,
            color: "#fff4dc",
            weight: 2,
            fillColor: "#ff6b3d",
            fillOpacity: 0.95,
          });
          const tooltip = document.createElement("span");
          tooltip.textContent = `${event.title} · ${new Date(event.date).toLocaleDateString("he-IL")}`;
          const popup = document.createElement("div");
          popup.dir = "rtl";
          const label = document.createElement("strong");
          label.textContent = event.title;
          const source = document.createElement("a");
          source.href = event.sourceUrl;
          source.target = "_blank";
          source.rel = "noreferrer";
          source.textContent = `${event.source} · ${new Date(event.date).toLocaleDateString("he-IL")}`;
          popup.appendChild(label);
          popup.appendChild(document.createElement("br"));
          popup.appendChild(source);
          marker.bindTooltip(tooltip).bindPopup(popup).addTo(eventLayer);
        }

        const verifiedDetection = analysis.findingStatus === "detected"
          && analysis.feasibility.realModelRun
          && analysis.model.status === "completed"
          && isVerifiedDetection(analysis)
          && analysis.detectionGeometry;
        if (verifiedDetection) {
          const detectionGeoJson = L.geoJSON(verifiedDetection as Parameters<typeof L.geoJSON>[0], {
            style: (feature) => {
              const color = detectionPalette(recordValue(feature?.properties));
              return {
                color,
                weight: 3,
                fillColor: color,
                fillOpacity: 0.24,
              };
            },
            pointToLayer: (feature, latlng) => {
              const color = detectionPalette(recordValue(feature?.properties));
              return L.circleMarker(latlng, {
                radius: 8,
                color: "#ffffff",
                weight: 2,
                fillColor: color,
                fillOpacity: 1,
              });
            },
            onEachFeature: (feature, layer) => {
              const properties = recordValue(feature.properties);
              const label = detectionLabel(properties);
              const score = detectionScore(properties);
              const requestedColor = typeof properties.requestedColor === "string"
                ? properties.requestedColor
                : typeof properties.color === "string"
                  ? properties.color
                  : null;
              const sceneId = typeof properties.sceneId === "string" ? properties.sceneId : null;
              const popup = document.createElement("div");
              popup.dir = "rtl";
              const title = document.createElement("strong");
              title.textContent = label;
              popup.appendChild(title);
              const details = [
                score === null ? null : `ציון מודל ${score.toFixed(1)}%`,
                requestedColor ? `צבע מבוקש: ${requestedColor}` : null,
                sceneId ? `סצנת מקור: ${sceneId}` : null,
                analysis.model.runId ? `ריצה: ${analysis.model.runId}` : null,
              ].filter((value): value is string => Boolean(value));
              if (details.length) {
                popup.appendChild(document.createElement("br"));
                popup.appendChild(document.createTextNode(details.join(" · ")));
              }
              layer.bindTooltip(label).bindPopup(popup);
            },
          });
          if (verifiedDetection.type !== "FeatureCollection") {
            const detectionPopup = document.createElement("div");
            detectionPopup.dir = "rtl";
            detectionPopup.textContent = analysis.measurements?.areaKm2 === null || !analysis.measurements
              ? `תוצאת ${analysis.model.name}${analysis.model.runId ? ` · ריצה ${analysis.model.runId}` : ""}`
              : `תוצאת ${analysis.model.name} · שטח ${analysis.measurements.areaKm2.toLocaleString("he-IL")} קמ״ר${analysis.model.runId ? ` · ריצה ${analysis.model.runId}` : ""}`;
            detectionGeoJson.bindTooltip("תוצאת מודל מאומתת").bindPopup(detectionPopup);
          }
          detectionGeoJson.addTo(modelLayer);
          const detectedBounds = detectionGeoJson.getBounds();
          if (detectedBounds.isValid()) map.fitBounds(detectedBounds.pad(0.15), { maxZoom: 18 });
        }

        if (!verifiedDetection) map.fitBounds(analysisBounds.pad(0.08), { maxZoom: 11 });
      }

      resizeTimer = window.setTimeout(() => map.invalidateSize(), 50);
      setReady(true);
    }

    createMap().catch(() => {
      if (!active) return;
      setReady(false);
      setMapError("המפה לא נטענה. אפשר לנסות שוב או לעבור לתצוגת תצלום הלוויין.");
    });
    return () => {
      active = false;
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [analysis, preferredSceneId, draftAoi]);

  return (
    <div className="map-shell" aria-label="מפת ניתוח לוויין אינטראקטיבית">
      {!ready && <div className="map-loading">{mapError || "טוען שכבות לוויין"}</div>}
      <div ref={containerRef} className="geo-map" />
      <div className="map-status">
        <span className="live-dot" />
        {analysis ? `${mapSession?.assets.length || 0} שכבות מקושרות לראיות · ${analysis.findingStatus}` : "ממתין לבקשת פענוח"}
      </div>
    </div>
  );
}
