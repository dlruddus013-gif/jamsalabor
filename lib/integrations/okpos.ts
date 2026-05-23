export interface OkposConnectionStatus {
  configured: boolean;
  connected: boolean;
  status: "connected" | "missing-config" | "error";
  message: string;
  endpoint?: string;
  storeId?: string;
  checkedAt: string;
}

export interface OkposPurchase {
  purchasedAt: string | null;
  itemName: string;
  quantity?: number | null;
  amount?: number | null;
  place?: string | null;
  channel?: string | null;
  receiptNo?: string | null;
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

export async function fetchOkposPurchasesByPhone(
  phone: string
): Promise<OkposPurchase[]> {
  const config = getOkposConfig();
  if (!config.baseUrl || !config.apiKey || !phone.trim()) return [];

  const purchasesPath = process.env.OKPOS_PURCHASES_PATH ?? "/purchases";
  const url = new URL(`${config.baseUrl}${purchasesPath.startsWith("/") ? purchasesPath : `/${purchasesPath}`}`);
  url.searchParams.set("phone", phone.replace(/\D/g, ""));
  if (config.storeId) url.searchParams.set("storeId", config.storeId);

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

  const res = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`OKPOS purchases failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    items?: unknown[];
    purchases?: unknown[];
    data?: unknown[];
  };
  const rows = data.items ?? data.purchases ?? data.data ?? [];
  return rows.map(normalizePurchase).filter((item) => item.itemName).slice(0, 20);
}

function normalizePurchase(row: unknown): OkposPurchase {
  const value = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const itemName =
    stringValue(value.itemName) ||
    stringValue(value.productName) ||
    stringValue(value.name) ||
    stringValue(value.menuName) ||
    "구매 항목";
  return {
    purchasedAt:
      stringValue(value.purchasedAt) ||
      stringValue(value.saleDateTime) ||
      stringValue(value.soldAt) ||
      stringValue(value.date) ||
      null,
    itemName,
    quantity: numberValue(value.quantity ?? value.qty),
    amount: numberValue(value.amount ?? value.totalAmount ?? value.price),
    place: stringValue(value.place) || stringValue(value.storeName) || stringValue(value.location) || null,
    channel: stringValue(value.channel) || stringValue(value.paymentMethod) || null,
    receiptNo: stringValue(value.receiptNo) || stringValue(value.receiptId) || stringValue(value.orderNo) || null,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
