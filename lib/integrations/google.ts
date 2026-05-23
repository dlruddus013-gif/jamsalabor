export interface GoogleSearchItem {
  title: string;
  link: string;
  description: string;
  source: "google";
  displayLink?: string;
}

function getGoogleCredentials() {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY || process.env.GOOGLE_API_KEY;
  const searchEngineId =
    process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_ID;
  if (!apiKey || !searchEngineId) {
    throw new Error("GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID are required.");
  }
  return { apiKey, searchEngineId };
}

export function hasGoogleSearchConfig() {
  return Boolean(
    (process.env.GOOGLE_SEARCH_API_KEY || process.env.GOOGLE_API_KEY) &&
      (process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_ID)
  );
}

export async function searchGoogle(
  query: string,
  options: { num?: number } = {}
): Promise<GoogleSearchItem[]> {
  const q = query.trim();
  if (!q) return [];

  const { apiKey, searchEngineId } = getGoogleCredentials();
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", searchEngineId);
  url.searchParams.set("q", q);
  url.searchParams.set("num", String(Math.max(1, Math.min(options.num ?? 5, 10))));
  url.searchParams.set("lr", "lang_ko");
  url.searchParams.set("safe", "active");

  const res = await fetch(url, { next: { revalidate: 60 * 10 } });
  if (!res.ok) {
    throw new Error(`Google search failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    items?: {
      title?: string;
      link?: string;
      snippet?: string;
      displayLink?: string;
    }[];
  };

  return (data.items ?? [])
    .map((item) => ({
      title: item.title ?? "",
      link: item.link ?? "",
      description: item.snippet ?? "",
      source: "google" as const,
      displayLink: item.displayLink,
    }))
    .filter((item) => item.title && item.link);
}
