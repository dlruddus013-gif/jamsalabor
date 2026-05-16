alter table public.recordings
  drop constraint if exists recordings_source_check;

alter table public.recordings
  add constraint recordings_source_check
  check (source is null or source in (
    'phone',
    'upload',
    'mobile_recording',
    'web_recording',
    'phone_backup'
  ));

comment on column public.recordings.source is
  'Recording source: phone, upload, mobile_recording, web_recording, phone_backup.';
