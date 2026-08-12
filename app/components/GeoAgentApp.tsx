"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type {
  AgentResponse,
  AnalysisResponse,
  BrainRun,
  ConversationAnswerResponse,
  ConversationContext,
  GeoJsonGeometry,
  SceneResult,
} from "@/app/types";
import { displayPreviewUrl } from "@/lib/preview-url";
import { GeoMap } from "./GeoMap";

type ConversationItem =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; result: AnalysisResponse }
  | { id: string; role: "answer"; response: ConversationAnswerResponse }
  | { id: string; role: "error"; text: string };

type CanvasMode = "map" | "satellite";

const EXAMPLES = [
  "האם היו הצפות בצפון-מערב ניו אורלינס ב-15 באוגוסט 2023?",
  "מפה את צלקת השריפה סביב לחאינה לאחר השריפה באוגוסט 2023.",
];

const BRAIN_STAGES = [
  "מפרש את הבקשה",
  "מחפש סצנות מתאימות",
  "בודק ראיות ומודל",
  "מנסח תשובה",
];

function loadSavedAnalysis() {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem("geolens-last-analysis");
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as AnalysisResponse & { brain?: BrainRun };
    if (parsed.exportsVersion !== "geolens-export/v1" || !parsed.mission || !parsed.feasibility || !parsed.ledger) {
      window.localStorage.removeItem("geolens-last-analysis");
      return null;
    }
    return {
      ...parsed,
      location: parsed.location ? {
        ...parsed.location,
        source: parsed.location.source || "validated-geocoder",
        matchQuality: parsed.location.matchQuality || "translated",
        resultType: parsed.location.resultType || "legacy-result",
      } : null,
      feasibility: {
        ...parsed.feasibility,
        eligibleSceneIds: parsed.feasibility.eligibleSceneIds
          || parsed.scenes.filter((scene) => scene.assetAccess === "public-http").map((scene) => scene.id),
        realModelRun: parsed.feasibility.realModelRun ?? parsed.model.status === "completed",
        canConcludeAbsence: parsed.feasibility.canConcludeAbsence ?? false,
      },
      brain: parsed.brain || {
        provider: "GeoLens",
        requestedModel: "openrouter/free",
        actualModel: null,
        status: "fallback",
        freeOnly: true,
        message: "תוצאה קודמת שנוצרה לפני חיבור OpenRouter.",
      },
    } satisfies AnalysisResponse;
  } catch {
    window.localStorage.removeItem("geolens-last-analysis");
    return null;
  }
}

function localCalendarDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function conversationContext(result: AnalysisResponse | null): ConversationContext | null {
  if (!result) return null;
  return {
    previousQuery: result.query,
    previousAnswer: result.answer,
    interpretation: result.interpretation,
    location: result.location,
    sensors: [...new Set(result.scenes.map((scene) => scene.instrument).filter(Boolean))].slice(0, 8),
    sceneCount: result.scenes.length,
    eligibleSceneCount: result.feasibility.eligibleSceneIds.length,
    findingStatus: result.findingStatus,
    feasibilityStatus: result.feasibility.status,
    model: {
      name: result.model.name,
      status: result.model.status,
      realModelRun: result.feasibility.realModelRun,
      detected: result.model.detected,
      message: result.model.message,
    },
    limitations: result.limitations.slice(0, 8),
    clarification: result.clarification,
  };
}

function isConversationAnswer(payload: AgentResponse): payload is ConversationAnswerResponse {
  return "kind" in payload && payload.kind === "answer";
}

function downloadArtifact(filename: string, value: unknown, mime = "application/json") {
  const blob = new Blob([typeof value === "string" ? value : JSON.stringify(value, null, 2)], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function geometryFeatureCollection(geometry: GeoJsonGeometry | null, result: AnalysisResponse) {
  if (!geometry) return { type: "FeatureCollection", features: [] };
  if (geometry.type === "FeatureCollection") return geometry;
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry,
      properties: {
        missionId: result.mission?.missionId || result.ledger.missionId,
        findingStatus: result.findingStatus,
        model: result.model.name,
      },
    }],
  };
}

function ledgerCsv(result: AnalysisResponse) {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const header = ["id", "kind", "title", "source", "source_id", "observed_at", "url"];
  const rows = result.ledger.entries.map((entry) => [
    entry.id,
    entry.kind,
    entry.title,
    entry.source,
    entry.sourceId,
    entry.observedAt,
    entry.url,
  ]);
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}

function sourceRole(scene: SceneResult) {
  if (scene.role === "primary") return "מקור ראשי";
  if (scene.role === "confirmation") return "מקור אימות";
  return "מקור הקשר";
}

