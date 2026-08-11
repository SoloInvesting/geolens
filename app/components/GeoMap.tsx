"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisResponse } from "@/app/types";
import { displayPreviewUrl } from "@/lib/preview-url";

type GeoMapProps = {
  analysis: AnalysisResponse | null;
  preferredSceneId?: string | null;
};

export function GeoMap({ analysis, preferredSceneId = null }: GeoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

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
      const evidenceLayer = L.layerGroup().addTo(map);
      const sceneLayer = L.layerGroup().addTo(map);
      const scenePreviewLayer = L.layerGroup().addTo(map);

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

      const refreshBasemapControl = (button: HTMLButtonElement, preview: HTMLElement, label: HTMLElement) => {
        const satelliteActive = map.hasLayer(satellite);
        const nextMode = satelliteActive ? "מפה" : "תצלום לוויין";
        button.setAttribute("aria-label", `עבור ל${nextMode}`);
        button.title = `עבור ל${nextMode}`;
        button.dataset.currentMode = satelliteActive ? "satellite" : "map";
        preview.style.backgroundImage = `url("${tilePreviewUrl(satelliteActive ? basemapTemplate.street : basemapTemplate.satellite)}")`;
        label.textContent = nextMode;
      };

      basemapControl.onAdd = () => {
        const container = L.DomUtil.create("div", "basemap-switcher leaflet-bar");
        const button = L.DomUtil.create("button", "basemap-switcher-button", container) as HTMLButtonElement;
        button.type = "button";
        const preview = L.DomUtil.create("span", "basemap-switcher-preview", button);
        const copy = L.DomUtil.create("span", "basemap-switcher-copy", button);
        const eyebrow = L.DomUtil.create("span", "basemap-switcher-eyebrow", copy);
        eyebrow.textContent = "רקע הבא";
        const label = L.DomUtil.create("strong", "basemap-switcher-label", copy);
        const hint = L.DomUtil.create("small", "basemap-switcher-hint", copy);
        hint.textContent = "לחץ להחלפה";
        const refresh = () => refreshBasemapControl(button, preview, label);
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
          .addTo(evidenceLayer);

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
          previewPopup.textContent = `Quicklook של ${previewScene.instrument} מ-${new Date(previewScene.datetime).toLocaleDateString("he-IL")}. זו תצוגת מקור, לא הוכחה שהמודל פענח את פיקסלי המפה הבסיסית.`;
          preview.bindPopup(previewPopup).addTo(scenePreviewLayer);
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
          marker.bindTooltip(tooltip).bindPopup(popup).addTo(evidenceLayer);
        }

        if (analysis.detectionGeometry) {
          const detectionLayer = L.geoJSON(analysis.detectionGeometry as Parameters<typeof L.geoJSON>[0], {
            style: {
              color: "#ff3b5c",
              weight: 3,
              fillColor: "#ff3b5c",
              fillOpacity: 0.22,
            },
            pointToLayer: (_, latlng) =>
              L.circleMarker(latlng, {
                radius: 8,
                color: "#ffffff",
                weight: 2,
                fillColor: "#ff3b5c",
                fillOpacity: 1,
              }),
          });
          const detectionPopup = document.createElement("div");
          detectionPopup.dir = "rtl";
          detectionPopup.textContent = analysis.measurements?.areaKm2 === null || !analysis.measurements
            ? `תוצאת ${analysis.model.name}${analysis.model.runId ? ` · ריצה ${analysis.model.runId}` : ""}`
            : `תוצאת ${analysis.model.name} · שטח ${analysis.measurements.areaKm2.toLocaleString("he-IL")} קמ״ר${analysis.model.runId ? ` · ריצה ${analysis.model.runId}` : ""}`;
          detectionLayer.bindTooltip("תוצאת מודל").bindPopup(detectionPopup).addTo(evidenceLayer);
          const detectedBounds = detectionLayer.getBounds();
          if (detectedBounds.isValid()) map.fitBounds(detectedBounds.pad(0.15), { maxZoom: 14 });
        }

        if (!analysis.detectionGeometry) map.fitBounds(analysisBounds.pad(0.08), { maxZoom: 11 });
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
  }, [analysis, preferredSceneId]);

  return (
    <div className="map-shell" aria-label="מפת ניתוח לוויין אינטראקטיבית">
      {!ready && <div className="map-loading">{mapError || "טוען שכבות לוויין"}</div>}
      <div ref={containerRef} className="geo-map" />
      <div className="map-status">
        <span className="live-dot" />
        {analysis ? `${analysis.scenes.length} סצנות · ${analysis.feasibility.eligibleSceneIds.length} כשירות לניתוח · ${analysis.events.length} אירועים · ${analysis.findingStatus}` : "ממתין לבקשת פענוח"}
      </div>
    </div>
  );
}
