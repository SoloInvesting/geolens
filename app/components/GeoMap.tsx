"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisResponse } from "@/app/types";

type GeoMapProps = {
  analysis: AnalysisResponse | null;
};

export function GeoMap({ analysis }: GeoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    async function createMap() {
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
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
      }).setView(center, analysis?.location ? 9 : 5);
      mapRef.current = map;

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
      const sourceImageLayer = L.layerGroup().addTo(map);

      L.control
        .layers(
          { "תצלום לוויין": satellite, "מפת רחובות": street },
          {
            "תמונות מקור": sourceImageLayer,
            "טביעת רגל של סצנות": sceneLayer,
            "אירועים וזיהויים": evidenceLayer,
          },
          { position: "topright", collapsed: false },
        )
        .addTo(map);

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
          footprint.addTo(sceneLayer);

          if (scene.thumbnailUrl && index < 2) {
            L.imageOverlay(
              scene.thumbnailUrl,
              L.latLngBounds([scene.bbox[1], scene.bbox[0]], [scene.bbox[3], scene.bbox[2]]),
              { opacity: index === 0 ? 0.62 : 0.35, interactive: false },
            ).addTo(sourceImageLayer);
          }
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
          marker.bindTooltip(tooltip).addTo(evidenceLayer);
        }

        if (analysis.detectionGeometry) {
          L.geoJSON(analysis.detectionGeometry as Parameters<typeof L.geoJSON>[0], {
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
          })
            .bindTooltip("תוצאת מודל")
            .addTo(evidenceLayer);
        }

        map.fitBounds(analysisBounds.pad(0.08), { maxZoom: 11 });
      }

      const legend = new L.Control({ position: "bottomleft" });
      legend.onAdd = () => {
        const element = L.DomUtil.create("div", "geo-map-legend");
        element.innerHTML =
          '<div><span class="legend-line legend-search"></span>אזור חיפוש</div>' +
          '<div><span class="legend-line legend-scene"></span>סצנת מקור</div>' +
          '<div><span class="legend-dot"></span>אירוע קטלוגי</div>' +
          '<div><span class="legend-line legend-model"></span>תוצאת מודל</div>';
        return element;
      };
      legend.addTo(map);

      window.setTimeout(() => map.invalidateSize(), 50);
      setReady(true);
    }

    createMap();
    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [analysis]);

  return (
    <div className="map-shell" aria-label="מפת ניתוח לוויין אינטראקטיבית">
      {!ready && <div className="map-loading">טוען שכבות לוויין</div>}
      <div ref={containerRef} className="geo-map" />
      <div className="map-status">
        <span className="live-dot" />
        {analysis ? `${analysis.scenes.length} סצנות · ${analysis.events.length} אירועים` : "ממתין לבקשת פענוח"}
      </div>
    </div>
  );
}

