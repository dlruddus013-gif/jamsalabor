import UploadDropzone from "@/components/UploadDropzone";

export default function UploadPage() {
  return (
    <div className="space-y-5 animate-slide-up max-w-3xl">
      <div>
        <div className="text-[11px] tracking-[0.3em] uppercase text-gold mb-1">
          Upload
        </div>
        <h1 className="font-display text-[28px] font-bold">오디오 업로드</h1>
        <p className="text-[13px] text-ink-soft mt-1">
          기존 통화 녹음 파일을 업로드하면 자동으로 STT 변환·AI 요약이 진행됩니다.
        </p>
      </div>

      <UploadDropzone />

      {/* 안내 */}
      <div className="rounded-2xl bg-gold/10 border border-gold/30 p-4 flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-gold/20 text-gold flex items-center justify-center shrink-0 font-bold">
          i
        </div>
        <div>
          <div className="text-[13px] font-semibold">처리 흐름</div>
          <div className="text-[11px] text-ink-soft mt-0.5 leading-relaxed">
            업로드 → Supabase Storage 저장 → Whisper STT 변환 → Claude 요약 → 통화 목록 노출.
            <br />각 단계는 백그라운드 워커가 처리하며, 완료 시 알림이 발송됩니다.
          </div>
        </div>
      </div>
    </div>
  );
}
