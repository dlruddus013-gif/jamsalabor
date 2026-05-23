export interface SmsSendInput {
  to: string;
  message: string;
}

export interface SmsSendResult {
  ok: boolean;
  provider: "webhook" | "aligo" | "mock";
  message: string;
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

export function hasSmsSendConfig() {
  return Boolean(
    process.env.SMS_WEBHOOK_URL ||
      (process.env.ALIGO_API_KEY && process.env.ALIGO_USER_ID && process.env.ALIGO_SENDER)
  );
}

export async function sendSms(input: SmsSendInput): Promise<SmsSendResult> {
  const to = normalizePhone(input.to);
  const message = input.message.trim();
  if (!to || !message) {
    throw new Error("문자 수신번호와 내용이 필요합니다.");
  }

  if (process.env.SMS_WEBHOOK_URL) {
    return sendViaWebhook({ to, message });
  }
  if (process.env.ALIGO_API_KEY && process.env.ALIGO_USER_ID && process.env.ALIGO_SENDER) {
    return sendViaAligo({ to, message });
  }

  return {
    ok: false,
    provider: "mock",
    message: "문자 발송 API 키가 없어 문자앱 링크 또는 복사 기능을 사용합니다.",
  };
}

async function sendViaWebhook(input: SmsSendInput): Promise<SmsSendResult> {
  const res = await fetch(process.env.SMS_WEBHOOK_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SMS_API_KEY ? { Authorization: `Bearer ${process.env.SMS_API_KEY}` } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`SMS webhook failed: ${res.status} ${await res.text()}`);
  }
  return { ok: true, provider: "webhook", message: "문자를 발송했습니다." };
}

async function sendViaAligo(input: SmsSendInput): Promise<SmsSendResult> {
  const params = new URLSearchParams({
    key: process.env.ALIGO_API_KEY!,
    user_id: process.env.ALIGO_USER_ID!,
    sender: process.env.ALIGO_SENDER!,
    receiver: input.to,
    msg: input.message.slice(0, 900),
    msg_type: input.message.length > 90 ? "LMS" : "SMS",
  });

  const res = await fetch("https://apis.aligo.in/send/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const text = await res.text();
  if (!res.ok || !text.includes('"result_code":"1"')) {
    throw new Error(`Aligo SMS failed: ${res.status} ${text}`);
  }
  return { ok: true, provider: "aligo", message: "문자를 발송했습니다." };
}
