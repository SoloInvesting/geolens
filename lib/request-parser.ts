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
]);

const NON_LOCATION_WORDS = new Set([
  "בקשה",
  "בבקשה",
  "מפה",
  "תמונה",
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
      pattern: /(?:ב(?:משך\s+)?|ב-?)?(\d+|אחת|אחד|שני|שתי|שלושה|שלוש|שלושת|ארבעה|ארבע|ארבעת|חמישה|חמש|חמשת|שישה|שש|ששת|שבעה|שבע|שבעת|שמונה|שמונת|תשעה|תשע|תשעת|עשרה|עשר|עשרת)?\s*ה?ימים?\s+(?:האחרונים|האחרונות|האחרון|החולפים|החולפות)|(?:in|over)\s+(?:the\s+)?last\s+(\d+)\s+days?/,
      unit: "day",
      defaultAmount: 1,
      label: (amount) => amount === 1 ? "היום האחרון" : `${amount} הימים האחרונים`,
    },
    {
      pattern: /(?:ב(?:משך\s+)?|ב-?)?(\d+|אחת|אחד|שני|שתי|שלושה|שלוש|שלושת|ארבעה|ארבע|ארבעת|חמישה|חמש|חמשת|שישה|שש|ששת|שבעה|שבע|שבעת|שמונה|שמונת|תשעה|תשע|תשעת|עשרה|עשר|עשרת)?\s*ה?שבוע(?:ות|יים)?\s+(?:האחרונים|האחרונות|האחרון|החולפים|החולפות)|(?:in|over)\s+(?:the\s+)?last\s+(\d+)?\s*weeks?/,
      unit: "week",
      defaultAmount: 1,
      label: (amount) => amount === 1 ? "השבוע האחרון" : `${amount} השבועות האחרונים`,
    },
    {
      pattern: /(?:ב(?:משך\s+)?|ב-?)?(\d+|אחת|אחד|שני|שתי|שלושה|שלוש|שלושת|ארבעה|ארבע|ארבעת|חמישה|חמש|חמשת|שישה|שש|ששת|שבעה|שבע|שבעת|שמונה|שמונת|תשעה|תשע|תשעת|עשרה|עשר|עשרת)?\s*ה?חודש(?:ים|יים)?\s+(?:האחרונים|האחרונות|האחרון|החולפים|החולפות)|(?:in|over)\s+(?:the\s+)?last\s+(\d+)?\s*months?/,
      unit: "month",
      defaultAmount: 1,
      label: (amount) => amount === 1 ? "החודש האחרון" : `${amount} החודשים האחרונים`,
    },
    {
      pattern: /(?:ב(?:משך\s+)?|ב-?)?(\d+|אחת|אחד|שני|שתי|שנתיים|שלושה|שלוש|שלושת|ארבעה|ארבע|ארבעת|חמישה|חמש|חמשת|שישה|שש|ששת|שבעה|שבע|שבעת|שמונה|שמונת|תשעה|תשע|תשעת|עשרה|עשר|עשרת)?\s*ה?שנ(?:ה|ים|תיים)\s+(?:האחרונה|האחרונות|החולפת|החולפות)|(?:during\s+the\s+|in\s+the\s+|over\s+the\s+)?last\s+(\d+)?\s*years?/,
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

  const explicitPattern = new RegExp(`(?:^|\\s)(?:באזור|ליד|סביב|של|עבור|מעל|בתוך)\\s+([א-ת׳״'" -]{2,}?)(?=\\s+(?:${HEBREW_TEMPORAL_STOP})|[,.?]|$)`, "g");
  const explicit = firstPlausible(query.matchAll(explicitPattern));
  if (explicit) return explicit;

  const attachedPattern = new RegExp(`\\sב([א-ת׳״'" -]{2,}?)(?=\\s+(?:${HEBREW_TEMPORAL_STOP})|[,.?]|$)`, "g");
  return firstPlausible(query.matchAll(attachedPattern));
}
