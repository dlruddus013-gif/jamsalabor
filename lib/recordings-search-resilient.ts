import "server-only";

import {
  fetchFilterOptions,
  searchRecordings as searchRecordingsPrimary,
  type SearchHit,
  type SearchParams,
  type SearchResult,
} from "@/lib/recordings-search";
import { CALL_RECORDING_CATEGORY } from "@/lib/recording-category";
import {
  createSupabaseAdminClient,
  isUsingSupabaseServer,
} from "@/lib/supabase/server";
import { ACCEPTED_EXTENSIONS, getExtension, STORAGE_BUCKET } from "@/lib/upload";

export { fetchFilterOptions };

export async function searchRecordings(params: SearchParams): Promise<SearchResult> {
  const primary = await searchRecordingsPrimary(params);

  if (!isUsingSupabaseServer() || primary.total > 0) {
    return primary;
  }

  const table = await searchRecordingsTable(params);
  if (table.total === 0) {
    await recoverStorageBackups();
    return searchRecordingsTable(params);
  }
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

async function recoverStorageBackups() {
  const supabase = createSupabaseAdminClient();
  const files = await listBackupStorageFiles(supabase);
  if (files.length === 0) return;

  const uniqueFiles = [...new Map(files.map((file) => [file.path, file])).values()];
  const paths = uniqueFiles.map((file) => file.path);
  const { data: existing, error: existingError } = await supabase
    .from("recordings")
    .select("audio_path")
    .in("audio_path", paths);

  if (existingError) {
    console.error("[search] storage recovery duplicate check failed:", existingError);
    return;
  }

  const seen = new Set((existing ?? []).map((row: any) => row.audio_path));
  const rows = uniqueFiles
    .filter((file) => !seen.has(file.path))
    .map((file) => {
      const filename = file.path.split("/").pop() || file.path;
      const ext = getExtension(filename);
      return {
        recorded_at: file.createdAt,
        title: filename.replace(/\.[^.]+$/, ""),
        duration_sec: 0,
        audio_path: file.path,
        audio_mime: ext ? `audio/${ext}` : "audio/mpeg",
        audio_size_bytes: file.size,
        status: "processing",
        source: "phone_backup",
        category: CALL_RECORDING_CATEGORY,
        tags: [CALL_RECORDING_CATEGORY, "backup"],
        metadata: {
          recovered_from_storage: true,
          original_filename: filename,
        },
      };
    });

  if (rows.length === 0) return;

  const { error } = await supabase.from("recordings").insert(rows);
  if (error) {
    console.error("[search] storage recovery insert failed:", error);
  }
}

async function listBackupStorageFiles(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const roots = ["", "phone-backups", "mobile-backups"];
  const out: { path: string; size: number | null; createdAt: string }[] = [];
  const visited = new Set<string>();

  for (const root of roots) {
    await walkStoragePath(supabase, root, out, visited, 0);
  }

  return out.slice(0, 300);
}

async function walkStoragePath(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  prefix: string,
  out: { path: string; size: number | null; createdAt: string }[],
  visited: Set<string>,
  depth: number
) {
  if (depth > 3 || out.length >= 300 || visited.has(prefix)) return;
  visited.add(prefix);

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(prefix, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });

  if (error) {
    console.error("[search] storage recovery list failed:", prefix, error);
    return;
  }

  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    const ext = getExtension(item.name);
    if ((item as any).metadata && ACCEPTED_EXTENSIONS.includes(ext as any)) {
      out.push({
        path,
        size: typeof item.metadata?.size === "number" ? item.metadata.size : null,
        createdAt: item.created_at || item.updated_at || new Date().toISOString(),
      });
      continue;
    }
    await walkStoragePath(supabase, path, out, visited, depth + 1);
  }
}
