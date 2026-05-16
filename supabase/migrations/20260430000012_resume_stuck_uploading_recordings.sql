-- 20260430000012_resume_stuck_uploading_recordings.sql
-- Resume recordings that were created before direct upload/STT handoff fixes
-- and are stuck at `uploading` even though an audio object path exists.

update public.recordings
set status = 'processing'
where status = 'uploading'
  and audio_path is not null;

insert into public.stt_jobs (recording_id, status, engine, language, priority)
select r.id, 'queued', 'naver-clova-speech', 'ko', 100
from public.recordings r
where r.status = 'processing'
  and r.audio_path is not null
  and not exists (
    select 1
    from public.stt_jobs j
    where j.recording_id = r.id
      and j.status in ('queued', 'running', 'completed')
  );
