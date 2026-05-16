export type NaverSearchType = "webkr" | "news" | "blog" | "kin" | "local";

export interface NaverSearchItem {
  title: string;
  link: string;
  description: string;
  source: NaverSearchType;
  publishedAt?: string | null;
}

const SEARCH_ENDPOINTS: Record<NaverSearchType, string> = {
  webkr: "https://openapi.naver.com/v1/search/webkr.json",
  news: "https://openapi.naver.com/v1/search/news.json",
  blog: "https://openapi.naver.com/v1/search/blog.json",
  kin: "https://openapi.naver.com/v1/search/kin.json",
  local: "https://openapi.naver.com/v1/search/local.json",
};

function getNaverCredentials() {
  const clientId = process.env.NAVER_SEARCH_CLIENT_ID;
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("NAVER_SEARCH_CLIENT_ID and NAVER_SEARCH_CLIENT_SECRET are required.");
  }
  return { clientId, clientSecret };
}

export function stripNaverMarkup(value: string): string {
  return value
    .replace(/<\/?b>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export async function searchNaver(
  query: string,
  options: {
    types?: NaverSearchType[];
    display?: number;
    sort?: "sim" | "date";
  } = {}
): Promise<NaverSearchItem[]> {
  const q = query.trim();
  if (!q) return [];

  const { clientId, clientSecret } = getNaverCredentials();
  const types = options.types ?? ["webkr", "news", "blog", "kin"];
  const display = Math.max(1, Math.min(options.display ?? 5, 20));

  const results = await Promise.all(
    types.map(async (type) => {
      const url = new URL(SEARCH_ENDPOINTS[type]);
      url.searchParams.set("query", q);
      url.searchParams.set("display", String(display));
      url.searchParams.set("start", "1");
      if (type !== "local") url.searchParams.set("sort", options.sort ?? "sim");

      const res = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
          "X-NCP-APIGW-API-KEY-ID": clientId,
          "X-NCP-APIGW-API-KEY": clientSecret,
        },
        next: { revalidate: 60 * 10 },
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(`Naver ${type} search failed: ${res.status} ${message}`);
      }

      const data = (await res.json()) as { items?: Record<string, string>[] };
      return (data.items ?? []).map((item) => ({
        title: stripNaverMarkup(item.title ?? ""),
        link: item.link ?? "",
        description: stripNaverMarkup(item.description ?? ""),
        source: type,
        publishedAt: item.pubDate ?? item.postdate ?? null,
      }));
    })
  );

  return results.flat().filter((item) => item.title && item.link);
}
