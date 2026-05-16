# Android Companion Auto Backup

웹앱은 Android 보안 정책 때문에 접속만으로 휴대폰 내부 녹음 폴더를 자동 스캔할 수 없습니다.  
자동 백업은 Android 동반 앱이 최초 1회 오디오 접근 권한을 받고 `MediaStore`를 주기적으로 스캔한 뒤 서버 API로 업로드하는 방식입니다.

## Required Permissions

Android 13 이상:

```xml
<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Android 12 이하:

```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
```

## Server Endpoint

```http
POST https://repo-jamsamuseum.vercel.app/api/mobile-backup/recordings
Authorization: Bearer <MOBILE_BACKUP_API_TOKEN>
Content-Type: multipart/form-data
```

Fields:

- `file`: audio file
- `deviceId`: stable device/app install id
- `originalPath`: MediaStore display path or content uri
- `recordedAt`: ISO datetime
- `lastModified`: epoch millis
- `durationSec`: optional number
- `sha256`: optional duplicate prevention hash
- `title`: optional display title
- `processInline`: optional `true` for short files. Long files should stay queued.

The server stores the file in Supabase Storage, creates a `recordings` row with `source='phone_backup'`, queues `stt_jobs`, and the Vercel cron calls `/api/jobs/process-recording` every 5 minutes for NAVER CLOVA Speech STT and LLM summary.

## Kotlin Upload Sketch

```kotlin
val request = MultipartBody.Builder()
  .setType(MultipartBody.FORM)
  .addFormDataPart("deviceId", deviceId)
  .addFormDataPart("originalPath", uri.toString())
  .addFormDataPart("recordedAt", recordedAtIso)
  .addFormDataPart("lastModified", lastModified.toString())
  .addFormDataPart("durationSec", durationSec.toString())
  .addFormDataPart("sha256", sha256)
  .addFormDataPart(
    "file",
    displayName,
    inputStream.readBytes().toRequestBody(mimeType.toMediaTypeOrNull())
  )
  .build()

val httpRequest = Request.Builder()
  .url("https://repo-jamsamuseum.vercel.app/api/mobile-backup/recordings")
  .addHeader("Authorization", "Bearer $mobileBackupToken")
  .post(request)
  .build()
```

Use `WorkManager` with a network constraint to run the backup periodically, and store successfully uploaded `sha256` values locally so the app does not re-upload the same recording.

