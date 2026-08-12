const HEBREW_MONTHS: Record<string, number> = {
  ינואר: 0,
  פברואר: 1,
  מרץ: 2,
  אפריל: 3,
  מאי: 4,
  יוני: 5,
  יולי: 6,
  אוגוסט: 7,
  ספטמבר: 8,
  אוקטובר: 9,
  נובמבר: 10,
  דצמבר: 11,
};

const ENGLISH_MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const HEBREW_NUMBER_WORDS: Record<string, number> = {
  אחת: 1,
  אחד: 1,
  שני: 2,
  שתי: 2,
  שנתיים: 2,
  שלושה: 3,
  שלוש: 3,
  שלושת: 3,
  ארבעה: 4,
  ארבע: 4,
  ארבעת: 4,
  חמישה: 5,
  חמש: 5,
  חמשת: 5,
  שישה: 6,
  שש: 6,
  ששת: 6,
  שבעה: 7,
  שבע: 7,
  שבעת: 7,
  שמונה: 8,
  שמונת: 8,
  תשעה: 9,
  תשע: 9,
  תשעת: 9,
  עשרה: 10,
  עשר: 10,
  עשרת: 10,
};

const HEBREW_AMOUNT_PATTERN = Object.keys(HEBREW_NUMBER_WORDS)
  .sort((left, right) => right.length - left.length)
  .join("|");
const HEBREW_MONTH_PATTERN = Object.keys(HEBREW_MONTHS).join("|");
const ENGLISH_MONTH_PATTERN = Object.keys(ENGLISH_MONTHS).join("|");
const TEMPORAL_WORDS = new Set([
  ...Object.keys(HEBREW_MONTHS),
  ...Object.keys(ENGLISH_MONTHS),
  "היום",
  "אתמול",
  "מחר",
  "שנה",
  "השנה",
  "שנים",
  "שבוע",
  "השבוע",
  "שבועיים",
  "חודש",
  "החודש",
  "חודשים",
  "יום",
  "ימים",
  "אחרון",
  "האחרון",
  "אחרונה",
  "האחרונה",
  "חולף",
  "החולף",
  "חולפת",
  "החולפת",
  "today",
  "yesterday",
  "tomorrow",
  "year",
  "years",
  "month",
  "months",
  "week",
  "weeks",
  "day",
  "days",
  "last",
  "latest",
  "the",
  "in",
  "during",
  "for",
  "over",
  ...Object.keys(HEBREW_NUMBER_WORDS),
  "האחרונים",
  "האחרונות",
  "החולפים",
  "החולפות",
]);

const NON_LOCATION_WORDS = new Set([
  "בקשה",
  "בבקשה",
  "מפה",
  "תמונה",
  "תמונת",
  "תמונות",
  "לוויין",
  "לווין",
  "שריפה",
  "שריפות",
  "הצפה",
  "הצפות",
  "התפרצות",
  "התפרצויות",
  "מבנים",
  "בניינים",
  "כלי שיט",
  "imagery",
  "image",
  "images",
  "satellite",
  "wildfire",
  "wildfires",
  "flood",
  "floods",
  "פאנל",
  "פאנלים",
  "סולרי",
  "סולריים",
  "רכב",
  "רכבים",
  "מכונית",
  "מכוניות",
  "משאית",
  "משאיות",
  "מטוס",
  "מטוסים",
  "vehicle",
  "vehicles",
  "car",
  "cars",
  "truck",
  "trucks",
  "aircraft",
  "airplane",
  "airplanes",
  "solar",
  "panel",
  "panels",
  "גג",
  "גגות",
  "roof",
  "roofs",
  "אדום",
  "אדומה",
  "אדומים",
  "אדומות",
  "כחול",
  "כחולה",
  "כחולים",
  "כחולות",
  "ירוק",
  "ירוקה",
  "ירוקים",
  "ירוקות",
  "לבן",
  "לבנה",
  "לבנים",
  "לבנות",
  "שחור",
  "שחורה",
  "שחורים",
  "שחורות",
  "צהוב",
  "צהובה",
  "צהובים",
  "צהובות",
  "כתום",
  "כתומה",
  "כתומים",
  "כתומות",
  "אפור",
  "אפורה",
  "אפורים",
  "אפורות",
  "חום",
  "חומה",
  "חומים",
  "חומות",
  "סגול",
  "סגולה",
  "סגולים",
  "סגולות",
  "red",
  "blue",
  "green",
  "white",
  "black",
  "yellow",
  "orange",
  "gray",
  "grey",
  "brown",
  "purple",
]);