function SatelliteCanvas({
  analysis,
  scenes,
  selectedSceneId,
  onSelectScene,
  onSceneError,
}: {
  analysis: AnalysisResponse | null;
  scenes: SceneResult[];
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  onSceneError: (sceneId: string) => void;
}) {
  const selected = scenes.find((scene) => scene.id === selectedSceneId)
    || scenes.find((scene) => scene.role === "primary")
    || scenes[0];
  const previewUrl = displayPreviewUrl(selected?.thumbnailUrl || null);

  if (!analysis || !selected || !previewUrl) {
    return (
      <div className="satellite-empty">
        <strong>אין תצלום מקור זמין</strong>
        <p>אפשר להמשיך לעבוד במפה או להריץ בקשה אחרת.</p>
      </div>
    );
  }

  return (
    <div className="satellite-canvas" aria-label="תצלום הלוויין שנבחר">
      <Image
        src={previewUrl}
        alt={`תצלום מקור ${selected.instrument} מתאריך ${selected.datetime}`}
        fill
        unoptimized
        className="satellite-primary"
        sizes="100vw"
        onError={() => onSceneError(selected.id)}
      />
      <div className="satellite-meta">
        <span>{sourceRole(selected)}</span>
        <strong>{selected.instrument}</strong>
        <small>{new Date(selected.datetime).toLocaleDateString("he-IL")} · {selected.catalog}</small>
      </div>
      {scenes.length > 1 && (
        <div className="scene-switcher" role="group" aria-label="בחירת סצנת מקור">
          {scenes.map((scene, index) => (
            <button
              key={scene.id}
              type="button"
              className={scene.id === selected.id ? "is-selected" : ""}
              onClick={() => onSelectScene(scene.id)}
              aria-pressed={scene.id === selected.id}
              aria-label={`הצג סצנה ${index + 1}, ${scene.instrument}, ${new Date(scene.datetime).toLocaleDateString("he-IL")}`}
            >
              {String(index + 1).padStart(2, "0")}
            </button>
          ))}
        </div>
      )}
      <p className="satellite-disclaimer">תצוגת Quicklook של סצנת המקור, לא פענוח פיקסלים.</p>
    </div>
  );
}

function AssistantTextMessage({
  result,
  active,
  onActivate,
}: {
  result: AnalysisResponse;
  active: boolean;
  onActivate: () => void;
}) {
  return (
    <article
      className="assistant-message"
      aria-current={active ? "true" : undefined}
    >
      <p className="assistant-answer"><span className="sr-only">תשובת GeoLens: </span>{result.answer}</p>
      {result.clarification && !result.answer.includes(result.clarification) && (
        <p className="assistant-clarification">{result.clarification}</p>
      )}
      {!active && <button type="button" className="message-map-action" onClick={onActivate}>הצג במפה</button>}
    </article>
  );
}

