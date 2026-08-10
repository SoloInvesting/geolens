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

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function parseDateRange(query: string, now = new Date()) {
  const normalized = query.toLowerCase();

  const iso = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return { startDate: toIsoDate(addDays(date, -5)), endDate: toIsoDate(addDays(date, 5)), dateLabel: toIsoDate(date) };
  }

  const singularYear = /(?:בשנה|השנה)(?:\s+(?:האחרונה|החולפת))|(?:during\s+the\s+|over\s+the\s+)?last\s+year\b/.test(normalized);
  if (singularYear) {
    const start = new Date(now);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return { startDate: toIsoDate(start), endDate: toIsoDate(now), dateLabel: "השנה האחרונה" };
  }

  const lastYears = normalized.match(/(?:last|over the last)\s+(\d+)\s+years?/);
  const hebrewYears = normalized.match(/ב(?:חמש|ארבע|שלוש|שתי|שנתיים|\d+)\s+השנים האחרונות/);
  if (lastYears || hebrewYears) {
    const hebrewNumber = hebrewYears?.[0].includes("חמש") ? 5 : hebrewYears?.[0].includes("ארבע") ? 4 : hebrewYears?.[0].includes("שלוש") ? 3 : 2;
    const years = lastYears ? Number(lastYears[1]) : hebrewNumber;
    const start = new Date(now);
    start.setUTCFullYear(start.getUTCFullYear() - Math.min(Math.max(years, 1), 10));
    return { startDate: toIsoDate(start), endDate: toIsoDate(now), dateLabel: `${years} השנים האחרונות` };
  }

  const monthNames = { ...ENGLISH_MONTHS, ...HEBREW_MONTHS };
  for (const [monthName, month] of Object.entries(monthNames)) {
    const escaped = monthName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dayMonth = normalized.match(new RegExp(`(?:\\b(\\d{1,2})\\s+(?:ב)?${escaped}|${escaped}\\s+(\\d{1,2}))[,\\s-]*(20\\d{2})`));
    if (dayMonth) {
      const day = Number(dayMonth[1] || dayMonth[2]);
      const date = new Date(Date.UTC(Number(dayMonth[3]), month, day));
      return { startDate: toIsoDate(addDays(date, -5)), endDate: toIsoDate(addDays(date, 5)), dateLabel: toIsoDate(date) };
    }
    const monthYear = normalized.match(new RegExp(`${escaped}\\s+(20\\d{2})`));
    if (monthYear) {
      const date = new Date(Date.UTC(Number(monthYear[1]), month, 15));
      return { startDate: toIsoDate(addDays(date, -20)), endDate: toIsoDate(addDays(date, 20)), dateLabel: `${monthName} ${monthYear[1]}` };
    }
  }

  const year = normalized.match(/\b(20\d{2})\b/);
  if (year) {
    return { startDate: `${year[1]}-01-01`, endDate: `${year[1]}-12-31`, dateLabel: year[1] };
  }

  return { startDate: toIsoDate(addDays(now, -45)), endDate: toIsoDate(now), dateLabel: "45 הימים האחרונים" };
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
  "בחמש",
  "בארבע",
  "בשלוש",
  "בשנת",
  "ב-?\\d",
  "20\\d{2}",
].join("|");

export function extractLocationCandidate(query: string) {
  const english = query.match(/\b(?:in|near|around|at)\s+([A-Za-zÀ-ÿ' .-]+?)(?=\s+(?:on|during|after|before|between|from|over|for|last)\b|[,.?]|$)/i);
  if (english?.[1]) return english[1].trim();

  const explicit = query.match(new RegExp(`(?:^|\\s)(?:באזור|ליד|סביב)\\s+([א-ת׳״'" -]{2,}?)(?=\\s+(?:${HEBREW_TEMPORAL_STOP})|[,.?]|$)`));
  if (explicit?.[1]) return explicit[1].trim();

  const attached = query.match(new RegExp(`\\sב([א-ת׳״'" -]{2,}?)(?=\\s+(?:${HEBREW_TEMPORAL_STOP})|[,.?]|$)`));
  if (attached?.[1]) return attached[1].trim();
  return "";
}