type OpenVocabularyTerm = {
  label: string;
  pattern: RegExp;
};

const OPEN_VOCABULARY_OBJECT_TERMS: OpenVocabularyTerm[] = [
  {
    label: "solar panel",
    pattern: /(?<![א-ת])(?:ו?ה?)(?:פאנל(?:ים)?\s+סולרי(?:ים)?|לוחות?\s+(?:סולרי(?:ים)?|פוטו-?וולטאיים))(?![א-ת])|\b(?:solar\s+panels?|photovoltaic\s+panels?|pv\s+arrays?)\b/iu,
  },
  { label: "vehicle", pattern: /(?<![א-ת])(?:ו?ה?)(?:כלי\s+רכב|רכב(?:ים)?)(?![א-ת])|\bvehicles?\b/iu },
  { label: "car", pattern: /(?<![א-ת])(?:ו?ה?)(?:מכונית|מכוניות)(?![א-ת])|\bcars?\b/iu },
  { label: "truck", pattern: /(?<![א-ת])(?:ו?ה?)(?:משאית|משאיות)(?![א-ת])|\btrucks?\b/iu },
  { label: "bus", pattern: /(?<![א-ת])(?:ו?ה?)(?:אוטובוס|אוטובוסים)(?![א-ת])|\bbuses?\b/iu },
  { label: "aircraft", pattern: /(?<![א-ת])(?:ו?ה?)(?:מטוס(?:ים)?|כלי\s+טיס)(?![א-ת])|\b(?:aircraft|airplanes?|helicopters?)\b/iu },
  { label: "roof", pattern: /(?<![א-ת])(?:ו?ה?)(?:גג|גגות)(?![א-ת])|\broofs?\b/iu },
  { label: "building", pattern: /(?<![א-ת])(?:ו?ה?)(?:בניין|בניינים|מבנה|מבנים)(?![א-ת])|\b(?:buildings?|structures?)\b/iu },
];

const OPEN_VOCABULARY_COLOR_TERMS: OpenVocabularyTerm[] = [
  { label: "red", pattern: /(?<![א-ת])(?:ו?ה?)(?:אדום|אדומה|אדומים|אדומות)(?![א-ת])|\bred\b/iu },
  { label: "blue", pattern: /(?<![א-ת])(?:ו?ה?)(?:כחול|כחולה|כחולים|כחולות)(?![א-ת])|\bblue\b/iu },
  { label: "green", pattern: /(?<![א-ת])(?:ו?ה?)(?:ירוק|ירוקה|ירוקים|ירוקות)(?![א-ת])|\bgreen\b/iu },
  { label: "white", pattern: /(?<![א-ת])(?:ו?ה?)(?:לבן|לבנה|לבנים|לבנות)(?![א-ת])|\bwhite\b/iu },
  { label: "black", pattern: /(?<![א-ת])(?:ו?ה?)(?:שחור|שחורה|שחורים|שחורות)(?![א-ת])|\bblack\b/iu },
  { label: "yellow", pattern: /(?<![א-ת])(?:ו?ה?)(?:צהוב|צהובה|צהובים|צהובות)(?![א-ת])|\byellow\b/iu },
  { label: "orange", pattern: /(?<![א-ת])(?:ו?ה?)(?:כתום|כתומה|כתומים|כתומות)(?![א-ת])|\borange\b/iu },
  { label: "gray", pattern: /(?<![א-ת])(?:ו?ה?)(?:אפור|אפורה|אפורים|אפורות)(?![א-ת])|\bgr[ae]y\b/iu },
  { label: "brown", pattern: /(?<![א-ת])(?:ו?ה?)(?:חום|חומה|חומים|חומות)(?![א-ת])|\bbrown\b/iu },
  { label: "purple", pattern: /(?<![א-ת])(?:ו?ה?)(?:סגול|סגולה|סגולים|סגולות)(?![א-ת])|\bpurple\b/iu },
];

