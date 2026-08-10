"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { AnalysisResponse, BrainRun, ModelRun, SceneResult } from "@/app/types";
import { GeoMap } from "./GeoMap";

type ConversationItem =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; result: AnalysisResponse }
  | { id: string; role: "error"; text: string };

const EXAMPLES = [
  "האם היו הצפות בצפון-מערב ניו אורלינס ב-15 באוגוסט 2023? הצג תמונות מקור ופוליגון אם זוהה.",
  "מפה את צלקת השריפה סביב לחאינה לאחר השריפה באוגוסט 2023 והסבר באיזה חיישן השתמשת.",
  "אתר התפרצויות הרי געש באיסלנד בחמש השנים האחרונות והצג את סצנות הלוויין המתאימות.",
  "חפש כלי שיט חריגים במפרץ חיפה ב-45 הימים האחרונים והסבר את מגבלת הזיהוי.",
];

const BRAIN_STAGES = [
  "מפרק מקום, זמן ואובייקט",
  "בוחר חיישן ומתכון ספקטרלי",
  "מחפש סצנות ומקורות אימות",
  "בודק היתכנות ורזולוציה",
];

function loadSavedAnalysis() {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem("geolens-last-analysis");
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as AnalysisResponse & { brain?: BrainRun };
    return {
      ...parsed,
      brain: parsed.brain || {
        provider: "GeoLens",
        requestedModel: "openrouter/free",
        actualModel: null,
        status: "fallback",
        freeOnly: true,
        message: "תוצאה קודמת שנוצרה לפני חיבור OpenRouter.",
      },
    };
  } catch {
    window.localStorage.removeItem("geolens-last-analysis");
    return null;
  }
}

function confidenceLabel(result: AnalysisResponse) {
  if (result.confidence === "high") return "גבוהה";
  if (result.confidence === "medium") return "בינונית";
  if (result.confidence === "low") return "נמוכה";
  return "לא הוערכה";
}

function modeLabel(result: AnalysisResponse) {
  return {
    "catalog-confirmed": "אירוע מאומת בקטלוג",
    "model-detected": "זיהוי מודל",
    "source-only": "ראיית מקור בלבד",
    "not-feasible": "נדרשת רזולוציה אחרת",
  }[result.detectionMode];
}

function modelStatusLabel(model: ModelRun) {
  if (model.status === "completed") return "פענוח מודל הושלם";
  if (model.status === "blocked") return "המודל לא הופעל בגלל מגבלת קלט";
  if (model.status === "failed") return "שירות המודל לא השלים פענוח";
  if (model.status === "not-configured") return "מודל ייעודי מוכן לחיבור";
  return "לא נדרש מודל ייעודי";
}

function brainStatusLabel(brain: BrainRun) {
  if (brain.status === "completed") return "מוח הסוכן מחובר";
  if (brain.status === "not-configured") return "OpenRouter אינו מוגדר";
  return "פענוח מקומי פעיל";
}

function sourceRole(scene: SceneResult) {
  if (scene.role === "primary") return "מקור ראשי";
  if (scene.role === "confirmation") return "מקור אימות";
  return "הקשר חזותי";
}

function SceneCard({ scene }: { scene: SceneResult }) {
  return (
    <article className="scene-card">
      <div className="scene-image-wrap">
        {scene.thumbnailUrl ? (
          <Image
            src={scene.thumbnailUrl}
            alt={`תמונת מקור ${scene.instrument}`}
            className="scene-image"
            fill
            unoptimized
            sizes="(max-width: 720px) 100vw, 360px"
          />
        ) : (
          <div className="scene-image-missing">אין Quicklook ציבורי</div>
        )}
        <span className="scene-role">{sourceRole(scene)}</span>
      </div>
      <div className="scene-content">
        <div className="scene-heading">
          <strong>{scene.instrument}</strong>
          <span>{new Date(scene.datetime).toLocaleDateString("he-IL")}</span>
        </div>
        <p>{scene.id}</p>
        <dl className="scene-metrics">
          <div>
            <dt>רזולוציה</dt>
            <dd>{scene.resolution}</dd>
          </div>
          <div>
            <dt>עננות</dt>
            <dd>{scene.cloudCover === null ? "לא רלוונטי" : `${scene.cloudCover.toFixed(1)}%`}</dd>
          </div>
        </dl>
        <div className="source-links">
          <a href={scene.stacUrl} target="_blank" rel="noreferrer">STAC</a>
          {scene.assets.slice(0, 3).map((asset) => (
            <a key={`${scene.id}-${asset.label}`} href={asset.href} target="_blank" rel="noreferrer">
              {asset.label}
            </a>
          ))}
        </div>
      </div>
    </article>
  );
}

