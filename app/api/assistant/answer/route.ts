import { NextResponse } from "next/server";
import { generateCustomerAnswer } from "@/lib/integrations/ai-answer";
import { searchNaver, type NaverSearchItem } from "@/lib/integrations/naver";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      question?: string;
      transcript?: string;
      searchQuery?: string;
    };
    const question = body.question?.trim();
    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    let searchResults: NaverSearchItem[] = [];
    try {
      searchResults = await searchNaver(body.searchQuery?.trim() || question, {
        types: ["webkr", "news", "blog", "kin"],
        display: 4,
        sort: "sim",
      });
    } catch (error) {
      console.error("[assistant] naver search skipped:", error);
    }
    const answer = await generateCustomerAnswer({
      question,
      transcript: body.transcript,
      searchResults,
    });

    return NextResponse.json({ ...answer, searchResults });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
