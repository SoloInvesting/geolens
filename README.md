# GeoLens

GeoLens הוא סוכן עצמאי לפענוח הדמאות לוויין. הוא מפרש בקשה בשפה טבעית, מאתר סצנות מקור, בוחר חיישן לפי המשימה, ומפעיל מודל פענוח ייעודי רק כאשר הקלט מתאים.

האפליקציה אינה מייצרת פוליגונים לצורכי הדגמה. פוליגון יוצג רק לאחר ששירות מודל מחזיר GeoJSON תקף.

## מסלולי הפענוח

| משימה | מודל שנבחר | קלט נדרש | תוצר |
| --- | --- | --- | --- |
| הצפות | [Prithvi-EO-2.0 300M TL Sen1Floods11](https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11) | Sentinel-2 או HLS, שישה ערוצים ספקטרליים | מסכת הצפה ו-GeoJSON |
| שריפות וצלקות שריפה | [Prithvi-EO-2.0 300M BurnScars](https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-BurnScars) | HLS L30/S30, או Sentinel-2 שעבר עיבוד תואם HLS | חומרת שריפה ו-GeoJSON |
| התפרצות געשית | [Volcanic Hotspot RF-S2](https://www.mdpi.com/2072-4292/14/17/4370) | Sentinel-2 עם SWIR ו-NIR | מוקד חם, לבה או פלומה ב-GeoJSON |
| אובייקטים, מבנים וכלי שיט | YOLO OBB Geospatial | דימות RGB ברזולוציה של עד 3 מטר לפיקסל | תיבות מסובבות או פוליגוני אובייקטים |

מקורות הנתונים הפעילים באפליקציה הם Copernicus Data Space, Sentinel-1, Sentinel-2, NASA EONET, OpenStreetMap ותצלומי Esri. מקורות נתונים אינם מודלי AI.

## איך הפענוח עובד

1. הסוכן מחלץ יעד, מקום, זמן ואובייקט מהבקשה.
2. הוא מאתר סצנות Sentinel ואירועי קטלוג רלוונטיים.
3. מנגנון הניתוב בוחר את המודל הייעודי המתאים.
4. לפני קריאה למודל הוא בודק חיישן, ערוצים, מספר סצנות ורזולוציה.
5. שירות המודל מחזיר גאומטריה, רמת ביטחון וסיכום.
6. GeoLens מאמת את ה-GeoJSON לפני הצגה על המפה.

מודל זיהוי אובייקטים לא יורץ על Sentinel-2 ברזולוציה של 10 מטר, משום שהדבר היה מטעה. עבורו נדרש מקור RGB ברזולוציה גבוהה יותר.

במסלולי שריפות והתפרצויות געשיות נדרש תאריך מדויק או אירוע קטלוגי מאומת. ללא אחד מהם, GeoLens לא ישלח למודל זוג תמונות "לפני ואחרי" שרירותי.

## חיבור שירותי מודל

האתר עצמו רץ כ-Cloudflare Worker ואינו צריך, ואינו יכול, להחזיק GPU. לכן כל מודל מחובר לשירות פענוח HTTPS נפרד שמריץ את המשקלים על GPU או על תשתית ייעודית.

העתק את `.env.example` אל קובץ סביבה מקומי והגדר רק את השירותים הזמינים:

```bash
GEO_MODEL_FLOOD_URL=https://inference.example.com/v1/infer
GEO_MODEL_BURNSCAR_URL=https://inference.example.com/v1/infer
GEO_MODEL_VOLCANO_URL=https://inference.example.com/v1/infer
GEO_MODEL_OBJECT_URL=https://inference.example.com/v1/infer
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

התגובה חייבת לכלול GeoJSON. ציון הביטחון חייב להיות בין `0` ל-`1` כאשר הוא זמין:

```json
{
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[-90.1, 29.9], [-90.0, 29.9], [-90.0, 30.0], [-90.1, 29.9]]]
  },
  "confidence": 0.84,
  "summary": "שטח מוצף שזוהה לאחר סינון מים קבועים."
}
```

התגובה יכולה להכיל גם `FeatureCollection` עבור זיהויי אובייקטים מרובים. אם השירות אינו מחזיר גאומטריה תקפה, GeoLens מדווח על כישלון ולא מציג זיהוי.

## פיתוח ובדיקות

```bash
npm install
npm run dev
npm run lint
npx tsc --noEmit
npm test
```
