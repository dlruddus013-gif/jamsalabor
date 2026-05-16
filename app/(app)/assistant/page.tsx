import AssistantConsole from "@/components/AssistantConsole";

export default function AssistantPage() {
  return (
    <div className="space-y-5 animate-slide-up">
      <div>
        <div className="text-[11px] tracking-[0.3em] uppercase text-gold mb-1">
          Answer Engine
        </div>
        <h1 className="font-display text-[28px] font-bold">고객 질문 자동답변</h1>
        <p className="text-[13px] text-ink-soft mt-1">
          네이버 검색으로 최신 근거를 찾고 Claude 또는 ChatGPT API로 상담 답변 초안을 만듭니다.
        </p>
      </div>
      <AssistantConsole />
    </div>
  );
}