function matchingTerms(query: string, terms: OpenVocabularyTerm[]) {
  return terms
    .map((term) => ({ ...term, index: query.search(term.pattern) }))
    .filter((term) => term.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((term) => term.label)
    .filter((label, index, labels) => labels.indexOf(label) === index);
}

/**
 * Extracts deterministic, English prompts for the open-vocabulary vision
 * backend. A colour is attached only when its target is unambiguous. When a
 * request names several target types, colours remain explicit attributes
 * rather than being assigned to the wrong object.
 */
export function extractOpenVocabularyObjects(query: string) {
  const normalized = query.toLowerCase();
  const objects = matchingTerms(normalized, OPEN_VOCABULARY_OBJECT_TERMS);
  if (!objects.length) return [];

  const colors = matchingTerms(normalized, OPEN_VOCABULARY_COLOR_TERMS);
  if (!colors.length) return objects;

  if (objects.includes("roof")) {
    return [
      ...colors.map((color) => `${color} roof`),
      ...objects.filter((object) => object !== "roof"),
    ];
  }
  if (objects.length === 1) return colors.map((color) => `${color} ${objects[0]}`);
  return [...objects, ...colors.map((color) => `color: ${color}`)];
}

const LEADING_QUERY_WORDS = new Set([
  ...NON_LOCATION_WORDS,
  "בדוק",
  "בדקי",
  "הצג",
  "הציגי",
  "אתר",
  "תאתר",
  "זהה",
  "נתח",
  "חפש",
  "מצא",
  "של",
  "בבקשה",
  "show",
  "find",
  "detect",
  "analyze",
  "analyse",
  "check",
  "locate",
  "please",
  "איפה",
  "היכן",
  "נמצאת",
  "נמצא",
  "מה",
  "אתה",
  "יודע",
  "על",
  "תראה",
  "תציג",
  "לי",
  "את",
  "העיר",
  "המדינה",
  "ומה",
  "לגבי",
  "where",
  "is",
  "what",
  "about",
  "tell",
  "me",
]);

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  const originalDay = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(originalDay, lastDay));
  return next;
}

function addYears(date: Date, years: number) {
  return addMonths(date, years * 12);
}

function fullMonth(year: number, month: number, label: string) {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return { startDate: toIsoDate(start), endDate: toIsoDate(end), dateLabel: label };
}

function relativeRange(now: Date, amount: number, unit: "day" | "week" | "month" | "year", label: string) {
  const safeAmount = Math.min(Math.max(Math.trunc(amount), 1), unit === "year" ? 10 : unit === "month" ? 120 : 3_660);
  const start = unit === "day"
    ? addDays(now, -safeAmount)
    : unit === "week"
      ? addDays(now, -safeAmount * 7)
      : unit === "month"
        ? addMonths(now, -safeAmount)
        : addYears(now, -safeAmount);
  return { startDate: toIsoDate(start), endDate: toIsoDate(now), dateLabel: label };
}

function hebrewAmount(value: string) {
  const numeric = Number(value.replace(/^ב-?/, ""));
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return HEBREW_NUMBER_WORDS[value.replace(/^ב/, "")] || null;
}

function implicitDualAmount(value: string, fallback: number) {
  return /(?:שבועיים|חודשיים|שנתיים)/.test(value) ? 2 : fallback;
}

