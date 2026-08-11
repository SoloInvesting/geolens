import { analyzeRequest } from "@/lib/agent";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown; clientDate?: unknown };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return Response.json(
        { error: "יש לכתוב בקשת ניתוח." },
        { status: 400 },
      );
    }
    const clientDate = typeof body.clientDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.clientDate)
      ? body.clientDate
      : undefined;
    const result = await analyzeRequest(query, { referenceDate: clientDate });
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        error: "הסוכן לא הצליח להשלים את הניתוח. אפשר לנסות שוב עם מקום ותאריך מדויקים יותר.",
      },
      { status: 500 },
    );
  }
}
