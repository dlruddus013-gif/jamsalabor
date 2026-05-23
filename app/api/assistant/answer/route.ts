import { NextResponse } from "next/server";
import { generateCustomerAnswer, type PurchaseItem } from "@/lib/integrations/ai-answer";
import { searchNaver, type NaverSearchItem } from "@/lib/integrations/naver";
import { searchGoogle, type GoogleSearchItem } from "@/lib/integrations/google";
import { fetchOkposPurchasesByPhone } from "@/lib/integrations/okpos";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      question?: string;
      transcript?: string;
      searchQuery?: string;
      customerName?: string;
      customerPhone?: string;
    };
    const question = body.question?.trim();
    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    let searchResults: NaverSearchItem[] = [];
    let googleResults: GoogleSearchItem[] = [];
    try {
      searchResults = await searchNaver(body.searchQuery?.trim() || question, {
        types: ["webkr", "news", "blog", "kin", "local"],
        display: 4,
        sort: "sim",
      });
    } catch (error) {
      console.error("[assistant] naver search skipped:", error);
    }
    try {
      googleResults = await searchGoogle(body.searchQuery?.trim() || question, { num: 6 });
    } catch (error) {
      console.error("[assistant] google search skipped:", error);
    }

    let purchases: PurchaseItem[] = [];
    if (body.customerPhone?.trim()) {
      try {
        purchases = await fetchOkposPurchasesByPhone(body.customerPhone);
      } catch (error) {
        console.error("[assistant] okpos purchase lookup skipped:", error);
      }
    }

    const answer = await generateCustomerAnswer({
      question,
      transcript: body.transcript,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      searchResults: [...searchResults, ...googleResults],
      purchases,
    });

    return NextResponse.json({
      ...answer,
      searchResults: [...searchResults, ...googleResults],
      purchases,
      searchProviders: {
        naver: searchResults.length,
        google: googleResults.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
