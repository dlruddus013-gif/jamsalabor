export interface OkposConnectionStatus {
  configured: boolean;
  connected: boolean;
  status: "connected" | "missing-config" | "error";
  message: string;
  endpoint?: string;
  storeId?: string;
  checkedAt: string;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getOkposConfig() {
  const baseUrl = process.env.OKPOS_API_BASE_URL ?? process.env.OKPOS_OKDC_API_BASE_URL;
  const apiKey = process.env.OKPOS_API_KEY ?? process.env.OKPOS_OKDC_API_KEY;
  const storeId = process.env.OKPOS_STORE_ID ?? process.env.OKPOS_SHOP_CODE;
  const healthPath = process.env.OKPOS_HEALTH_PATH ?? "/health";
  const authHeader = process.env.OKPOS_AUTH_HEADER ?? "Authorization";

  return {
    baseUrl: baseUrl ? trimTrailingSlash(baseUrl) : "",
    apiKey: apiKey ?? "",
    storeId: storeId ?? "",
    healthPath: healthPath.startsWith("/") ? healthPath : `/${healthPath}`,
    authHeader,
  };
}

export function isOkposConfigured() {
  const config = getOkposConfig();
  return Boolean(config.baseUrl && config.apiKey);
}

export async function checkOkposConnection(): Promise<OkposConnectionStatus> {
  const checkedAt = new Date().toISOString();
  const config = getOkposConfig();

  if (!config.baseUrl || !config.apiKey) {
    return {
      configured: false,
      connected: false,
      status: "missing-config",
      message: "OKPOS API 주소와 인증키가 필요합니다.",
      storeId: config.storeId || undefined,
      checkedAt,
    };
  }

  const endpoint = `${config.baseUrl}${config.healthPath}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-API-Key": config.apiKey,
  };

  if (config.authHeader.toLowerCase() === "authorization") {
    headers.Authorization = `Bearer ${config.apiKey}`;
  } else {
    headers[config.authHeader] = config.apiKey;
  }

  if (config.storeId) {
    headers["X-OKPOS-Store-Id"] = config.storeId;
    headers["X-OKPOS-Shop-Code"] = config.storeId;
  }

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        configured: true,
        connected: false,
        status: "error",
        message: `OKPOS 응답 오류 ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
        endpoint,
        storeId: config.storeId || undefined,
        checkedAt,
      };
    }

    return {
      configured: true,
      connected: true,
      status: "connected",
      message: "OKPOS API 연결 확인 완료",
      endpoint,
      storeId: config.storeId || undefined,
      checkedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      configured: true,
      connected: false,
      status: "error",
      message: `OKPOS 연결 실패: ${message}`,
      endpoint,
      storeId: config.storeId || undefined,
      checkedAt,
    };
  }
}
