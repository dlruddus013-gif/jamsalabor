# Android Companion Auto Backup

웹브라우저만으로는 Android 전화 수신 감지, 통화 자동녹음, 전체 녹음 폴더 자동 스캔을 직접 수행할 수 없습니다.
이 기능은 Android 네이티브 companion 앱이 권한을 받고 `MediaStore`, `TelephonyCallback`, `WorkManager`를 사용해 웹앱 API로 전달하는 구조입니다.

iOS는 통화 자동녹음과 수신번호 감지가 시스템 정책상 일반 앱에서 불가능합니다.

## Required Permissions

Android 13 이상:

```xml
<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.READ_PHONE_STATE" />
<uses-permission android:name="android.permission.READ_CALL_LOG" />
```

Android 12 이하:

```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.READ_PHONE_STATE" />
<uses-permission android:name="android.permission.READ_CALL_LOG" />
```

통화 자동녹음 자체는 제조사/OS 정책 영향을 받습니다. 삼성 전화 앱처럼 이미 저장된 통화녹음 파일을 `MediaStore`로 읽어 백업하는 방식이 가장 안정적입니다. 실시간 통화 오디오 캡처는 Android 버전과 기기 정책에 따라 막힐 수 있습니다.

## Incoming Call WebView Bridge

네이티브 앱이 WebView로 `/mobile-recorder`를 열어두고, 수신 전화가 오면 아래 JavaScript를 호출하면 됩니다. 그러면 화면에 번호와 같은 번호의 최근 통화내역이 즉시 뜹니다.

```kotlin
val payload = """
  {
    "phone": "$incomingNumber",
    "direction": "incoming",
    "status": "ringing",
    "startedAt": "${Instant.now()}"
  }
""".trimIndent()

webView.post {
  webView.evaluateJavascript("window.jamsaPhoneCallStarted($payload)", null)
}
```

브라우저 테스트는 아래 URL로 할 수 있습니다.

```text
https://repo-jamsamuseum.vercel.app/mobile-recorder?phone=01012345678&direction=incoming
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
- `customerPhone` or `callerPhone` or `phone`: caller number. The server stores it in `recordings.customer_phone`.
- `direction`: `incoming`, `outgoing`, or `missed`
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
  .addFormDataPart("customerPhone", incomingNumber)
  .addFormDataPart("direction", "incoming")
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

## Fast Flow

1. `TelephonyCallback` detects incoming/outgoing call and sends the phone number to WebView.
2. WebView calls `/api/recordings/by-phone?phone=...` and shows previous records.
3. After the device call recorder saves the file, `MediaStore` observer or `WorkManager` finds the new audio file.
4. Companion app uploads it to `/api/mobile-backup/recordings` with `sha256`, `customerPhone`, `direction`, and `recordedAt`.
5. Server inserts `recordings`, stores the file in Supabase Storage, and queues `stt_jobs` for NAVER CLOVA STT.
