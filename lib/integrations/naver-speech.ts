export interface NaverSpeechSegment {
  speaker?: string;
  text: string;
  startSec: number;
  endSec: number;
  confidence?: number | null;
}

export interface NaverSpeechResult {
  text: string;
  segments: NaverSpeechSegment[];
  raw: unknown;
}

export async function transcribeSignedUrlWithNaver(
  signedUrl: string,
  options: { language?: "ko-KR" | "en-US" | "ja" | "zh-cn"; completion?: "sync" | "async" } = {}
): Promise<NaverSpeechResult> {
  const invokeUrl = process.env.NAVER_CLOVA_SPEECH_INVOKE_URL;
  const secret = process.env.NAVER_CLOVA_SPEECH_SECRET;
  if (!invokeUrl || !secret) {
    return transcribeSignedUrlWithNaverCsr(signedUrl, options);
  }

  return transcribeSignedUrlWithNaverLongForm(signedUrl, options, invokeUrl, secret);
}

async function transcribeSignedUrlWithNaverLongForm(
  signedUrl: string,
  options: { language?: "ko-KR" | "en-US" | "ja" | "zh-cn"; completion?: "sync" | "async" },
  invokeUrl: string,
  secret: string
): Promise<NaverSpeechResult> {
  if (!invokeUrl || !secret) {
    throw new Error("NAVER_CLOVA_SPEECH_INVOKE_URL and NAVER_CLOVA_SPEECH_SECRET are required.");
  }

  const base = invokeUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/recognizer/url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CLOVASPEECH-API-KEY": secret,
    },
    body: JSON.stringify({
      url: signedUrl,
      language: options.language ?? "ko-KR",
      completion: options.completion ?? "sync",
      diarization: { enable: true },
      wordAlignment: true,
      fullText: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Naver CLOVA Speech failed: ${res.status} ${await res.text()}`);
  }

  const raw = (await res.json()) as {
    text?: string;
    segments?: {
      text?: string;
      start?: number;
      end?: number;
      speaker?: { label?: string };
      confidence?: number;
    }[];
  };

  const segments = (raw.segments ?? [])
    .filter((seg) => seg.text)
    .map((seg) => ({
      speaker: seg.speaker?.label,
      text: seg.text ?? "",
      startSec: (seg.start ?? 0) / 1000,
      endSec: (seg.end ?? 0) / 1000,
      confidence: seg.confidence ?? null,
    }));

  return {
    text: raw.text ?? segments.map((seg) => seg.text).join("\n"),
    segments,
    raw,
  };
}

async function transcribeSignedUrlWithNaverCsr(
  signedUrl: string,
  options: { language?: "ko-KR" | "en-US" | "ja" | "zh-cn" }
): Promise<NaverSpeechResult> {
  const clientId = process.env.NAVER_CLOUD_CLIENT_ID ?? process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLOUD_CLIENT_SECRET ?? process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "NAVER_CLOVA_SPEECH_INVOKE_URL/NAVER_CLOVA_SPEECH_SECRET or NAVER_CLOUD_CLIENT_ID/NAVER_CLOUD_CLIENT_SECRET are required."
    );
  }

  const audio = await fetch(signedUrl);
  if (!audio.ok) {
    throw new Error(`Audio download for NAVER CSR failed: ${audio.status} ${await audio.text()}`);
  }

  const endpoint =
    process.env.NAVER_CSR_STT_ENDPOINT ??
    `https://naveropenapi.apigw.ntruss.com/recog/v1/stt?lang=${toCsrLanguage(options.language ?? "ko-KR")}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-NCP-APIGW-API-KEY-ID": clientId,
      "X-NCP-APIGW-API-KEY": clientSecret,
    },
    body: await audio.arrayBuffer(),
  });

  if (!res.ok) {
    throw new Error(`Naver CLOVA CSR failed: ${res.status} ${await res.text()}`);
  }

  const raw = (await res.json()) as { text?: string };
  const text = raw.text ?? "";
  return {
    text,
    segments: text ? [{ text, startSec: 0, endSec: 0, speaker: "0", confidence: null }] : [],
    raw,
  };
}

function toCsrLanguage(language: "ko-KR" | "en-US" | "ja" | "zh-cn") {
  const map = {
    "ko-KR": "Kor",
    "en-US": "Eng",
    ja: "Jpn",
    "zh-cn": "Chn",
  };
  return map[language];
}
