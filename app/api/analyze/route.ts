import { analyzeRequest } from "@/lib/agent";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return Response.json(
        { error: "יש לכתוב בקשת ניתוח." },
        { status: 400 },
      );
    }
    const result = await analyzeRequest(query);
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

