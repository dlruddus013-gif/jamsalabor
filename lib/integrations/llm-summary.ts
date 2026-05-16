export interface TranscriptForSummary {
  speaker?: string;
  text: string;
  startSec?: number;
}

export interface RecordingSummaryResult {
  provider: "openai" | "anthropic" | "mock";
  summary: string[];
  actionItems: { id: string; text: string; done: boolean }[];
  keyTopics: string[];
  sentiment: "pos" | "neu" | "neg";
}

const SUMMARY_SYSTEM_PROMPT = [
  "You summarize Korean customer call recordings for a museum/reservation operation.",
  "Return strict JSON with summary, actionItems, keyTopics, sentiment.",
  "summary must be an array of 3 to 6 Korean bullet strings.",
  "actionItems must be an array of objects with id, text, done.",
  "keyTopics must be short Korean nouns.",
  "sentiment must be pos, neu, or neg.",
].join("\n");

function buildTranscriptText(segments: TranscriptForSummary[]): string {
  return segments
    .map((seg) => {
      const time = typeof seg.startSec === "number" ? `${Math.round(seg.startSec)}s` : "";
      const speaker = seg.speaker ?? "speaker";
      return `[${time}] ${speaker}: ${seg.text}`;
    })
    .join("\n")
    .slice(0, 16000);
}

function parseSummary(text: string, provider: RecordingSummaryResult["provider"]): RecordingSummaryResult {
  try {
    const parsed = JSON.parse(text) as Partial<RecordingSummaryResult>;
    return {
      provider,
      summary: Array.isArray(parsed.summary) ? parsed.summary.map(String) : [text],
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.map((item, index) => {
            const row = item as { id?: string; text?: string; done?: boolean };
            return {
              id: row.id || `act_${index + 1}`,
              text: row.text || "",
              done: !!row.done,
            };
          }).filter((item) => item.text)
        : [],
      keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics.map(String) : [],
      sentiment: parsed.sentiment === "pos" || parsed.sentiment === "neg" ? parsed.sentiment : "neu",
    };
  } catch {
    return {
      provider,
      summary: [text],
      actionItems: [],
      keyTopics: [],
      sentiment: "neu",
    };
  }
}

export async function summarizeTranscriptWithLLM(
  segments: TranscriptForSummary[]
): Promise<RecordingSummaryResult> {
  const transcript = buildTranscriptText(segments);
  if (!transcript.trim()) {
    return {
      provider: "mock",
      summary: ["전사 내용이 없어 요약을 생성하지 못했습니다."],
      actionItems: [],
      keyTopics: [],
      sentiment: "neu",
    };
  }

  const provider = (process.env.AI_ANSWER_PROVIDER ?? "openai").toLowerCase();
  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return summarizeWithAnthropic(transcript);
  }
  if (process.env.OPENAI_API_KEY) {
    return summarizeWithOpenAI(transcript);
  }
  return {
    provider: "mock",
    summary: [
      "LLM API 키가 없어 자동 요약은 대기 상태입니다.",
      "전사 텍스트는 저장되었고, API 키 등록 후 다시 처리할 수 있습니다.",
    ],
    actionItems: [{ id: "act_1", text: "OPENAI_API_KEY 또는 ANTHROPIC_API_KEY를 등록하세요.", done: false }],
    keyTopics: ["설정필요"],
    sentiment: "neu",
  };
}

async function summarizeWithOpenAI(transcript: string): Promise<RecordingSummaryResult> {
  const model = process.env.OPENAI_SUMMARY_MODEL ?? process.env.OPENAI_ANSWER_MODEL ?? "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI summary failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseSummary(data.choices?.[0]?.message?.content ?? "", "openai");
}

async function summarizeWithAnthropic(transcript: string): Promise<RecordingSummaryResult> {
  const model = process.env.ANTHROPIC_SUMMARY_MODEL ?? process.env.ANTHROPIC_ANSWER_MODEL ?? "claude-3-5-sonnet-latest";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.15,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: transcript }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic summary failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return parseSummary(data.content?.find((c) => c.type === "text")?.text ?? "", "anthropic");
}

