# GeoLens

GeoLens הוא סוכן עצמאי לפענוח הדמאות לוויין. הוא מתרגם בקשה בשפה טבעית ל-`MissionSpec` מאומת, מחפש בכמה קטלוגי STAC, בודק היתכנות פיזית וטכנית, ומפעיל מודל פענוח ייעודי רק כאשר הקלט מתאים.

האפליקציה אינה מייצרת פוליגונים לצורכי הדגמה. פוליגון יוצג רק לאחר ששירות מודל מחזיר GeoJSON תקף. כל תשובה כוללת Evidence Ledger עם סצנות, רישוי, גרסאות מודל, מגבלות ומדידות GIS דטרמיניסטיות.

## מוח הסוכן: OpenRouter חינמי בלבד

GeoLens משתמש ב-`openrouter/free` כדי לפרש בקשות מורכבות, לחלץ יעד גאוגרפי ולבחור מסלול עבודה. המפתח נשאר בצד השרת. הקוד אינו מאפשר `openrouter/auto` או מזהה מודל בתשלום.

```bash
OPENROUTER_API_KEY=replace-with-your-secret
```

גם משתנה הייצור הקיים בשם `openrouter` נתמך. כאשר מודל חינמי אינו זמין, המכסה מוגבלת או התגובה אינה עומדת בסכמת JSON, GeoLens חוזר למפענח המקומי ואינו מבצע בקשה בתשלום.

OpenRouter משמש לתכנון שפה בלבד. הוא אינו מחליף את Prithvi או את שירותי הסגמנטציה שמנתחים פיקסלים ומחזירים GeoJSON.

## מסלולי הפענוח

