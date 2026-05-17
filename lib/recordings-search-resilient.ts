import "server-only";

import {
  fetchFilterOptions,
  searchRecordings as searchRecordingsPrimary,
  type SearchHit,
  type SearchParams,
  type SearchResult,
} from "@/lib/recordings-search";
import {
  createSupabaseAdminClient,
  isUsingSupabaseServer,
} from "@/lib/supabase/server";

export { fetchFilterOptions };

export async function searchRecordings(params: SearchParams): Promise<SearchResult> {
  const primary = await searchRecordingsPrimary(params);

  if (!isUsingSupabaseServer() || primary.total > 0) {
    return primary;
  }

  const table = await searchRecordingsTable(params);
  return table.total > 0 ? table : primary;
}

async function searchRecordingsTable(p: SearchParams): Promise<SearchResult> {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("recordings")
    .select(
      "id, recorded_at, title, customer_name, customer_phone, category, status, sentiment, risk_level, resolved, escalated, duration_sec, excerpt, tags"
    );

  if (p.category) query = query.eq("category", p.category);
  if (p.risk && p.risk !== "any") query = query.eq("risk_level", p.risk);
  if (p.dateFrom) query = query.gte("recorded_at", p.dateFrom);
  if (p.dateTo) query = query.lte("recorded_at", p.dateTo);

  const q = p.query?.trim();
  if (q) {
    const escaped = q.replace(/[%_]/g, "\\$&");
    query = query.or(
      [
        `title.ilike.%${escaped}%`,
        `customer_name.ilike.%${escaped}%`,
        `customer_phone.ilike.%${escaped}%`,
        `excerpt.ilike.%${escaped}%`,
      ].join(",")
    );
  }

  const { data, error } = await query
    .order("recorded_at", { ascending: false })
    .limit(p.limit ?? 100);

  if (error) {
    console.error("[search] resilient table fallback failed:", error);
    return { hits: [], total: 0, source: "supabase" };
  }

  const hits: SearchHit[] = (data ?? []).map((row: any) => ({
    id: row.id,
    recorded_at: row.recorded_at,
    title: row.title,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    category: row.category,
    status: row.status,
    sentiment: row.sentiment,
    risk_level: row.risk_level,
    resolved: row.resolved ?? false,
    escalated: row.escalated ?? false,
    duration_sec: row.duration_sec ?? 0,
    excerpt: row.excerpt,
    tags: row.tags ?? [],
    matched_in: "meta",
    snippet: row.excerpt || row.title || row.customer_name || row.customer_phone || "",
  }));

  return { hits, total: hits.length, source: "supabase" };
}
