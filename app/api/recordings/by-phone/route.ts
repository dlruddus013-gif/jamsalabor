import { NextResponse } from "next/server";
import { createSupabaseAdminClient, isUsingSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface RecordingByPhoneRow {
  id: string;
  recorded_at: string;
  title: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: string | null;
  category: string | null;
  duration_sec: number | null;
  excerpt: string | null;
  tags: string[] | null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const normalized = normalizePhone(searchParams.get("phone") ?? "");

  if (!normalized) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  if (!isUsingSupabaseServer()) {
    return NextResponse.json({ items: [], mock: true });
  }

  const admin = createSupabaseAdminClient();
  const digits = normalized.replace(/\D/g, "");
  const { data, error } = await admin
    .from("recordings")
    .select("id, recorded_at, title, customer_name, customer_phone, status, category, duration_sec, excerpt, tags")
    .or(`customer_phone.ilike.%${normalized}%,customer_phone.ilike.%${digits}%,title.ilike.%${digits}%`)
    .order("recorded_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    phone: normalized,
    items: ((data ?? []) as RecordingByPhoneRow[]).map((row) => ({
      id: row.id,
      recorded_at: row.recorded_at,
      title: row.title,
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      status: row.status,
      category: row.category,
      duration_sec: row.duration_sec,
      excerpt: row.excerpt,
      tags: row.tags ?? [],
    })),
  });
}

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("82")) digits = `0${digits.slice(2)}`;
  if (digits.length < 9 || digits.length > 11) return null;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith("02")) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}
