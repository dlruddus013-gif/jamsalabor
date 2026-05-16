import { NextResponse } from "next/server";
import { searchNaver } from "@/lib/integrations/naver";
import { checkOkposConnection } from "@/lib/integrations/okpos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServiceStatus = {
  configured: boolean;
  connected: boolean;
  status: "connected" | "missing-config" | "error";
  message: string;
  checkedAt: string;
};

function hasNaverSearchConfig() {
  return Boolean(
    process.env.NAVER_SEARCH_CLIENT_ID && process.env.NAVER_SEARCH_CLIENT_SECRET
  );
}

function hasNaverSpeechConfig() {
  return Boolean(
    (process.env.NAVER_CLOVA_SPEECH_INVOKE_URL && process.env.NAVER_CLOVA_SPEECH_SECRET) ||
      ((process.env.NAVER_CLOUD_CLIENT_ID || process.env.NAVER_CLIENT_ID) &&
        (process.env.NAVER_CLOUD_CLIENT_SECRET || process.env.NAVER_CLIENT_SECRET))
  );
}

async function checkNaverSearch(): Promise<ServiceStatus> {
  const checkedAt = new Date().toISOString();
  if (!hasNaverSearchConfig()) {
    return {
      configured: false,
      connected: false,
      status: "missing-config",
      message: "NAVER 검색 API 키가 필요합니다.",
      checkedAt,
    };
  }

  try {
    await searchNaver("한국잠사박물관", { types: ["webkr"], display: 1 });
    return {
      configured: true,
      connected: true,
      status: "connected",
      message: "NAVER 검색 API 연결 확인 완료",
      checkedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      configured: true,
      connected: false,
      status: "error",
      message,
      checkedAt,
    };
  }
}

function checkNaverSpeech(): ServiceStatus {
  const checkedAt = new Date().toISOString();
  const configured = hasNaverSpeechConfig();
  return {
    configured,
    connected: configured,
    status: configured ? "connected" : "missing-config",
    message: configured
      ? "NAVER CLOVA STT 설정 확인 완료"
      : "NAVER CLOVA Speech 또는 CSR STT 키가 필요합니다.",
    checkedAt,
  };
}

export async function GET() {
  const [naverSearch, okpos] = await Promise.all([
    checkNaverSearch(),
    checkOkposConnection(),
  ]);

  const naverSpeech = checkNaverSpeech();

  return NextResponse.json({
    naver: {
      connected: naverSearch.connected || naverSpeech.connected,
      search: naverSearch,
      speech: naverSpeech,
    },
    okpos,
  });
}
