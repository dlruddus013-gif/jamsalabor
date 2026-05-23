export interface EvidenceItem {
  title: string;
  link: string;
  description: string;
  source: string;
  publishedAt?: string | null;
}

export interface PurchaseItem {
  purchasedAt: string | null;
  itemName: string;
  quantity?: number | null;
  amount?: number | null;
  place?: string | null;
  channel?: string | null;
  receiptNo?: string | null;
}

export interface CustomerHistoryItem {
  recorded_at: string;
  title: string | null;
  excerpt: string | null;
  category: string | null;
  status: string | null;
  tags: string[];
}

export interface CustomerAnswerInput {
  question: string;
  transcript?: string;
  customerName?: string;
  customerPhone?: string;
  searchResults: EvidenceItem[];
  customerHistory?: CustomerHistoryItem[];
  purchases?: PurchaseItem[];
}

export interface CustomerAnswer {
  provider: "openai" | "anthropic" | "hybrid" | "mock";
  answer: string;
  suggestedFollowUps: string[];
  customerProfile: string;
  dailySummary: string[];
  requestedActions: string[];
  resolutionPlan: string[];
  informationToSend: string[];
  smsDraft: string;
  confidence: number;
  selectedReason: string;
  candidates?: { provider: "openai" | "anthropic"; answer: string }[];
}

const SYSTEM_PROMPT = [
  "You are a Korean museum reservation and customer-service assistant for Korea Jamsa Museum.",
  "Analyze each customer by phone number when customer context is provided.",
  "Use web evidence, prior call summaries, STT excerpts, and purchase/POS history only as supporting context.",
  "Never invent prices, schedules, purchase details, availability, legal guarantees, or policy exceptions.",
  "If evidence is weak, say that staff confirmation is needed and provide the safest next action.",
  "Return concise Korean JSON only.",
].join("\n");

const ANSWER_SCHEMA = {
  name: "customer_answer",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      suggestedFollowUps: { type: "array", items: { type: "string" } },
      customerProfile: { type: "string" },
      dailySummary: { type: "array", items: { type: "string" } },
      requestedActions: { type: "array", items: { type: "string" } },
      resolutionPlan: { type: "array", items: { type: "string" } },
      informationToSend: { type: "array", items: { type: "string" } },
      smsDraft: { type: "string" },
      confidence: { type: "number" },
      selectedReason: { type: "string" },
    },
    required: [
      "answer",
      "suggestedFollowUps",
      "customerProfile",
      "dailySummary",
      "requestedActions",
      "resolutionPlan",
      "informationToSend",
      "smsDraft",
      "confidence",
      "selectedReason",
    ],
  },
  strict: true,
};

