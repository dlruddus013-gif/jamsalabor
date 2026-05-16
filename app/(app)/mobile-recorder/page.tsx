import MobileRecorder from "@/components/MobileRecorder";

export default function MobileRecorderPage() {
  return (
    <div className="space-y-5 animate-slide-up">
      <div>
        <div className="text-[11px] tracking-[0.3em] uppercase text-gold mb-1">
          Mobile Recorder
        </div>
        <h1 className="font-display text-[28px] font-bold">즉석 녹음</h1>
        <p className="text-[13px] text-ink-soft mt-1">
          현장 인터뷰·메모를 브라우저에서 직접 녹음하고 자동 분석으로 보냅니다.
        </p>
      </div>

      <MobileRecorder />

      <div className="max-w-md mx-auto rounded-2xl bg-paper border border-line p-4">
        <div className="text-[12px] font-semibold mb-2">사용 안내</div>
        <ul className="text-[11px] text-ink-soft space-y-1.5 leading-relaxed">
          <li>· 처음 사용 시 마이크 권한을 허용해주세요.</li>
          <li>· 녹음은 브라우저에서 직접 처리되며, 업로드 시 Supabase Storage 로 전송됩니다.</li>
          <li>· iOS Safari 의 경우 화면을 잠그면 녹음이 중단됩니다. 화면을 켜두세요.</li>
          <li>· 백그라운드 전환 시 일부 모바일 브라우저에서 녹음이 일시 중단될 수 있습니다.</li>
          <li>· 업로드 전까지 데이터는 브라우저 메모리에만 보관되며, 새로고침 시 사라집니다.</li>
        </ul>
      </div>
    </div>
  );
}
