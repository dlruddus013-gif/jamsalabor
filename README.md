# Jamsa VITO

잠사박물관/상담 업무용 통화 녹음, STT, 요약, 검색, 업로드 관리 시스템입니다.  
Next.js 15 App Router, TypeScript, Tailwind CSS, Supabase 기반으로 구성되어 Vercel 배포에 맞춰져 있습니다.

## 빠른 실행

```bash
npm install
copy .env.example .env.local
npm run dev
```

기본값은 `NEXT_PUBLIC_USE_SUPABASE=false`라서 Supabase 없이 mock 데이터로 실행됩니다.

## 주요 기능

- 대시보드 KPI, 최근 통화, 실패 작업 현황
- 녹음 파일 목록/상세, 전문 보기, 요약/액션 아이템
- 웹 업로드 및 모바일 브라우저 녹음
- Supabase Auth, Database, Storage 연동 코드
- RLS 정책, Storage 버킷, 인덱스, 트리거 마이그레이션
- STT worker 및 batch import worker
- 마스킹/원본 export 분리와 audit log 기록

## Supabase 연결

1. Supabase에서 새 프로젝트를 만듭니다. 한국 서비스라면 Seoul 리전을 권장합니다.
2. `.env.local`에 아래 값을 채웁니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_USE_SUPABASE=true
NEXT_PUBLIC_SUPABASE_AUDIO_BUCKET=recordings
```

3. 마이그레이션을 순서대로 적용합니다.

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

CLI를 쓰지 못하면 Supabase Studio SQL Editor에서 `supabase/migrations` 안의 SQL 파일을 번호순으로 실행하면 됩니다.

## Vercel 배포

Vercel 프로젝트의 환경변수에 `.env.local`과 같은 값을 등록합니다.

```bash
npx vercel login
npx vercel link
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel env add NEXT_PUBLIC_USE_SUPABASE production
npx vercel env add NEXT_PUBLIC_SUPABASE_AUDIO_BUCKET production
npx vercel --prod
```

Vercel은 Next.js 프로젝트를 자동 인식하므로 별도 `vercel.json`은 필요하지 않습니다.

## 개발 명령

```bash
npm run typecheck
npm run build
npm run start
```

## 보안 메모

- `SUPABASE_SERVICE_ROLE_KEY`는 서버 전용입니다. 절대 `NEXT_PUBLIC_` 접두사를 붙이지 마세요.
- 업로드와 export는 Supabase RLS와 audit log를 전제로 합니다.
- 운영 환경에서는 `NEXT_PUBLIC_USE_SUPABASE=true`로 설정하고 마이그레이션 적용을 먼저 끝내야 합니다.

## 검증 상태

- `npm run typecheck`: 통과
- `npm run build`: 통과
- `http://localhost:3000/dashboard`: production server 응답 200 확인