function buildPrompt(input: CustomerAnswerInput): string {
  const sources = input.searchResults
    .slice(0, 14)
    .map(
      (item, index) =>
        `[${index + 1}] ${item.source.toUpperCase()} · ${item.title}\n${item.description}\n${item.link}`
    )
    .join("\n\n");

  const history = (input.customerHistory ?? [])
    .slice(0, 12)
    .map(
      (item, index) =>
        `[${index + 1}] ${item.recorded_at} · ${item.title ?? "제목 없음"} · ${item.category ?? "분류 없음"}\n${item.excerpt ?? ""}`
    )
    .join("\n\n");

  const purchases = (input.purchases ?? [])
    .slice(0, 12)
    .map((item, index) =>
      [
        `[${index + 1}] ${item.purchasedAt ?? "일시 미상"} · ${item.itemName}`,
        item.quantity ? `수량 ${item.quantity}` : "",
        item.amount ? `금액 ${item.amount}` : "",
        item.place ? `장소 ${item.place}` : "",
        item.channel ? `채널 ${item.channel}` : "",
        item.receiptNo ? `영수증 ${item.receiptNo}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    )
    .join("\n");

  return [
    `고객명: ${input.customerName || "미입력"}`,
    `전화번호: ${input.customerPhone || "미입력"}`,
    `고객 질문:\n${input.question}`,
    input.transcript ? `통화/STT 맥락:\n${input.transcript}` : "",
    history ? `번호별 이전 대화 요약:\n${history}` : "번호별 이전 대화 요약: 없음",
    purchases ? `POS 구매/방문 조회:\n${purchases}` : "POS 구매/방문 조회: 없음",
    sources ? `웹 검색 근거:\n${sources}` : "웹 검색 근거: 없음",
    [
      "작성 요구:",
      "1. 고객 성향을 한 문장으로 요약",
      "2. 일별 대화내용 요약",
      "3. 고객 요청사항과 해결방안",
      "4. 고객에게 전달할 핵심 정보",
      "5. 문자로 보낼 수 있는 짧은 안내문",
      "6. 최종 상담 답변",
      "7. 확실하지 않은 내용은 직원 확인 필요로 표시",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseJsonAnswer(
  text: string,
  provider: CustomerAnswer["provider"],
  extras: Partial<CustomerAnswer> = {}
): CustomerAnswer {
  try {
    const parsed = JSON.parse(text) as Partial<CustomerAnswer>;
    return normalizeAnswer({ ...parsed, provider, ...extras });
  } catch {
    return normalizeAnswer({ provider, answer: text.trim(), ...extras });
  }
}

function normalizeAnswer(input: Partial<CustomerAnswer>): CustomerAnswer {
  return {
    provider: input.provider ?? "mock",
    answer: input.answer?.trim() || "답변 생성 결과가 비어 있습니다.",
    suggestedFollowUps: arrayOfStrings(input.suggestedFollowUps),
    customerProfile: input.customerProfile?.trim() || "고객 성향 정보가 아직 충분하지 않습니다.",
    dailySummary: arrayOfStrings(input.dailySummary),
    requestedActions: arrayOfStrings(input.requestedActions),
    resolutionPlan: arrayOfStrings(input.resolutionPlan),
    informationToSend: arrayOfStrings(input.informationToSend),
    smsDraft: input.smsDraft?.trim() || makeSmsDraft(input.answer ?? ""),
    confidence: clampConfidence(input.confidence),
    selectedReason: input.selectedReason?.trim() || "가용 근거를 기준으로 생성했습니다.",
    candidates: input.candidates,
  };
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function clampConfidence(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function makeSmsDraft(answer: string) {
  return answer.replace(/\s+/g, " ").slice(0, 180);
}

export async function generateCustomerAnswer(
  input: CustomerAnswerInput
): Promise<CustomerAnswer> {
  const provider = (process.env.AI_ANSWER_PROVIDER ?? "hybrid").toLowerCase();
  const canUseAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const canUseOpenAI = Boolean(process.env.OPENAI_API_KEY);

  if ((provider === "anthropic" || provider === "claude") && canUseAnthropic) {
    return answerWithAnthropic(input);
  }
  if (provider === "openai" && canUseOpenAI) {
    return answerWithOpenAI(input);
  }
  if (canUseOpenAI && canUseAnthropic) {
    return answerWithHybrid(input);
  }
  if (canUseOpenAI) return answerWithOpenAI(input);
  if (canUseAnthropic) return answerWithAnthropic(input);

  return normalizeAnswer({
    provider: "mock",
    answer:
      "AI API 키가 아직 설정되지 않았습니다. 웹 검색 결과, 이전 상담, 구매내역을 확인한 뒤 담당자가 최종 답변을 확정해야 합니다.",
    suggestedFollowUps: ["Vercel 환경변수에 OPENAI_API_KEY 또는 ANTHROPIC_API_KEY를 등록하세요."],
    selectedReason: "AI 제공자 키가 없어 안전 안내문을 반환했습니다.",
  });
}

async function answerWithHybrid(input: CustomerAnswerInput): Promise<CustomerAnswer> {
  const [openai, anthropic] = await Promise.allSettled([
    answerWithOpenAI(input),
    answerWithAnthropic(input),
  ]);
  const candidates = [openai, anthropic]
    .filter((item): item is PromiseFulfilledResult<CustomerAnswer> => item.status === "fulfilled")
    .map((item) => item.value);

  if (candidates.length === 0) {
    const errors = [openai, anthropic]
      .filter((item): item is PromiseRejectedResult => item.status === "rejected")
      .map((item) => String(item.reason))
      .join(" / ");
    throw new Error(`AI answer failed: ${errors}`);
  }
  if (candidates.length === 1) return candidates[0];

  if (process.env.OPENAI_API_KEY) {
    return judgeWithOpenAI(input, candidates);
  }

  const best = candidates.sort((a, b) => scoreAnswer(b) - scoreAnswer(a))[0];
  return {
    ...best,
    provider: "hybrid",
    selectedReason: "두 후보 중 근거/해결방안/문자안 구성이 더 완성된 답변을 선택했습니다.",
    candidates: candidates.map((item) => ({ provider: item.provider as "openai" | "anthropic", answer: item.answer })),
  };
}

async function answerWithOpenAI(input: CustomerAnswerInput): Promise<CustomerAnswer> {
  const model = process.env.OPENAI_ANSWER_MODEL ?? "gpt-4.1-mini";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(input) },
      ],
      text: {
        format: {
          type: "json_schema",
          ...ANSWER_SCHEMA,
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI answer failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { output_text?: string; output?: { content?: { text?: string }[] }[] };
  return parseJsonAnswer(extractOpenAIText(data), "openai");
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
      max_tokens: 1400,
      temperature: 0.2,
      system: `${SYSTEM_PROMPT}\nReturn a JSON object matching this shape: ${JSON.stringify(ANSWER_SCHEMA.schema)}`,
      messages: [{ role: "user", content: buildPrompt(input) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic answer failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return parseJsonAnswer(data.content?.find((c) => c.type === "text")?.text ?? "", "anthropic");
}

async function judgeWithOpenAI(
  input: CustomerAnswerInput,
  candidates: CustomerAnswer[]
): Promise<CustomerAnswer> {
  const model = process.env.OPENAI_JUDGE_MODEL ?? process.env.OPENAI_ANSWER_MODEL ?? "gpt-4.1-mini";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      input: [
        { role: "system", content: `${SYSTEM_PROMPT}\nChoose and improve the most useful customer-service answer.` },
        {
          role: "user",
          content: [
            buildPrompt(input),
            "후보 답변:",
            ...candidates.map((item, index) => `후보 ${index + 1} (${item.provider})\n${JSON.stringify(item)}`),
          ].join("\n\n"),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          ...ANSWER_SCHEMA,
        },
      },
    }),
  });
  if (!res.ok) {
    const best = candidates.sort((a, b) => scoreAnswer(b) - scoreAnswer(a))[0];
    return {
      ...best,
      provider: "hybrid",
      selectedReason: `OpenAI 평가 실패 후 자체 점수로 선택했습니다: ${res.status}`,
      candidates: candidates.map((item) => ({ provider: item.provider as "openai" | "anthropic", answer: item.answer })),
    };
  }
  const data = (await res.json()) as { output_text?: string; output?: { content?: { text?: string }[] }[] };
  return parseJsonAnswer(extractOpenAIText(data), "hybrid", {
    candidates: candidates.map((item) => ({ provider: item.provider as "openai" | "anthropic", answer: item.answer })),
  });
}

function extractOpenAIText(data: { output_text?: string; output?: { content?: { text?: string }[] }[] }) {
  if (data.output_text) return data.output_text;
  return (
    data.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

function scoreAnswer(answer: CustomerAnswer) {
  return (
    answer.answer.length / 200 +
    answer.suggestedFollowUps.length +
    answer.resolutionPlan.length * 2 +
    answer.informationToSend.length +
    answer.requestedActions.length +
    answer.confidence * 3
  );
}