export function parseDateRange(query: string, now = new Date()) {
  const normalized = query.toLowerCase().replace(/[–—]/g, "-");

  const iso = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return { startDate: toIsoDate(addDays(date, -5)), endDate: toIsoDate(addDays(date, 5)), dateLabel: toIsoDate(date) };
  }

  const numericDate = normalized.match(/(?:^|\s)(\d{1,2})[./](\d{1,2})[./](20\d{2})(?:\s|$)/);
  if (numericDate) {
    const date = new Date(Date.UTC(Number(numericDate[3]), Number(numericDate[2]) - 1, Number(numericDate[1])));
    if (date.getUTCDate() === Number(numericDate[1]) && date.getUTCMonth() === Number(numericDate[2]) - 1) {
      return { startDate: toIsoDate(addDays(date, -5)), endDate: toIsoDate(addDays(date, 5)), dateLabel: toIsoDate(date) };
    }
  }

  if (/(?:היום|today)(?=\s|[,.?!]|$)/u.test(normalized)) {
    return { startDate: toIsoDate(now), endDate: toIsoDate(now), dateLabel: "היום" };
  }
  if (/(?:אתמול|yesterday)(?=\s|[,.?!]|$)/u.test(normalized)) {
    const date = addDays(now, -1);
    return { startDate: toIsoDate(date), endDate: toIsoDate(date), dateLabel: "אתמול" };
  }

  const relativeRules: Array<{
    pattern: RegExp;
    unit: "day" | "week" | "month" | "year";
    defaultAmount: number;
    label: (amount: number) => string;
  }> = [
    {
      pattern: /(?:ב(?:משך\s+)?|ב-?)?(\d+|אחת|אחד|שני|שתי|שלושה|שלוש|שלושת|ארבעה|ארבע|ארבעת|חמישה|חמש|חמשת|שישה|שש|ששת|שבעה|שבע|שבעת|שמונה|שמונת|תשעה|תשע|תשעת|עשרה|עשר|עשרת)?\s*ה?ימים?\s+(?:האחרונים|האחרונות|האחרון|החולפים|החולפות)|(?:(?:in|over|during|for)\s+)?(?:the\s+)?last\s+(\d+)?\s*days?/,
      unit: "day",
      defaultAmount: 1,
      label: (amount) => amount === 1 ? "היום האחרון" : `${amount} הימים האחרונים`,
    },
    {
      pattern: /(?:ב(?:משך\s+)?|ב-?)?(\d+|אחת|אחד|שני|שתי|שלושה|שלוש|שלושת|ארבעה|ארבע|ארבעת|חמישה|חמש|חמשת|שישה|שש|ששת|שבעה|שבע|שבעת|שמונה|שמונת|תשעה|תשע|תשעת|עשרה|עשר|עשרת)?\s*ה?שבוע(?:ות|יים)?\s+(?:האחרונים|האחרונות|האחרון|החולפים|החולפות)|(?:(?:in|over|during|for)\s+)?(?:the\s+)?last\s+(\d+)?\s*weeks?/,
      unit: "week",
      defaultAmount: 1,
      label: (amount) => amount === 1 ? "השבוע האחרון" : `${amount} השבועות האחרונים`,
    },
    {
      pattern: /(?:ב(?:משך\s+)?|ב-?)?(\d+|אחת|אחד|שני|שתי|שלושה|שלוש|שלושת|ארבעה|ארבע|ארבעת|חמישה|חמש|חמשת|שישה|שש|ששת|שבעה|שבע|שבעת|שמונה|שמונת|תשעה|תשע|תשעת|עשרה|עשר|עשרת)?\s*ה?חודש(?:ים|יים)?\s+(?:האחרונים|האחרונות|האחרון|החולפים|החולפות)|(?:(?:in|over|during|for)\s+)?(?:the\s+)?last\s+(\d+)?\s*months?/,
      unit: "month",
      defaultAmount: 1,
      label: (amount) => amount === 1 ? "החודש האחרון" : `${amount} החודשים האחרונים`,
    },
    {
      pattern: /(?:ב(?:משך\s+)?|ב-?)?(\d+|אחת|אחד|שני|שתי|שנתיים|שלושה|שלוש|שלושת|ארבעה|ארבע|ארבעת|חמישה|חמש|חמשת|שישה|שש|ששת|שבעה|שבע|שבעת|שמונה|שמונת|תשעה|תשע|תשעת|עשרה|עשר|עשרת)?\s*ה?שנ(?:ה|ים|תיים)\s+(?:האחרונה|האחרונות|החולפת|החולפות)|(?:(?:in|over|during|for)\s+)?(?:the\s+)?last\s+(\d+)?\s*years?/,
      unit: "year",
      defaultAmount: 1,
      label: (amount) => amount === 1 ? "השנה האחרונה" : `${amount} השנים האחרונות`,
    },
  ];

  for (const rule of relativeRules) {
    const match = normalized.match(rule.pattern);
    if (!match) continue;
    const rawAmount = match[1] || match[2] || "";
    const amount = rawAmount
      ? hebrewAmount(rawAmount) || Number(rawAmount)
      : implicitDualAmount(match[0], rule.defaultAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    return relativeRange(now, amount, rule.unit, rule.label(amount));
  }

  const monthNames = { ...ENGLISH_MONTHS, ...HEBREW_MONTHS };
  for (const [monthName, month] of Object.entries(monthNames)) {
    const escaped = monthName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dayMonth = normalized.match(new RegExp(`(?:\\b(\\d{1,2})\\s+(?:ב)?${escaped}|(?:ב|מ)?${escaped}\\s+(\\d{1,2}))[,\\s-]*(20\\d{2})`));
    if (dayMonth) {
      const day = Number(dayMonth[1] || dayMonth[2]);
      const date = new Date(Date.UTC(Number(dayMonth[3]), month, day));
      if (date.getUTCDate() === day && date.getUTCMonth() === month) {
        return { startDate: toIsoDate(addDays(date, -5)), endDate: toIsoDate(addDays(date, 5)), dateLabel: toIsoDate(date) };
      }
    }
    const monthYear = normalized.match(new RegExp(`(?:ב|מ)?${escaped}\\s+(20\\d{2})`));
    if (monthYear) return fullMonth(Number(monthYear[1]), month, `${monthName} ${monthYear[1]}`);
  }

  const year = normalized.match(/\b(20\d{2})\b/);
  if (year) {
    return { startDate: `${year[1]}-01-01`, endDate: `${year[1]}-12-31`, dateLabel: year[1] };
  }

  return relativeRange(now, 45, "day", "45 הימים האחרונים");
}

