import { NextResponse } from "next/server";
import { searchNaver } from "@/lib/integrations/naver";
import { checkOkposConnection } from "@/lib/integrations/okpos";
import { hasGoogleSearchConfig, searchGoogle } from "@/lib/integrations/google";
import { hasSmsSendConfig } from "@/lib/integrations/sms";

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

function hasOpenAIConfig() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function hasAnthropicConfig() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function hasSmsConfig() {
  return hasSmsSendConfig();
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

async function checkGoogleSearch(): Promise<ServiceStatus> {
  const checkedAt = new Date().toISOString();
  if (!hasGoogleSearchConfig()) {
    return {
      configured: false,
      connected: false,
      status: "missing-config",
      message: "Google Custom Search API 키와 검색엔진 ID가 필요합니다.",
      checkedAt,
    };
  }
  try {
    await searchGoogle("한국잠사박물관", { num: 1 });
    return {
      configured: true,
      connected: true,
      status: "connected",
      message: "Google 검색 API 연결 확인 완료",
      checkedAt,
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      status: "error",
      message: error instanceof Error ? error.message : "unknown error",
      checkedAt,
    };
  }
}

function checkOpenAI(): ServiceStatus {
  const configured = hasOpenAIConfig();
  return {
    configured,
    connected: configured,
    status: configured ? "connected" : "missing-config",
    message: configured ? "ChatGPT/OpenAI API 키 설정 완료" : "OPENAI_API_KEY가 필요합니다.",
    checkedAt: new Date().toISOString(),
  };
}

function checkAnthropic(): ServiceStatus {
  const configured = hasAnthropicConfig();
  return {
    configured,
    connected: configured,
    status: configured ? "connected" : "missing-config",
    message: configured ? "Claude API 키 설정 완료" : "ANTHROPIC_API_KEY가 필요합니다.",
    checkedAt: new Date().toISOString(),
  };
}

function checkSms(): ServiceStatus {
  const configured = hasSmsConfig();
  return {
    configured,
    connected: configured,
    status: configured ? "connected" : "missing-config",
    message: configured ? "문자 발송 API 설정 감지" : "SMS API 키가 없어서 웹 공유/복사만 사용합니다.",
    checkedAt: new Date().toISOString(),
  };
}

export async function GET() {
  const [naverSearch, googleSearch, okpos] = await Promise.all([
    checkNaverSearch(),
    checkGoogleSearch(),
    checkOkposConnection(),
  ]);

  const naverSpeech = checkNaverSpeech();

  return NextResponse.json({
    naver: {
      connected: naverSearch.connected || naverSpeech.connected,
      search: naverSearch,
      speech: naverSpeech,
    },
    google: {
      connected: googleSearch.connected,
      search: googleSearch,
    },
    ai: {
      connected: checkOpenAI().connected || checkAnthropic().connected,
      openai: checkOpenAI(),
      anthropic: checkAnthropic(),
    },
    sms: checkSms(),
    okpos,
  });
}
