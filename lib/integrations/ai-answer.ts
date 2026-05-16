import type { NaverSearchItem } from "./naver";

export interface CustomerAnswerInput {
  question: string;
  transcript?: string;
  searchResults: NaverSearchItem[];
}

export interface CustomerAnswer {
  provider: "openai" | "anthropic" | "mock";
  answer: string;
  suggestedFollowUps: string[];
}

const SYSTEM_PROMPT = [
  "You are a Korean museum reservation and customer-service assistant.",
  "Answer in Korean, concise but helpful.",
  "Use Naver search snippets only as supporting context, and say when the answer needs staff confirmation.",
  "Never invent prices, schedules, legal guarantees, or availability.",
  "Return JSON with keys answer and suggestedFollowUps.",
].join("\n");

function buildPrompt(input: CustomerAnswerInput): string {
  const sources = input.searchResults
    .slice(0, 12)
    .map(
      (item, index) =>
        `[${index + 1}] ${item.title}\n${item.description}\n${item.link}`
    )
    .join("\n\n");

  return [
    `고객 질문:\n${input.question}`,
    input.transcript ? `통화/상담 맥락:\n${input.transcript}` : "",
    sources ? `네이버 검색 근거:\n${sources}` : "네이버 검색 근거: 없음",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseJsonAnswer(text: string, provider: CustomerAnswer["provider"]): CustomerAnswer {
  try {
    const parsed = JSON.parse(text) as {
      answer?: string;
      suggestedFollowUps?: string[];
    };
    return {
      provider,
      answer: parsed.answer?.trim() || text.trim(),
      suggestedFollowUps: Array.isArray(parsed.suggestedFollowUps)
        ? parsed.suggestedFollowUps.filter((v) => typeof v === "string")
        : [],
    };
  } catch {
    return { provider, answer: text.trim(), suggestedFollowUps: [] };
  }
}

export async function generateCustomerAnswer(
  input: CustomerAnswerInput
): Promise<CustomerAnswer> {
  const provider = (process.env.AI_ANSWER_PROVIDER ?? "openai").toLowerCase();

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return answerWithAnthropic(input);
  }
  if (process.env.OPENAI_API_KEY) {
    return answerWithOpenAI(input);
  }

  return {
    provider: "mock",
    answer:
      "AI API 키가 아직 설정되지 않았습니다. 네이버 검색 결과와 통화 내용을 바탕으로 담당자가 확인 후 답변을 확정해야 합니다.",
    suggestedFollowUps: ["Vercel 환경변수에 OPENAI_API_KEY 또는 ANTHROPIC_API_KEY를 등록하세요."],
  };
}

async function answerWithOpenAI(input: CustomerAnswerInput): Promise<CustomerAnswer> {
  const model = process.env.OPENAI_ANSWER_MODEL ?? "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(input) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI answer failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseJsonAnswer(data.choices?.[0]?.message?.content ?? "", "openai");
}

async function answerWithAnthropic(input: CustomerAnswerInput): Promise<CustomerAnswer> {
  const model = process.env.ANTHROPIC_ANSWER_MODEL ?? "claude-3-5-sonnet-latest";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(input) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic answer failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return parseJsonAnswer(data.content?.find((c) => c.type === "text")?.text ?? "", "anthropic");
}

