import AutoBackupManager from "@/components/AutoBackupManager";
import ServerBackupRecordings from "@/components/ServerBackupRecordings";
import UploadDropzone from "@/components/UploadDropzone";

export default function BackupPage() {
  return (
    <div className="space-y-5 animate-slide-up max-w-4xl">
      <div>
        <div className="text-[11px] tracking-[0.3em] uppercase text-gold mb-1">
          Mobile Backup
        </div>
        <h1 className="font-display text-[28px] font-bold">스마트폰 녹음 자동 백업</h1>
        <p className="text-[13px] text-ink-soft mt-1">
          녹음 폴더를 한 번 허용하면 앱 접속 시 새 녹음파일을 자동으로 백업하고 STT 처리 대기열에 올립니다.
        </p>
      </div>

      <AutoBackupManager />

      <ServerBackupRecordings />

      <UploadDropzone defaultSource="phone_backup" autoTitleFromFilename />

      <div className="rounded-2xl bg-paper border border-line p-5">
        <h2 className="font-display text-[17px] font-bold mb-2">자동 백업 방식</h2>
        <div className="text-[13px] leading-7 text-ink-soft">
          지원 브라우저에서는 녹음 폴더 권한을 IndexedDB에 저장하고 다음 접속부터 자동으로 스캔합니다.
          이미 백업된 파일은 SHA-256 해시로 건너뜁니다. 브라우저가 폴더 접근을 지원하지 않는 Android 환경에서는
          Android 동반 앱이 `READ_MEDIA_AUDIO` 권한을 받아 서버의 모바일 백업 API로 전송해야 완전 자동 백업이 가능합니다.
        </div>
      </div>
    </div>
  );
}

