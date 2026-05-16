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

