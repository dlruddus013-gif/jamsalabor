import { NextResponse } from "next/server";
import { sendSms } from "@/lib/integrations/sms";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      to?: string;
      message?: string;
    };
    const result = await sendSms({
      to: body.to ?? "",
      message: body.message ?? "",
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
