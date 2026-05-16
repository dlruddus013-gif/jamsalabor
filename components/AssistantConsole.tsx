"use client";

import { useState, useTransition } from "react";
import { Bot, Loader2, Search, Sparkles } from "lucide-react";

interface SearchResult {
  title: string;
  link: string;
  description: string;
  source: string;
}

interface AnswerResult {
  provider: string;
  answer: string;
  suggestedFollowUps: string[];
  searchResults: SearchResult[];
  error?: string;
}

export default function AssistantConsole() {
  const [question, setQuestion] = useState("");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const ask = () => {
    startTransition(async () => {
      setResult(null);
      const res = await fetch("/api/assistant/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, transcript }),
      });
      setResult((await res.json()) as AnswerResult);
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <section className="rounded-2xl bg-paper border border-line p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center">
            <Bot size={17} />
          </div>
          <div>
            <h2 className="font-display text-[17px] font-bold">자동 답변 생성</h2>
            <p className="text-[12px] text-ink-mute">네이버 검색 근거와 AI를 함께 사용합니다.</p>
          </div>
        </div>

        <label className="block text-[12px] font-semibold mb-1">고객 질문</label>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="w-full min-h-28 rounded-xl border border-line bg-cream/40 p-3 text-[13px] outline-none focus:border-accent"
          placeholder="예: 잠사박물관 단체 관람 식사 포함 가능할까요?"
        />

        <label className="block text-[12px] font-semibold mt-4 mb-1">통화 맥락 또는 STT 일부</label>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          className="w-full min-h-36 rounded-xl border border-line bg-cream/40 p-3 text-[13px] outline-none focus:border-accent"
          placeholder="고객이 물어본 내용을 붙여넣으면 답변 정확도가 올라갑니다."
        />

        <button
          onClick={ask}
          disabled={!question.trim() || isPending}
          className="mt-4 w-full rounded-xl bg-ink text-cream py-3 text-[13px] font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          네이버 검색 후 AI 답변 생성
        </button>
      </section>

      <section className="rounded-2xl bg-paper border border-line p-5 min-h-[420px]">
        {!result && (
          <div className="h-full flex items-center justify-center text-center text-ink-mute text-[13px]">
            질문을 입력하면 이곳에 답변 초안과 네이버 검색 근거가 표시됩니다.
          </div>
        )}

        {result?.error && (
          <div className="rounded-xl border border-accent/30 bg-accent/10 p-4 text-[13px] text-accent">
            {result.error}
          </div>
        )}

        {result && !result.error && (
          <div className="space-y-4">
            <div>
              <div className="text-[11px] tracking-[0.25em] uppercase text-gold mb-2">
                AI Answer · {result.provider}
              </div>
              <div className="whitespace-pre-wrap rounded-xl bg-cream/50 border border-line p-4 text-[14px] leading-7">
                {result.answer}
              </div>
            </div>

            {result.suggestedFollowUps?.length > 0 && (
              <div>
                <h3 className="text-[12px] font-semibold mb-2">후속 확인</h3>
                <div className="space-y-1.5">
                  {result.suggestedFollowUps.map((item, index) => (
                    <div key={index} className="text-[12px] rounded-lg bg-surface px-3 py-2">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-[12px] font-semibold mb-2 flex items-center gap-1">
                <Search size={13} /> 네이버 검색 근거
              </h3>
              <div className="space-y-2 max-h-72 overflow-auto scroll-thin">
                {result.searchResults?.map((item, index) => (
                  <a
                    key={`${item.link}_${index}`}
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-line p-3 hover:bg-surface/60"
                  >
                    <div className="text-[12px] font-semibold">{item.title}</div>
                    <div className="text-[11px] text-ink-mute mt-1 line-clamp-2">{item.description}</div>
                    <div className="text-[10px] text-sky mt-1">{item.source}</div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