function EvidenceDrawer({
  analysis,
  onClose,
}: {
  analysis: AnalysisResponse;
  onClose: () => void;
}) {
  return (
    <aside className="evidence-drawer" id="evidence-drawer" aria-label="מקורות ונתוני פענוח">
      <header>
        <div>
          <span>מידע משלים</span>
          <h2>מקורות ונתוני פענוח</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="סגירת חלונית המקורות">סגור</button>
      </header>

      <p className="evidence-verdict">{analysis.verdict}</p>

      <section>
        <h3>סצנות מקור</h3>
        {analysis.scenes.length ? (
          <div className="evidence-list">
            {analysis.scenes.map((scene) => (
              <a href={scene.stacUrl} target="_blank" rel="noreferrer" key={scene.id}>
                <strong>{scene.instrument}</strong>
                <span>{new Date(scene.datetime).toLocaleDateString("he-IL")} · {scene.catalog}</span>
              </a>
            ))}
          </div>
        ) : <p>לא נמצאו סצנות מקור מתאימות.</p>}
      </section>

      <section>
        <h3>מודל</h3>
        <p>{analysis.model.name}: {analysis.model.message}</p>
      </section>

      {analysis.limitations.length > 0 && (
        <section>
          <h3>מגבלות</h3>
          <ul>{analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      )}

      <div className="evidence-actions">
        <button type="button" onClick={() => downloadArtifact(`geolens-${analysis.ledger.missionId}.json`, analysis.ledger)}>JSON</button>
        <button
          type="button"
          disabled={!analysis.detectionGeometry}
          onClick={() => downloadArtifact(
            `geolens-${analysis.ledger.missionId}.geojson`,
            geometryFeatureCollection(analysis.detectionGeometry, analysis),
            "application/geo+json",
          )}
        >GeoJSON</button>
        <button type="button" onClick={() => downloadArtifact(`geolens-${analysis.ledger.missionId}.csv`, ledgerCsv(analysis), "text/csv;charset=utf-8")}>CSV</button>
      </div>
    </aside>
  );
}

export function GeoAgentApp() {
  const [query, setQuery] = useState("");
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("map");
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [failedPreviewIds, setFailedPreviewIds] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState(true);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [brainStage, setBrainStage] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const chatLauncherRef = useRef<HTMLButtonElement>(null);
  const evidenceTriggerRef = useRef<HTMLButtonElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const messageSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      const saved = loadSavedAnalysis();
      if (!saved || cancelled) return;
      setAnalysis(saved);
      setConversation([
        { id: "saved-user", role: "user", text: saved.query },
        { id: "saved-result", role: "assistant", result: saved },
      ]);
      setActiveResultId("saved-result");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const interval = window.setInterval(
      () => setBrainStage((current) => (current + 1) % BRAIN_STAGES.length),
      1_150,
    );
    return () => window.clearInterval(interval);
  }, [busy]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [conversation, busy]);

  async function submitQuery(rawQuery?: string) {
    const text = (rawQuery ?? query).trim();
    if (!text || busy) return;
    setQuery("");
    setBusy(true);
    setBrainStage(0);
    setStatusMessage("הפענוח התחיל.");
    setChatOpen(true);
    messageSequence.current += 1;
    setConversation((items) => [...items, { id: `user-${messageSequence.current}`, role: "user", text }]);

    const controller = new AbortController();
    activeRequestRef.current = controller;
    const requestGeneration = requestGenerationRef.current;
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: text,
          clientDate: localCalendarDate(),
          conversationContext: conversationContext(analysis),
        }),
      });
      const payload = (await response.json()) as AgentResponse | { error: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "הניתוח נכשל");
      if (requestGeneration !== requestGenerationRef.current) return;

      messageSequence.current += 1;
      if (isConversationAnswer(payload)) {
        setConversation((items) => [...items, { id: `answer-${messageSequence.current}`, role: "answer", response: payload }]);
        setStatusMessage("התשובה הושלמה.");
        return;
      }

      setAnalysis(payload);
      setSelectedSceneId(null);
      setEvidenceOpen(false);
      if (!payload.scenes.some((scene) => displayPreviewUrl(scene.thumbnailUrl))) setCanvasMode("map");
      window.localStorage.setItem("geolens-last-analysis", JSON.stringify(payload));
      const assistantId = `assistant-${messageSequence.current}`;
      setActiveResultId(assistantId);
      setConversation((items) => [...items, { id: assistantId, role: "assistant", result: payload }]);
      setStatusMessage("הפענוח הושלם.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (requestGeneration !== requestGenerationRef.current) return;
      const message = error instanceof Error ? error.message : "הסוכן לא הצליח להשלים את הניתוח.";
      messageSequence.current += 1;
      setConversation((items) => [...items, { id: `error-${messageSequence.current}`, role: "error", text: message }]);
      setStatusMessage(`הפענוח נכשל: ${message}`);
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        setBusy(false);
        activeRequestRef.current = null;
      }
    }
  }

  function resetConversation() {
    requestGenerationRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    window.localStorage.removeItem("geolens-last-analysis");
    messageSequence.current = 0;
    setQuery("");
    setConversation([]);
    setAnalysis(null);
    setActiveResultId(null);
    setSelectedSceneId(null);
    setFailedPreviewIds([]);
    setEvidenceOpen(false);
    setCanvasMode("map");
    setBusy(false);
    setBrainStage(0);
    setStatusMessage("השיחה אופסה.");
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submitQuery();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitQuery();
    }
  }

  const previewScenes = analysis?.scenes.filter(
    (scene) => displayPreviewUrl(scene.thumbnailUrl) && !failedPreviewIds.includes(scene.id),
  ) || [];
  const selectedScene = previewScenes.find((scene) => scene.id === selectedSceneId)
    || previewScenes.find((scene) => scene.role === "primary")
    || previewScenes[0];

  return (
    <main className={`geo-app${chatOpen ? " chat-is-open" : ""}`} dir="rtl">
      <section className="canvas-shell" aria-label="קנבס גיאו-מרחבי">
        <div className="canvas-stage">
          <div className={`canvas-view${canvasMode === "map" ? " is-active" : ""}`} aria-hidden={canvasMode !== "map"}>
            <GeoMap analysis={analysis} preferredSceneId={selectedScene?.id || null} />
          </div>
          <div className={`canvas-view${canvasMode === "satellite" ? " is-active" : ""}`} aria-hidden={canvasMode !== "satellite"}>
            <SatelliteCanvas
              analysis={analysis}
              scenes={previewScenes}
              selectedSceneId={selectedScene?.id || null}
              onSelectScene={setSelectedSceneId}
              onSceneError={(sceneId) => {
                setFailedPreviewIds((current) => current.includes(sceneId) ? current : [...current, sceneId]);
                if (previewScenes.every((scene) => scene.id === sceneId)) setCanvasMode("map");
              }}
            />
          </div>
        </div>

        <header className="canvas-toolbar">
          <div className="brand-mini" aria-label="GeoLens">
            <span className="brand-dot" />
            <strong>GeoLens</strong>
          </div>
          <div className="canvas-controls" role="group" aria-label="בחירת תצוגה">
            <button type="button" className={canvasMode === "map" ? "is-active" : ""} onClick={() => setCanvasMode("map")} aria-pressed={canvasMode === "map"}>מפה</button>
            <button
              type="button"
              className={canvasMode === "satellite" ? "is-active" : ""}
              onClick={() => setCanvasMode("satellite")}
              aria-pressed={canvasMode === "satellite"}
              disabled={!previewScenes.length}
            >תצלום לוויין</button>
          </div>
          <button
            ref={evidenceTriggerRef}
            type="button"
            className="evidence-trigger"
            disabled={!analysis}
            onClick={() => {
              setEvidenceOpen((current) => !current);
              setChatOpen(false);
            }}
            aria-expanded={evidenceOpen}
            aria-controls="evidence-drawer"
          >מקורות</button>
        </header>
      </section>

      {analysis && evidenceOpen && (
        <EvidenceDrawer
          analysis={analysis}
          onClose={() => {
            setEvidenceOpen(false);
            window.requestAnimationFrame(() => evidenceTriggerRef.current?.focus());
          }}
        />
      )}

      {chatOpen ? (
        <section className="chat-overlay" id="chat-panel" aria-label="שיחה עם GeoLens">
          <header className="chat-header">
            <div>
              <strong>שיחה עם GeoLens</strong>
              <span>{analysis?.location?.name || "שאל על אירוע, מקום או זמן"}</span>
            </div>
            <div className="chat-header-actions">
              <button
                type="button"
                className="reset-chat"
                onClick={resetConversation}
                disabled={!conversation.length && !query && !busy}
                aria-label="פתיחת שיחה חדשה ונקייה"
              >שיחה חדשה</button>
              <button
                type="button"
                onClick={() => {
                  setChatOpen(false);
                  window.requestAnimationFrame(() => chatLauncherRef.current?.focus());
                }}
                aria-label="מזעור הצ׳אט"
              >מזער</button>
            </div>
          </header>

          <p className="sr-only" aria-live="polite">{statusMessage}</p>

          <div className="message-stream">
            {conversation.length === 0 && (
              <div className="chat-empty">
                <p>מה תרצה לאתר?</p>
                <div>
                  {EXAMPLES.map((example) => (
                    <button key={example} type="button" onClick={() => submitQuery(example)}>{example}</button>
                  ))}
                </div>
              </div>
            )}

            {conversation.map((item) => {
              if (item.role === "user") return <div className="user-message" key={item.id}>{item.text}</div>;
              if (item.role === "error") return <div className="error-message" role="alert" key={item.id}>{item.text}</div>;
              if (item.role === "answer") return (
                <article className="assistant-message conversation-answer" key={item.id}>
                  <p className="assistant-answer"><span className="sr-only">תשובת GeoLens: </span>{item.response.answer}</p>
                </article>
              );
              return (
                <AssistantTextMessage
                  key={item.id}
                  result={item.result}
                  active={activeResultId === item.id}
                  onActivate={() => {
                    setAnalysis(item.result);
                    setActiveResultId(item.id);
                    setSelectedSceneId(null);
                    setEvidenceOpen(false);
                    if (!item.result.scenes.some((scene) => displayPreviewUrl(scene.thumbnailUrl))) setCanvasMode("map");
                    window.localStorage.setItem("geolens-last-analysis", JSON.stringify(item.result));
                  }}
                />
              );
            })}

            {busy && (
              <div className="thinking-message" aria-label={BRAIN_STAGES[brainStage]}>
                <span /><span /><span />
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="prompt-box" onSubmit={handleSubmit}>
            <textarea
              ref={promptRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="כתוב בקשה..."
              rows={2}
              aria-label="בקשת ניתוח לוויין"
              aria-describedby="prompt-hint"
            />
            <span className="sr-only" id="prompt-hint">Enter שולח את הבקשה. Shift ו-Enter מוסיפים שורה חדשה.</span>
            <button type="submit" disabled={!query.trim() || busy}>שלח</button>
          </form>
        </section>
      ) : (
        <button
          ref={chatLauncherRef}
          type="button"
          className="chat-launcher"
          onClick={() => {
            setChatOpen(true);
            setEvidenceOpen(false);
            window.requestAnimationFrame(() => promptRef.current?.focus());
          }}
          aria-expanded="false"
          aria-controls="chat-panel"
        >פתח צ׳אט</button>
      )}
    </main>
  );
}
