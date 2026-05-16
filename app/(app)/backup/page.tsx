import UploadDropzone from "@/components/UploadDropzone";

export default function BackupPage() {
  return (
    <div className="space-y-5 animate-slide-up max-w-4xl">
      <div>
        <div className="text-[11px] tracking-[0.3em] uppercase text-gold mb-1">
          Mobile Backup
        </div>
        <h1 className="font-display text-[28px] font-bold">스마트폰 녹음 백업</h1>
        <p className="text-[13px] text-ink-soft mt-1">
          휴대폰의 녹음 파일을 여러 개 선택해 한 번에 백업하고 STT 처리 대기열에 올립니다.
        </p>
      </div>

      <UploadDropzone defaultSource="phone_backup" autoTitleFromFilename />

      <div className="rounded-2xl bg-paper border border-line p-5">
        <h2 className="font-display text-[17px] font-bold mb-2">자동 백업 안내</h2>
        <div className="text-[13px] leading-7 text-ink-soft">
          웹브라우저는 보안상 스마트폰 저장소의 모든 녹음파일을 몰래 읽을 수 없습니다.
          완전 자동 백업은 Android 네이티브 앱에서 녹음 폴더 권한을 받은 뒤 이 앱의 업로드 API로 전송하는 방식이 필요합니다.
          현재 화면은 VITO처럼 여러 파일을 선택해 일괄 업로드하는 웹 백업 흐름입니다.
        </div>
      </div>
    </div>
  );
}