| משימה | מודל שנבחר | קלט נדרש | תוצר |
| --- | --- | --- | --- |
| הצפות | [Prithvi-EO-2.0 300M TL Sen1Floods11](https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11) | Sentinel-2 או HLS, שישה ערוצים ספקטרליים | מסכת הצפה ו-GeoJSON |
| שריפות וצלקות שריפה | [Prithvi-EO-2.0 300M BurnScars](https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-BurnScars) | HLS L30/S30, או Sentinel-2 שעבר עיבוד תואם HLS | חומרת שריפה ו-GeoJSON |
| התפרצות געשית | [Volcanic Hotspot RF-S2](https://www.mdpi.com/2072-4292/14/17/4370) | Sentinel-2 עם SWIR ו-NIR | מוקד חם, לבה או פלומה ב-GeoJSON |
| מבנים ואובייקטים פתוחים | [Grounding DINO + SAM 2.1](https://github.com/IDEA-Research/Grounded-SAM-2) | RGB COG ברזולוציה של עד 3 מטר, tiling ואימות אנליסט | הצעות מועמד ופוליגוני מופעים |
| כלי שיט | [xView3 Sentinel-1 pipeline](https://github.com/DIUx-xView/xView3_second_place) | Sentinel-1 מכויל עם VV/VH | נקודות או תיבות ואומדן אורך, לא קונטור מומצא |

## מקורות הנתונים

ה-Data Broker מחפש במקביל ומדרג תוצאות לפי זמן, עננות, GSD, שלמות ערוצים וגישה לפיקסלים:

- Copernicus Data Space: Sentinel-1 ו-Sentinel-2.
- Element 84 Earth Search: Sentinel-1, Sentinel-2 Collection 1, Landsat Collection 2 ו-NAIP בארצות הברית.
- NASA CMR STAC: גילוי HLS S30/L30.
- NASA EONET: ראיית הקשר לאירועים, לא מסכת זיהוי.

גישה ציבורית לקטלוג אינה בהכרח גישה חינמית לפיקסלים. Sentinel-2 יכול להגיע כ-COG ציבורי. נכסי Earth Search מסוימים של Landsat, NAIP ו-Sentinel-1 מסומנים `requester-pays`. ערוצי HLS מסומנים `authentication-required` עד שיוגדר Earthdata Login. GeoLens שומר את המצב הזה ולא שולח קישור חסום למודל.

## איך הפענוח עובד

1. הסוכן מחלץ יעד, מקום, זמן ואובייקט מהבקשה.
2. מיקום מאומת הופך ל-AOI קנוני. מודל השפה אינו רשאי להמציא קואורדינטות.
3. נוצר `MissionSpec` עם מזהה hash יציב, חיישנים, ערוצים, רזולוציה ותוצרים.
4. ה-Data Broker מחפש במקביל ב-CDSE, Earth Search ו-NASA CMR ומסיר כפילויות.
5. שער ההיתכנות בודק חיישן, ערוצים, גישת פיקסלים, מספר סצנות, עננות, זמן ורזולוציה.
6. מנגנון הניתוב בוחר שירות מודל ייעודי.
7. GeoLens מאמת את ה-GeoJSON ומחשב שטח, היקף, מרכז ו-bbox ללא LLM.
8. התשובה מופרדת ל-`זוהה`, `לא זוהה` או `לא ניתן לקבוע`, וניתנת לייצוא כ-JSON, GeoJSON ו-CSV.

מודל זיהוי אובייקטים לא יורץ על Sentinel-2 ברזולוציה של 10 מטר, משום שהדבר היה מטעה. עבורו נדרש מקור RGB ברזולוציה גבוהה יותר.

במסלולי שריפות והתפרצויות געשיות נדרש תאריך מדויק או אירוע קטלוגי מאומת. ללא אחד מהם, GeoLens לא ישלח למודל זוג תמונות "לפני ואחרי" שרירותי.

## חיבור שירותי מודל

האתר עצמו רץ כ-Cloudflare Worker ואינו צריך, ואינו יכול, להחזיק GPU. לכן כל מודל מחובר לשירות פענוח HTTPS נפרד שמריץ את המשקלים על GPU או על תשתית ייעודית.

העתק את `.env.example` אל קובץ סביבה מקומי והגדר רק את השירותים הזמינים:

```bash
GEO_MODEL_FLOOD_URL=https://inference.example.com/v1/infer
GEO_MODEL_BURNSCAR_URL=https://inference.example.com/v1/infer
GEO_MODEL_VOLCANO_URL=https://inference.example.com/v1/infer
GEO_MODEL_OPEN_VOCAB_URL=https://inference.example.com/v1/infer
GEO_MODEL_VESSEL_URL=https://inference.example.com/v1/infer
GEO_MODEL_TOKEN=replace-with-a-secret
```

לפרסום, מגדירים את אותם משתנים בסביבת הייצור של האתר. אין לשמור מפתחות בקוד, ב-Git או בדפדפן.

## חוזה GeoLens Inference v1

כל כתובת מודל מקבלת בקשת `POST` עם כותרות `Content-Type: application/json`, `X-GeoLens-Contract: geolens-inference/v1` ו-`X-GeoLens-Model`.

דוגמת קלט מקוצרת:

```json
{
  "requestId": "uuid",
  "model": {
    "id": "prithvi-eo-2.0-sen1floods11",
    "task": "סגמנטציית הצפות"
  },
  "intent": "flood",
  "dateRange": {
    "startDate": "2023-08-10",
    "endDate": "2023-08-20"
  },
  "location": {
    "name": "New Orleans, Louisiana, USA",
    "bbox": [-90.35, 29.75, -89.75, 30.18]
  },
  "scenes": [
    {
      "stacUrl": "https://...",
      "assets": [{ "label": "B04 Red", "href": "https://..." }]
    }
  ]
}
```

תשובה חיובית חייבת לכלול GeoJSON וסימון `detected: true`. ציון בין `0` ל-`1` יוצג כביטחון רק כאשר השירות מצהיר במפורש `confidenceCalibrated: true`:

```json
{
  "detected": true,
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[-90.1, 29.9], [-90.0, 29.9], [-90.0, 30.0], [-90.1, 29.9]]]
  },
  "confidence": 0.84,
  "confidenceCalibrated": true,
  "summary": "שטח מוצף שזוהה לאחר סינון מים קבועים."
}
```

התגובה יכולה להכיל גם `FeatureCollection` עבור זיהויי אובייקטים מרובים. תשובה שלילית מותרת כ-`{"detected": false}` ללא גאומטריה, אבל הממשק יציג "לא זוהה" רק אם כל תנאי ההיתכנות עברו ורשומת הריצה מלאה. בכל מצב אחר התוצאה היא "לא ניתן לקבוע".

משקלים פתוחים אינם שירות הסקה חינמי. האפליקציה מכינה חוזה חיבור ל-Prithvi, Grounding DINO + SAM 2.1 ו-xView3, אך אינה מציגה אותם כפעילים עד שהוגדרה כתובת שירות אמיתית.

## פיתוח ובדיקות

```bash
npm install
npm run dev
npm run lint
npx tsc --noEmit
npm test
```