const HEBREW_TEMPORAL_STOP = [
  `ב-?(?:משך\\s+)?(?:${HEBREW_AMOUNT_PATTERN})?\\s*ה?(?:ימים?|שבוע(?:ות|יים)?|חודש(?:ים|יים)?|שנ(?:ה|ים|תיים))`,
  "בתאריך",
  "ביום",
  "לאחר",
  "לפני",
  "בין",
  "בשנה",
  "השנה",
  "בשנים",
  "בשבוע",
  "בחודש",
  "בימים",
  "במהלך",
  "במשך",
  "בשנת",
  "ב-?\\d",
  "20\\d{2}",
  `(?:ב|מ)?(?:${HEBREW_MONTH_PATTERN})`,
].join("|");

const ENGLISH_TEMPORAL_STOP = [
  "(?:in|during|for|over)\\s+(?:the\\s+)?last",
  "on",
  "during",
  "after",
  "before",
  "between",
  "from",
  "over",
  "for",
  "last",
  "today",
  "yesterday",
  `(?:in\\s+)?(?:${ENGLISH_MONTH_PATTERN})`,
  "20\\d{2}",
].join("|");

function normalizedWords(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,?;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimLeadingQueryWords(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  while (words.length) {
    const normalized = normalizedWords(words[0]);
    const withoutHebrewPrefix = /^[ול]/.test(normalized) ? normalized.slice(1) : normalized;
    if (!LEADING_QUERY_WORDS.has(normalized) && !LEADING_QUERY_WORDS.has(withoutHebrewPrefix)) break;
    words.shift();
  }
  return words.join(" ").trim();
}

export function isPlausibleLocationCandidate(value: string) {
  const normalized = normalizedWords(value);
  if (normalized.length < 2 || normalized.length > 100) return false;
  if (/^[-+]?\d+(?:\.\d+)?$/.test(normalized)) return false;
  if (/\b20\d{2}\b/.test(normalized)) return false;
  const words = normalized.split(" ").filter(Boolean);
  if (!words.length || words.length > 10) return false;
  const semanticWord = (word: string) => {
    const withoutHebrewPrefix = /^[במלכה]/.test(word) ? word.slice(1) : word;
    return TEMPORAL_WORDS.has(word)
      || TEMPORAL_WORDS.has(withoutHebrewPrefix)
      || NON_LOCATION_WORDS.has(word)
      || NON_LOCATION_WORDS.has(withoutHebrewPrefix);
  };
  if (words.every(semanticWord)) return false;
  if (words.some((word) => Object.hasOwn(HEBREW_MONTHS, word) || Object.hasOwn(ENGLISH_MONTHS, word))) return false;
  return !NON_LOCATION_WORDS.has(normalized);
}

export function parseCoordinatePair(value: string) {
  const match = value.match(/(?:^|\s|\()(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)(?:\s|\)|$)/);
  if (!match) return null;
  let first = Number(match[1]);
  let second = Number(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  if (Math.abs(first) > 90 && Math.abs(second) <= 90) [first, second] = [second, first];
  if (Math.abs(first) > 90 || Math.abs(second) > 180) return null;
  return { latitude: first, longitude: second };
}

function firstPlausible(matches: Iterable<RegExpMatchArray>) {
  for (const match of matches) {
    const candidate = match[1]?.trim() || "";
    if (isPlausibleLocationCandidate(candidate)) return candidate;
  }
  return "";
}

export function extractLocationCandidate(query: string) {
  const coordinates = parseCoordinatePair(query);
  if (coordinates) return `${coordinates.latitude}, ${coordinates.longitude}`;

  const englishPattern = new RegExp(`\\b(?:in|near|around|at|of|over)\\s+([A-Za-zÀ-ÿ' .-]+?)(?=\\s+(?:${ENGLISH_TEMPORAL_STOP})\\b|[,.?]|$)`, "gi");
  const english = firstPlausible(query.matchAll(englishPattern));
  if (english) return english;

  const bareEnglishPattern = new RegExp(
    `^\\s*([A-Za-zÀ-ÿ' .-]+?)(?=\\s+(?:(?:in|during|for|over)\\s+(?:the\\s+)?last\\b|(?:${ENGLISH_MONTH_PATTERN})\\s+20\\d{2}\\b|20\\d{2}\\b))`,
    "i",
  );
  const bareEnglish = trimLeadingQueryWords(query.match(bareEnglishPattern)?.[1] || "");
  if (isPlausibleLocationCandidate(bareEnglish)) return bareEnglish;

  const explicitPattern = new RegExp(`(?:^|\\s)(?:באזור|ליד|סביב|של|עבור|מעל|בתוך)\\s+([א-ת׳״'" -]{2,}?)(?=\\s+(?:${HEBREW_TEMPORAL_STOP})|[,.?]|$)`, "g");
  const explicit = firstPlausible(query.matchAll(explicitPattern));
  if (explicit) return explicit;

  const attachedPattern = new RegExp(`\\sב([א-ת׳״'" -]{2,}?)(?=\\s+(?:${HEBREW_TEMPORAL_STOP})|[,.?]|$)`, "g");
  const attached = firstPlausible(query.matchAll(attachedPattern));
  if (attached) return attached;

  const bareHebrewPattern = new RegExp(`^\\s*([א-ת׳״'" -]{2,}?)(?=\\s+(?:${HEBREW_TEMPORAL_STOP}))`);
  const bareHebrew = trimLeadingQueryWords(query.match(bareHebrewPattern)?.[1] || "");
  if (isPlausibleLocationCandidate(bareHebrew)) return bareHebrew;

  const conversationalHebrew = trimLeadingQueryWords(
    query
      .replace(/[?!.،,]+$/u, "")
      .replace(/^(?:ו?מה\s+לגבי|איפה(?:\s+(?:נמצאים|נמצאות|נמצאת|נמצא))?|היכן(?:\s+(?:נמצאת|נמצא))?|מה\s+(?:אתה|את)\s+יודע(?:ת)?\s+על|ת(?:ראה|ציג)\s+לי(?:\s+את)?(?:\s+העיר|\s+המדינה)?|ספר\s+לי\s+על)\s*/u, ""),
  );
  if (isPlausibleLocationCandidate(conversationalHebrew)) return conversationalHebrew;

  const conversationalEnglish = trimLeadingQueryWords(
    query
      .replace(/[?!.]+$/u, "")
      .replace(/^(?:and\s+)?(?:what\s+about|where\s+is|tell\s+me\s+about|show\s+me(?:\s+the\s+(?:city|country)\s+of)?)\s+/iu, ""),
  );
  return isPlausibleLocationCandidate(conversationalEnglish) ? conversationalEnglish : "";
}

function includesAny(query: string, terms: string[]) {
  return terms.some((term) => query.includes(term));
}

function includesOpenVocabularyObject(query: string) {
  return extractOpenVocabularyObjects(query).length > 0;
}

export function inferIntentFromQuery(query: string) {
  const normalized = query.toLowerCase();
  if (includesAny(normalized, ["הר געש", "הרי געש", "געשי", "געשית", "וולקני", "התפרצות", "התפרצויות", "לבה", "אפר געשי", "volcano", "volcanic", "eruption", "lava", "ash plume"])) return "volcano";
  if (includesAny(normalized, ["הצפה", "הצפות", "שיטפון", "שטפונות", "flood", "inundation", "standing water"])) return "flood";
  if (includesAny(normalized, ["שריפה", "שריפות", "צלקת שריפה", "שטח שרוף", "wildfire", "burn scar", "active fire", "smoke plume"])) return "wildfire";
  if (includesAny(normalized, ["ספינה", "ספינות", "כלי שיט", "אונייה", "ship", "vessel", "boat"])) return "vessel";
  if (includesAny(normalized, ["בניין", "בניינים", "מבנים", "בית", "building", "rooftop", "structure"]) || includesOpenVocabularyObject(normalized)) return "building";
  if (includesAny(normalized, ["גידול", "גידולים", "חקלא", "יבול", "crop", "agriculture", "vegetation health"])) return "crop";
  if (includesAny(normalized, ["שינוי", "לפני ואחרי", "השתנה", "change", "before and after", "difference"])) return "change";
  return "imagery";
}
