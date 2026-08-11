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
- Microsoft Planetary Computer: NAIP ברזולוציה של 0.3 עד 1 מטר בארצות הברית, עם חתימת SAS אנונימית וזמנית שנוצרת רק בתוך שירות הפענוח.
- NASA CMR STAC: גילוי HLS S30/L30.
- NASA EONET: ראיית הקשר לאירועים, לא מסכת זיהוי.

גישה ציבורית לקטלוג אינה בהכרח גישה חינמית לפיקסלים. Sentinel-2 יכול להגיע כ-COG ציבורי. נכסי Earth Search מסוימים של Landsat, NAIP ו-Sentinel-1 מסומנים `requester-pays`. ערוצי HLS מסומנים `authentication-required` עד שיוגדר Earthdata Login. GeoLens שומר את המצב הזה ולא שולח קישור חסום למודל.

## איך הפענוח עובד

1. הסוכן מחלץ יעד, מקום, זמן ואובייקט מהבקשה.
2. מיקום מאומת הופך ל-AOI קנוני. מודל השפה אינו רשאי להמציא קואורדינטות.
3. נוצר `MissionSpec` עם מזהה hash יציב, חיישנים, ערוצים, רזולוציה ותוצרים.
4. ה-Data Broker מחפש במקביל ב-CDSE, Earth Search, Planetary Computer ו-NASA CMR ומסיר כפילויות.
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
GEO_MODEL_ALLOWED_ORIGINS=https://inference.example.com
```

`GEO_MODEL_ALLOWED_ORIGINS` הוא חסם חובה. יש לרשום בו origins מדויקים, מופרדים בפסיקים. כתובת שלא ברשימה, כתובת עם credentials, כתובת רשת פרטית או HTTP מחוץ ל-`localhost` תיחסם. לפרסום, מגדירים את אותם משתנים בסביבת הייצור של האתר. אין לשמור מפתחות בקוד, ב-Git או בדפדפן.

השירות הנייד נמצא בתיקייה `services/inference`. ברירת המחדל שלו היא backend מסוג `mock` שמאמת את החוזה בלבד ומחזיר תמיד `inconclusive`. הוא אינו מוצג כשירות פענוח פעיל. חיבור אמיתי דורש backend שטוען משקלים, מחזיר `/ready` עם `inferenceEnabled: true`, וחשוף ב-HTTPS מאובטח.

### שימוש ב-GPU של VEDA

פרופיל NVIDIA T4 ב-VEDA מתאים להרצת service container או סביבת Python של המודל. עם זאת, Jupyter Server Proxy מוגן בהתחברות ל-JupyterHub, ולכן Cloudflare Worker ציבורי אינו יכול לקרוא אותו ישירות. החיבור המקצועי הוא שירות HTTPS בעל כתובת יציבה, Bearer token ו-allowlist, שמפנה ל-container על ה-GPU. קישור זמני של Gradio או tunnel ללא ניהול זהויות אינו חיבור ייצור.

כאשר קיים ingress מאושר, מריצים את השירות על ה-T4, מגדירים `GEOLENS_INFERENCE_TOKEN`, מוודאים ש-`/ready` מחזיר `inferenceEnabled: true`, ורק אז מוסיפים את ה-origin ל-`GEO_MODEL_ALLOWED_ORIGINS` ואת `/v1/infer` למשתנה המסלול המתאים.

## חוזה GeoLens Inference v1

כל כתובת מודל מקבלת בקשת `POST` עם כותרות `Content-Type: application/json`, `X-GeoLens-Contract: geolens-inference/v1`, `X-GeoLens-Model` ו-`Idempotency-Key` הזהה ל-`requestId`. לפני הפענוח הנתב קורא ל-`/ready` ודורש גם `ready: true` וגם `inferenceEnabled: true`.

דוגמת קלט מינימלית תקפה:

```json
{
  "requestId": "c126c033-9f39-42d0-9bc4-53bd410ca236",
  "model": {
    "id": "prithvi-eo-2.0-sen1floods11",
    "version": "300m-sen1floods11-v1",
    "task": "סגמנטציית הצפות",
    "modelCardUrl": "https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11"
  },
  "query": "מפה הצפה בניו אורלינס ב-15 באוגוסט 2023",
  "intent": "flood",
  "dateRange": {
    "startDate": "2023-08-10",
    "endDate": "2023-08-20"
  },
  "requestedObjects": ["מים חדשים", "גבול הצפה"],
  "location": {
    "name": "New Orleans, Louisiana, USA",
    "latitude": 29.9511,
    "longitude": -90.0715,
    "bbox": [-90.35, 29.75, -89.75, 30.18]
  },
  "scenes": [
    {
      "id": "scene-1",
      "collection": "sentinel-2-l2a",
      "datetime": "2023-08-15T16:45:20Z",
      "resolution": "10 meters",
      "bbox": [-90.35, 29.75, -89.75, 30.18],
      "geometry": null,
      "stacUrl": "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/scene-1",
      "catalog": "Element 84 Earth Search",
      "assetAccess": "public-http",
      "license": {
        "licenseId": "proprietary",
        "commercialUse": null,
        "redistribution": null,
        "attributionRequired": null,
        "sourceProvider": "Element 84",
        "sourceItemId": "scene-1",
        "termsUrl": "https://registry.opendata.aws/sentinel-2-l2a-cogs/",
        "note": "Verify source terms before redistribution."
      },
      "assets": [
        {
          "label": "B04 Red",
          "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/example/B04.tif"
        }
      ]
    }
  ]
}
```

תשובה חיובית חייבת לכלול GeoJSON וסימון `detected: true`. ציון בין `0` ל-`1` יוצג כביטחון רק כאשר השירות מצהיר במפורש `confidenceCalibrated: true`:

```json
{
  "contract": "geolens-inference/v1",
  "requestId": "c126c033-9f39-42d0-9bc4-53bd410ca236",
  "runId": "365ad3fe-fc37-40df-b9a7-7178963585f4",
  "model": {
    "id": "prithvi-eo-2.0-sen1floods11",
    "version": "300m-sen1floods11-v1",
    "backend": "prithvi"
  },
  "detected": true,
  "outcome": "positive",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[-90.1, 29.9], [-90.0, 29.9], [-90.0, 30.0], [-90.1, 29.9]]]
  },
  "confidence": 0.84,
  "confidenceCalibrated": true,
  "summary": "שטח מוצף שזוהה לאחר סינון מים קבועים.",
  "warnings": [],
  "provenance": {
    "backend": "prithvi",
    "backendVersion": "1.0.0",
    "modelId": "prithvi-eo-2.0-sen1floods11",
    "sceneIds": ["scene-1"],
    "startedAt": "2026-08-11T14:00:00Z",
    "completedAt": "2026-08-11T14:00:12Z"
  }
}
```

התגובה יכולה להכיל גם `FeatureCollection` עבור זיהויי אובייקטים מרובים. תשובה שלילית חייבת לכלול את כל שדות החוזה, להשתמש ב-`detected: false`, ב-`outcome: "negative"` וב-`geometry: null`. הממשק יציג "לא זוהה" רק אם כל תנאי ההיתכנות עברו ורשומת הריצה מלאה. בכל מצב אחר התוצאה היא "לא ניתן לקבוע".

משקלים פתוחים אינם שירות הסקה חינמי. האפליקציה מכינה חוזה חיבור ל-Prithvi, Grounding DINO + SAM 2.1 ו-xView3, אך אינה מציגה אותם כפעילים עד שהוגדרה כתובת שירות אמיתית.

## פיתוח ובדיקות

```bash
npm install
npm run dev
npm run lint
npx tsc --noEmit
npm test
```