function ResultMessage({ result }: { result: AnalysisResponse }) {
  return (
    <div className="assistant-message">
      <div className="assistant-mark">G</div>
      <div className="assistant-body">
        <div className="result-topline">
          <span className={`mode-badge mode-${result.detectionMode}`}>{modeLabel(result)}</span>
          <span className="timestamp">{new Date(result.generatedAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <h2>{result.recipe.title}</h2>
        <p className="answer-copy">{result.answer}</p>

        {result.clarification && <div className="clarification">{result.clarification}</div>}

        <section className="decoder-summary" aria-label="פירוש הבקשה">
          <div>
            <span>יעד</span>
            <strong>{result.interpretation.intentLabel}</strong>
          </div>
          <div>
            <span>מקום</span>
            <strong>{result.location?.name || "לא זוהה"}</strong>
          </div>
          <div>
            <span>זמן</span>
            <strong>{result.interpretation.dateLabel}</strong>
          </div>
          <div>
            <span>ביטחון</span>
            <strong>{confidenceLabel(result)} · {Math.round(result.confidenceScore * 100)}%</strong>
          </div>
        </section>

        <details className="reasoning-panel" open>
          <summary>תהליך הפענוח</summary>
          <div className="reasoning-list">
            {result.steps.map((step, index) => (
              <div className={`reasoning-step step-${step.status}`} key={step.id}>
                <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{step.label}</strong>
                  <p>{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </details>

        <section className="recipe-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">מתכון פענוח</span>
              <h3>{result.recipe.target}</h3>
            </div>
            <span className="sensor-pill">{result.recipe.primarySensor}</span>
          </div>
          <div className="bands-row">
            {result.recipe.bands.map((band) => <span key={band}>{band}</span>)}
          </div>
          <ol>
            {result.recipe.method.map((method) => <li key={method}>{method}</li>)}
          </ol>
          <div className="recipe-footer">
            <span>סף אמינות</span>
            <strong>{result.recipe.minimumReliableScale}</strong>
          </div>
        </section>

        {result.scenes.length > 0 && (
          <section className="sources-section">
            <div className="panel-heading compact-heading">
              <div>
                <span className="eyebrow">ראיות מקור</span>
                <h3>הדמאות הלוויין שנבחרו</h3>
              </div>
              <span>{result.scenes.length} סצנות</span>
            </div>
            <div className="scene-grid">
              {result.scenes.slice(0, 4).map((scene) => <SceneCard key={scene.id} scene={scene} />)}
            </div>
          </section>
        )}

        {result.events.length > 0 && (
          <section className="events-panel">
            <span className="eyebrow">אימות חיצוני</span>
            {result.events.map((event) => (
              <a href={event.sourceUrl} target="_blank" rel="noreferrer" key={event.id}>
                <span className="event-dot" />
                <span>
                  <strong>{event.title}</strong>
                  <small>{new Date(event.date).toLocaleDateString("he-IL")} · {event.source}</small>
                </span>
              </a>
            ))}
          </section>
        )}

        {result.limitations.length > 0 && (
          <section className="limitations-panel">
            <strong>מגבלות שאסור להתעלם מהן</strong>
            <ul>
              {result.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </section>
        )}

        <div className={`brain-status brain-${result.brain.status}`}>
          <span className={result.brain.status === "completed" ? "model-connected" : "model-ready"} />
          <div>
            <strong>{brainStatusLabel(result.brain)} · {result.brain.actualModel || result.brain.requestedModel}</strong>
            <p>{result.brain.message}</p>
            <small>מסלול חינמי בלבד, ללא מעבר אוטומטי למודל בתשלום</small>
          </div>
        </div>

        <div className={`model-status model-${result.model.status}`}>
          <span className={result.model.status === "completed" ? "model-connected" : result.model.status === "not-configured" ? "model-ready" : "model-warning"} />
          <div>
            <strong>{modelStatusLabel(result.model)} · {result.model.name}</strong>
            <p>{result.model.message}</p>
            {result.model.modelCardUrl && (
              <a className="model-card-link" href={result.model.modelCardUrl} target="_blank" rel="noreferrer">
                פרטי המודל והקלט הנדרש
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GeoAgentApp() {
  const [query, setQuery] = useState("");
  const [conversation, setConversation] = useState<ConversationItem[]>(() => {
    const saved = loadSavedAnalysis();
    return saved
      ? [
          { id: "saved-user", role: "user", text: saved.query },
          { id: "saved-result", role: "assistant", result: saved },
        ]
      : [];
  });
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(() => loadSavedAnalysis());
  const [busy, setBusy] = useState(false);
  const [brainStage, setBrainStage] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const messageSequence = useRef(0);

  useEffect(() => {
    if (!busy) return;
    const interval = window.setInterval(() => setBrainStage((current) => (current + 1) % BRAIN_STAGES.length), 1_150);
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
    messageSequence.current += 1;
    const userItem: ConversationItem = { id: `user-${messageSequence.current}`, role: "user", text };
    setConversation((items) => [...items, userItem]);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const payload = (await response.json()) as AnalysisResponse | { error: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "הניתוח נכשל");
      setAnalysis(payload);
      window.localStorage.setItem("geolens-last-analysis", JSON.stringify(payload));
      messageSequence.current += 1;
      setConversation((items) => [...items, { id: `assistant-${messageSequence.current}`, role: "assistant", result: payload }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "הסוכן לא הצליח להשלים את הניתוח.";
      messageSequence.current += 1;
      setConversation((items) => [...items, { id: `error-${messageSequence.current}`, role: "error", text: message }]);
    } finally {
      setBusy(false);
    }
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

  return (
    <main className="app-shell" dir="rtl">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-symbol"><span /></div>
          <div>
            <strong>GeoLens</strong>
            <span>Autonomous EO Interpreter</span>
          </div>
        </div>
      </header>

      <div className="workspace">
        <section className="conversation-panel" aria-label="שיחה עם סוכן הפענוח">
          <div className="conversation-heading">
            <div>
              <span className="eyebrow">סוכן פענוח עצמאי</span>
              <h1>מה תרצה לאתר בכדור הארץ?</h1>
              <p>כתוב מטרה, מקום וזמן. הסוכן יחליט מה ניתן לזהות, באיזה חיישן ואיך לאמת את התוצאה.</p>
            </div>
            <div className="brain-chip">
              <span className="brain-orbit"><i /></span>
              Evidence-first
            </div>
          </div>

          {conversation.length === 0 && (
            <div className="empty-state">
              <div className="empty-grid">
                <div>
                  <span>01</span>
                  <strong>מפרש</strong>
                  <p>מחלץ מקום, זמן, אובייקט ורמת דיוק מבוקשת.</p>
                </div>
                <div>
                  <span>02</span>
                  <strong>מתכנן</strong>
                  <p>בוחר חיישן, ערוצים ספקטרליים ותמונת בסיס.</p>
                </div>
                <div>
                  <span>03</span>
                  <strong>מאמת</strong>
                  <p>מפריד בין מקור, דיווח קטלוגי ותוצאת מודל.</p>
                </div>
              </div>
              <p className="examples-label">אפשר להתחיל מדוגמה</p>
              <div className="example-list">
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" onClick={() => submitQuery(example)}>{example}</button>
                ))}
              </div>
            </div>
          )}

          <div className="message-stream" aria-live="polite">
            {conversation.map((item) => {
              if (item.role === "user") return <div className="user-message" key={item.id}>{item.text}</div>;
              if (item.role === "error") return <div className="error-message" key={item.id}>{item.text}</div>;
              return <ResultMessage key={item.id} result={item.result} />;
            })}
            {busy && (
              <div className="thinking-card">
                <div className="thinking-radar"><span /></div>
                <div>
                  <strong>המפענח עובד</strong>
                  <p>{BRAIN_STAGES[brainStage]}</p>
                  <div className="thinking-progress"><span style={{ width: `${((brainStage + 1) / BRAIN_STAGES.length) * 100}%` }} /></div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="prompt-box" onSubmit={handleSubmit}>
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="לדוגמה: אתר אזורי הצפה ליד ניו אורלינס ב-15 באוגוסט 2023 והצג פוליגון אם קיים"
              rows={2}
              aria-label="בקשת ניתוח לוויין"
            />
            <div className="prompt-footer">
              <span>Enter לשליחה · Shift+Enter לשורה חדשה</span>
              <button type="submit" disabled={!query.trim() || busy} aria-label="שליחת בקשת ניתוח">
                <span>פענח</span>
                <i />
              </button>
            </div>
          </form>
        </section>

        <aside className="intel-panel" aria-label="מפה ופרטי מודיעין">
          <div className="intel-header">
            <div>
              <span className="eyebrow">תמונת מצב</span>
              <h2>{analysis?.location?.name || "מפה מבצעית"}</h2>
            </div>
            <span className="coordinates">
              {analysis?.location ? `${analysis.location.latitude.toFixed(3)}, ${analysis.location.longitude.toFixed(3)}` : "32.000, 35.000"}
            </span>
          </div>
          <GeoMap analysis={analysis} />
        </aside>
      </div>
    </main>
  );
}
